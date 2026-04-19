// Client-piped audio playback: decode a URL or local file with bundled
// ffmpeg/yt-dlp sidecars, then stream s16le 48 kHz stereo PCM to the server's
// /api/music/pipe WebSocket. The server forwards frames into the music bot
// so playback appears to come from DJ Tokoloshe for everyone in the room.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child as TokioChild, ChildStdin, Command as TokioCommand};
use tokio::sync::{mpsc, Mutex as TokioMutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::Message;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub const PCM_FRAME_BYTES: usize = 3840; // 48000 * 2ch * 2B * 0.02s
const RING_FRAMES: usize = 1000; // ~20s of pre-buffered PCM upload-side

pub struct ActivePipe {
    // Tokio children for the streaming pipeline (real sustained pipes).
    // Stored behind Arc<Mutex<Option<_>>> so stop/teardown can take + kill
    // without fighting the bridge/decoder tasks that hold write/read handles.
    pub ffmpeg: Option<Arc<TokioMutex<Option<TokioChild>>>>,
    pub ytdlp: Option<Arc<TokioMutex<Option<TokioChild>>>>,
    pub stop: Option<mpsc::Sender<()>>,
}

pub struct PipeState(pub TokioMutex<Option<ActivePipe>>);

#[derive(Serialize, Clone)]
struct PipeEvent<'a> {
    state: &'a str,
    title: Option<String>,
    error: Option<String>,
}

fn emit(app: &AppHandle, state: &str, title: Option<String>, error: Option<String>) {
    let _ = app.emit("pipe://state", PipeEvent { state, title, error });
}

#[derive(Serialize, Clone)]
struct PipeLogEvent<'a> {
    source: &'a str,
    line: String,
}

/// Resolve a bundled sidecar binary to an absolute path next to the main exe.
/// Tauri v2 installs sidecars (flat-path externalBin) alongside the app binary.
fn resolve_sidecar(name: &str) -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let dir = exe.parent().ok_or("exe has no parent dir")?;
    let mut path = dir.join(name);
    if cfg!(windows) && path.extension().is_none() {
        path.set_extension("exe");
    }
    if !path.exists() {
        return Err(format!("sidecar not found at {}", path.display()));
    }
    Ok(path)
}

/// Build a tokio::process::Command for a sidecar with piped stdio.
/// CREATE_NO_WINDOW hides the console window. The earlier silent-exit failures
/// blamed on this flag were actually the React useEffect race in usePipePlayer
/// killing the pipe on every render — that's fixed, so the flag is safe.
fn sidecar_command(path: &std::path::Path) -> TokioCommand {
    let mut cmd = TokioCommand::new(path);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn log(app: &AppHandle, source: &str, line: impl Into<String>) {
    let text = line.into();
    if text.trim().is_empty() {
        return;
    }
    let _ = app.emit("pipe://log", PipeLogEvent { source, line: text });
}

/// Fetch a yt-dlp-supported URL's title (metadata only — no download).
async fn fetch_title(ytdlp_path: &std::path::Path, url: &str) -> Result<String, String> {
    let mut cmd = sidecar_command(ytdlp_path);
    cmd.args([
        "--no-playlist",
        "--no-warnings",
        "--print",
        "%(title)s",
        url,
    ]);
    let mut child = cmd.spawn().map_err(|e| format!("yt-dlp spawn: {e}"))?;
    let mut stdout = child.stdout.take().expect("yt-dlp stdout piped");
    let mut stderr = child.stderr.take().expect("yt-dlp stderr piped");

    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    let _ = tokio::try_join!(
        stdout.read_to_end(&mut stdout_buf),
        stderr.read_to_end(&mut stderr_buf),
    );
    let status = child.wait().await.map_err(|e| format!("yt-dlp wait: {e}"))?;
    if !status.success() {
        return Err(format!(
            "yt-dlp exit {:?}: {}",
            status.code(),
            String::from_utf8_lossy(&stderr_buf).trim()
        ));
    }
    let title = String::from_utf8_lossy(&stdout_buf).trim().to_string();
    if title.is_empty() {
        return Err("yt-dlp returned empty title".into());
    }
    Ok(title)
}

#[tauri::command]
pub async fn pipe_start(
    app: AppHandle,
    state: tauri::State<'_, PipeState>,
    server_url: String,
    token: String,
    kind: String,        // "url" | "file"
    source: String,      // URL or absolute file path
    title_hint: Option<String>,
) -> Result<String, String> {
    // Atomically claim the slot so concurrent invocations don't double-start.
    {
        let mut guard = state.0.lock().await;
        if guard.is_some() {
            return Err("A pipe is already active".into());
        }
        *guard = Some(ActivePipe { ffmpeg: None, ytdlp: None, stop: None });
    }
    emit(&app, "starting", title_hint.clone(), None);

    // Helper: release the claimed slot if startup fails before we hand off
    // ownership of the child/stop handles.
    async fn release(state: &tauri::State<'_, PipeState>) {
        let mut g = state.0.lock().await;
        *g = None;
    }

    // Resolve sidecar paths.
    let title: String;
    let ffmpeg_path = match resolve_sidecar("ffmpeg") {
        Ok(p) => p,
        Err(e) => {
            emit(&app, "error", None, Some(e.clone()));
            release(&state).await;
            return Err(e);
        }
    };
    let ytdlp_path = match resolve_sidecar("yt-dlp") {
        Ok(p) => p,
        Err(e) => {
            emit(&app, "error", None, Some(e.clone()));
            release(&state).await;
            return Err(e);
        }
    };

    // Set up the ffmpeg input:
    //   - file → ffmpeg reads the path directly
    //   - url  → yt-dlp streams audio bytes to its stdout, bridge task forwards
    //           them to ffmpeg's stdin (real-time, no temp file). Same architecture
    //           mpv/vlc use. The earlier "0 bytes piped" failures were the React
    //           cleanup race in usePipePlayer firing pipe.stop() on every render.
    let ffmpeg_input: String;
    let mut ytdlp_for_bridge: Option<TokioChild> = None;
    let mut ytdlp_arc_for_active: Option<Arc<TokioMutex<Option<TokioChild>>>> = None;

    if kind == "file" {
        title = title_hint
            .clone()
            .or_else(|| {
                std::path::Path::new(&source)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "Local file".into());
        ffmpeg_input = source.clone();
    } else {
        match fetch_title(&ytdlp_path, &source).await {
            Ok(t) => title = title_hint.unwrap_or(t),
            Err(e) => {
                emit(&app, "error", None, Some(e.clone()));
                release(&state).await;
                return Err(e);
            }
        }

        // Format selector prefers pipeable containers (webm/opus). m4a/AAC has
        // moov at end-of-file and won't stream cleanly to a pipe.
        let yt_args = [
            "--no-playlist",
            "-f", "bestaudio[ext=webm]/bestaudio[acodec=opus]/bestaudio/best",
            "--no-warnings",
            // Realtime backpressure from ffmpeg means yt-dlp's upstream
            // HTTP socket sits idle between reads; YouTube's CDN drops
            // idle sockets so yt-dlp range-resumes. Default retries=10
            // would cap a long track mid-way.
            "--retries", "infinite",
            "--fragment-retries", "infinite",
            "-o", "-",
            &source,
        ];
        let mut yt_cmd = sidecar_command(&ytdlp_path);
        yt_cmd.args(yt_args);
        ytdlp_for_bridge = Some(match yt_cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("yt-dlp spawn: {e}");
                emit(&app, "error", None, Some(msg.clone()));
                release(&state).await;
                return Err(msg);
            }
        });
        ffmpeg_input = "pipe:0".into();
    }

    let ffmpeg_args = [
        "-hide_banner",
        "-loglevel", "error",
        "-i", &ffmpeg_input,
        "-vn",
        "-ac", "2",
        "-ar", "48000",
        "-f", "s16le",
        "pipe:1",
    ];
    let mut ffmpeg_cmd = sidecar_command(&ffmpeg_path);
    ffmpeg_cmd.args(ffmpeg_args);
    let mut ffmpeg_child = match ffmpeg_cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("ffmpeg spawn: {e}");
            emit(&app, "error", None, Some(msg.clone()));
            if let Some(mut yt) = ytdlp_for_bridge.take() { let _ = yt.kill().await; }
            release(&state).await;
            return Err(msg);
        }
    };

    let ffmpeg_stdout = ffmpeg_child.stdout.take().expect("ffmpeg stdout piped");
    let ffmpeg_stderr = ffmpeg_child.stderr.take().expect("ffmpeg stderr piped");
    let ffmpeg_stdin: Option<ChildStdin> = ffmpeg_child.stdin.take();

    // Bridge: yt-dlp stdout → ffmpeg stdin (URL mode only). For file mode we
    // close ffmpeg's stdin immediately so it doesn't wait on it.
    if let Some(mut yt) = ytdlp_for_bridge.take() {
        let mut yt_stdout = yt.stdout.take().expect("yt-dlp stdout piped");
        let mut yt_stderr = yt.stderr.take().expect("yt-dlp stderr piped");
        let yt_arc: Arc<TokioMutex<Option<TokioChild>>> =
            Arc::new(TokioMutex::new(Some(yt)));
        ytdlp_arc_for_active = Some(yt_arc.clone());

        let Some(mut stdin) = ffmpeg_stdin else {
            let msg = "ffmpeg had no stdin handle for bridge".to_string();
            emit(&app, "error", None, Some(msg.clone()));
            release(&state).await;
            return Err(msg);
        };
        let app_for_bridge = app.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match yt_stdout.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Err(e) = stdin.write_all(&buf[..n]).await {
                            log(&app_for_bridge, "bridge", format!("ffmpeg stdin write failed: {e}"));
                            break;
                        }
                    }
                }
            }
            // EOF to ffmpeg so it flushes the tail of the decode.
            let _ = stdin.shutdown().await;
        });

        let app_for_yt_err = app.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                match yt_stderr.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => log(&app_for_yt_err, "yt-dlp", String::from_utf8_lossy(&buf[..n]).into_owned()),
                    Err(_) => break,
                }
            }
        });
    } else {
        // File mode — drop stdin so ffmpeg doesn't block on it.
        drop(ffmpeg_stdin);
    }

    // PCM frames channel (cache for poor uplink: ~20 s)
    let (frame_tx, mut frame_rx) = mpsc::channel::<Vec<u8>>(RING_FRAMES);
    // Stop signal — flipped by pipe_stop to break the upload loop cleanly.
    let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);

    // Wrap ffmpeg_child for shared kill from stop path.
    let ffmpeg_arc: Arc<TokioMutex<Option<TokioChild>>> =
        Arc::new(TokioMutex::new(Some(ffmpeg_child)));

    // ffmpeg stderr → devtools log + tail capture for error reporting
    let app_for_err = app.clone();
    let stderr_tail: Arc<TokioMutex<Vec<u8>>> = Arc::new(TokioMutex::new(Vec::with_capacity(8192)));
    let stderr_tail_clone = stderr_tail.clone();
    tokio::spawn(async move {
        const MAX_TAIL: usize = 4096;
        let mut reader = ffmpeg_stderr;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    log(&app_for_err, "ffmpeg", String::from_utf8_lossy(&buf[..n]).into_owned());
                    let mut t = stderr_tail_clone.lock().await;
                    t.extend_from_slice(&buf[..n]);
                    if t.len() > MAX_TAIL * 2 {
                        let drop = t.len() - MAX_TAIL;
                        t.drain(..drop);
                    }
                }
            }
        }
    });

    // Decoder task: chunk ffmpeg stdout into 3840-byte frames.
    let app_for_decoder = app.clone();
    let ffmpeg_for_decoder = ffmpeg_arc.clone();
    let stderr_for_decoder = stderr_tail.clone();
    let decoder = tokio::spawn(async move {
        let mut reader = ffmpeg_stdout;
        let mut pcm_buf: Vec<u8> = Vec::with_capacity(PCM_FRAME_BYTES * 4);
        let mut read_buf = [0u8; 16 * 1024];
        let mut bytes_seen: u64 = 0;
        loop {
            match reader.read(&mut read_buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    bytes_seen += n as u64;
                    pcm_buf.extend_from_slice(&read_buf[..n]);
                    while pcm_buf.len() >= PCM_FRAME_BYTES {
                        let frame: Vec<u8> = pcm_buf.drain(..PCM_FRAME_BYTES).collect();
                        if frame_tx.send(frame).await.is_err() {
                            return;
                        }
                    }
                }
            }
        }
        if !pcm_buf.is_empty() {
            pcm_buf.resize(PCM_FRAME_BYTES, 0);
            let _ = frame_tx.send(pcm_buf).await;
        }
        // Reap the child to get the real exit code for error reporting.
        let code = {
            let mut guard = ffmpeg_for_decoder.lock().await;
            match guard.as_mut() {
                Some(child) => child.wait().await.ok().and_then(|s| s.code()),
                None => None,
            }
        };
        let bad_exit = code.map_or(true, |c| c != 0);
        if bad_exit || bytes_seen == 0 {
            let stderr_text = String::from_utf8_lossy(&*stderr_for_decoder.lock().await).trim().to_string();
            let tail: String = stderr_text
                .lines()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" | ");
            let detail = if tail.is_empty() {
                format!("ffmpeg produced no audio (exit {code:?})")
            } else {
                format!("ffmpeg exit {code:?}: {tail}")
            };
            emit(&app_for_decoder, "error", None, Some(detail));
        }
    });


    // Build the WebSocket URL
    let ws_url = match build_ws_url(&server_url, &token) {
        Ok(u) => u,
        Err(e) => {
            emit(&app, "error", None, Some(e.clone()));
            release(&state).await;
            return Err(e);
        }
    };

    // Uploader task: connect, send start, pump PCM, send end, close.
    let app_for_uploader = app.clone();
    let title_for_uploader = title.clone();
    let uploader = tokio::spawn(async move {
        let req = match ws_url.into_client_request() {
            Ok(r) => r,
            Err(e) => {
                emit(&app_for_uploader, "error", None, Some(format!("ws url: {e}")));
                return;
            }
        };
        let (ws_stream, _resp) = match tokio_tungstenite::connect_async(req).await {
            Ok(s) => s,
            Err(e) => {
                emit(&app_for_uploader, "error", None, Some(format!("ws connect: {e}")));
                return;
            }
        };
        let (mut sink, mut stream) = ws_stream.split();

        let start_msg = serde_json::json!({
            "type": "start",
            "title": title_for_uploader,
        });
        if let Err(e) = sink.send(Message::Text(start_msg.to_string())).await {
            emit(&app_for_uploader, "error", None, Some(format!("ws start: {e}")));
            return;
        }

        let mut started = false;
        // Read responses concurrently to detect busy/closed/etc.
        let app_for_reader = app_for_uploader.clone();
        let _reader = tokio::spawn(async move {
            while let Some(msg) = stream.next().await {
                match msg {
                    Ok(Message::Text(t)) => {
                        if t.contains("\"busy\"") {
                            emit(&app_for_reader, "error", None, Some("Another user is piping audio".into()));
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }
        });

        loop {
            tokio::select! {
                _ = stop_rx.recv() => {
                    break;
                }
                frame = frame_rx.recv() => {
                    let Some(frame) = frame else { break; };
                    if !started {
                        started = true;
                        emit(&app_for_uploader, "playing", Some(title_for_uploader.clone()), None);
                    }
                    if let Err(e) = sink.send(Message::Binary(frame)).await {
                        emit(&app_for_uploader, "error", None, Some(format!("ws send: {e}")));
                        break;
                    }
                }
            }
        }
        let _ = sink.send(Message::Text(serde_json::json!({"type":"end"}).to_string())).await;
        let _ = sink.close().await;

        // Release the PipeState slot so a subsequent pipe_start succeeds.
        if let Some(state) = app_for_uploader.try_state::<PipeState>() {
            let mut guard = state.0.lock().await;
            if let Some(mut active) = guard.take() {
                if let Some(arc) = active.ffmpeg.take() {
                    let mut c = arc.lock().await;
                    if let Some(mut child) = c.take() { let _ = child.kill().await; }
                }
                if let Some(arc) = active.ytdlp.take() {
                    let mut c = arc.lock().await;
                    if let Some(mut child) = c.take() { let _ = child.kill().await; }
                }
            }
        }
        emit(&app_for_uploader, "stopped", None, None);
    });

    {
        let mut guard = state.0.lock().await;
        *guard = Some(ActivePipe {
            ffmpeg: Some(ffmpeg_arc.clone()),
            ytdlp: ytdlp_arc_for_active,
            stop: Some(stop_tx),
        });
    }

    // Detach: decoder exits when ffmpeg ends; uploader exits when the
    // channel closes or stop is signalled. The JoinHandles are dropped,
    // which detaches them (tokio tasks don't abort on handle drop).
    drop(decoder);
    drop(uploader);

    Ok(title)
}

#[tauri::command]
pub async fn pipe_stop(
    state: tauri::State<'_, PipeState>,
) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if let Some(mut active) = guard.take() {
        if let Some(tx) = active.stop.take() {
            let _ = tx.send(()).await;
        }
        if let Some(arc) = active.ytdlp.take() {
            let mut c = arc.lock().await;
            if let Some(mut child) = c.take() { let _ = child.kill().await; }
        }
        if let Some(arc) = active.ffmpeg.take() {
            let mut c = arc.lock().await;
            if let Some(mut child) = c.take() { let _ = child.kill().await; }
        }
    }
    Ok(())
}

fn build_ws_url(server_url: &str, token: &str) -> Result<String, String> {
    let parsed = url::Url::parse(server_url).map_err(|e| format!("server url: {e}"))?;
    let scheme = match parsed.scheme() {
        "https" => "wss",
        "http" => "ws",
        s => return Err(format!("unsupported scheme: {s}")),
    };
    let host = parsed
        .host_str()
        .ok_or_else(|| "server url has no host".to_string())?;
    let port = parsed
        .port()
        .map(|p| format!(":{p}"))
        .unwrap_or_default();
    let token_enc = url::form_urlencoded::byte_serialize(token.as_bytes()).collect::<String>();
    Ok(format!("{scheme}://{host}{port}/api/music/pipe?token={token_enc}"))
}

/// Best-effort synchronous teardown for app shutdown / window close paths.
/// Runs on the Tauri main thread; uses Tauri's tokio runtime to drive the lock.
pub fn force_stop_blocking(app: &AppHandle) {
    let Some(state) = app.try_state::<PipeState>() else { return };
    tauri::async_runtime::block_on(async move {
        let mut guard = state.0.lock().await;
        if let Some(mut active) = guard.take() {
            if let Some(tx) = active.stop.take() {
                let _ = tx.send(()).await;
            }
            if let Some(arc) = active.ytdlp.take() {
                let mut c = arc.lock().await;
                if let Some(mut child) = c.take() { let _ = child.kill().await; }
            }
            if let Some(arc) = active.ffmpeg.take() {
                let mut c = arc.lock().await;
                if let Some(mut child) = c.take() { let _ = child.kill().await; }
            }
        }
    });
}
