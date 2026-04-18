// Client-piped audio playback: decode a URL or local file with bundled
// ffmpeg/yt-dlp sidecars, then stream s16le 48 kHz stereo PCM to the server's
// /api/music/pipe WebSocket. The server forwards frames into the music bot
// so playback appears to come from DJ Tokoloshe for everyone in the room.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::io::AsyncReadExt;
use tokio::process::{Child as TokioChild, Command as TokioCommand};
use tokio::sync::{mpsc, Mutex as TokioMutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::Message;

pub const PCM_FRAME_BYTES: usize = 3840; // 48000 * 2ch * 2B * 0.02s
const RING_FRAMES: usize = 1000; // ~20s of pre-buffered PCM upload-side

pub struct ActivePipe {
    // Tokio children for the streaming pipeline (real sustained pipes).
    // Stored behind Arc<Mutex<Option<_>>> so stop/teardown can take + kill
    // without fighting the bridge/decoder tasks that hold write/read handles.
    pub ffmpeg: Option<Arc<TokioMutex<Option<TokioChild>>>>,
    pub ytdlp: Option<Arc<TokioMutex<Option<TokioChild>>>>,
    pub stop: Option<mpsc::Sender<()>>,
    /// Temp file yt-dlp downloaded into (URL mode only). Deleted on teardown.
    pub temp_file: Option<std::path::PathBuf>,
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
/// Deliberately DOES NOT set CREATE_NO_WINDOW (breaks PyInstaller + sustained
/// pipes — plugins-workspace#2135 / pyinstaller#8426) or DETACHED_PROCESS
/// (PyInstaller bootloader needs at least a minimal console to initialise).
/// Accept a brief console flash on Windows in exchange for working stdio.
/// A nicer fix via STARTUPINFOW + SW_HIDE can come later once piping works.
fn sidecar_command(path: &std::path::Path) -> TokioCommand {
    let mut cmd = TokioCommand::new(path);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    cmd
}

fn log(app: &AppHandle, source: &str, line: impl Into<String>) {
    let text = line.into();
    if text.trim().is_empty() {
        return;
    }
    let _ = app.emit("pipe://log", PipeLogEvent { source, line: text });
}

/// Run a sidecar with one arg, capture everything, log it, and return (exit, stdout, stderr).
async fn probe(app: &AppHandle, name: &'static str, arg: &'static str) -> Result<(Option<i32>, String, String), String> {
    let cmd = app
        .shell()
        .sidecar(name)
        .map_err(|e| format!("{name} sidecar missing: {e}"))?
        .args([arg]);
    let (mut rx, _child) = cmd.spawn().map_err(|e| format!("{name} spawn: {e}"))?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut code: Option<i32> = None;
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(b) => stdout.extend_from_slice(&b),
            CommandEvent::Stderr(b) => stderr.extend_from_slice(&b),
            CommandEvent::Terminated(t) => { code = t.code; break; }
            _ => {}
        }
    }
    let stdout_s = String::from_utf8_lossy(&stdout).trim().to_string();
    let stderr_s = String::from_utf8_lossy(&stderr).trim().to_string();
    log(app, name, format!("`{name} {arg}` exit={code:?} stdout_len={} stderr_len={}", stdout_s.len(), stderr_s.len()));
    if !stdout_s.is_empty() { log(app, name, format!("stdout: {stdout_s}")); }
    if !stderr_s.is_empty() { log(app, name, format!("stderr: {stderr_s}")); }
    Ok((code, stdout_s, stderr_s))
}

/// Resolve a yt-dlp-supported URL to (direct stream URL, title).
async fn resolve_url(app: &AppHandle, url: &str) -> Result<(String, String), String> {
    // Single --print template with a tab separator gives unambiguous parsing
    // (avoids the --get-url + --print interleaving order being yt-dlp version
    // dependent).
    let cmd = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| format!("yt-dlp sidecar missing: {e}"))?
        .args([
            "--no-playlist",
            "-f",
            "bestaudio/best",
            "--no-warnings",
            "--print",
            "%(title)s\t%(url)s",
            url,
        ]);
    let (mut rx, _child) = cmd.spawn().map_err(|e| format!("yt-dlp spawn: {e}"))?;

    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(b) => stdout.extend_from_slice(&b),
            CommandEvent::Stderr(b) => {
                let text = String::from_utf8_lossy(&b).into_owned();
                log(app, "yt-dlp", text);
                stderr.extend_from_slice(&b);
            }
            CommandEvent::Terminated(t) => {
                if t.code != Some(0) {
                    return Err(format!(
                        "yt-dlp exit {:?}: {}",
                        t.code,
                        String::from_utf8_lossy(&stderr).trim()
                    ));
                }
                break;
            }
            _ => {}
        }
    }
    log(app, "yt-dlp", format!("stdout: {}", String::from_utf8_lossy(&stdout).trim()));
    let text = String::from_utf8_lossy(&stdout);
    let line = text
        .lines()
        .find(|l| l.contains('\t'))
        .ok_or_else(|| format!("yt-dlp returned no usable output: {text}"))?;
    let mut parts = line.splitn(2, '\t');
    let title = parts.next().unwrap_or("").trim().to_string();
    let stream = parts.next().unwrap_or("").trim().to_string();
    if stream.is_empty() {
        return Err(format!("yt-dlp returned empty stream URL: {text}"));
    }
    Ok((stream, title))
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
        *guard = Some(ActivePipe { ffmpeg: None, ytdlp: None, stop: None, temp_file: None });
    }
    emit(&app, "starting", title_hint.clone(), None);

    // Helper: release the claimed slot if startup fails before we hand off
    // ownership of the child/stop handles.
    async fn release(state: &tauri::State<'_, PipeState>) {
        let mut g = state.0.lock().await;
        *g = None;
    }

    // Pre-flight: make sure each sidecar actually runs and prints a version.
    // If not, the real pipeline would silently fail with exit 1 and zero
    // stderr — this turns that into a crystal-clear message.
    for &bin in &["ffmpeg", "yt-dlp"] {
        let arg = if bin == "ffmpeg" { "-version" } else { "--version" };
        match probe(&app, bin, arg).await {
            Ok((Some(0), stdout, _)) if !stdout.is_empty() => { /* ok */ }
            Ok((code, stdout, stderr)) => {
                let msg = format!(
                    "{bin} pre-flight failed (exit {code:?}). Binary is installed but not runnable — likely blocked by Windows Defender/SmartScreen or missing a dependency. stdout: {stdout}; stderr: {stderr}"
                );
                emit(&app, "error", None, Some(msg.clone()));
                release(&state).await;
                return Err(msg);
            }
            Err(e) => {
                emit(&app, "error", None, Some(e.clone()));
                release(&state).await;
                return Err(e);
            }
        }
    }

    // Determine title + resolve sidecar paths.
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
    //   - file  → ffmpeg reads the path directly
    //   - url   → yt-dlp downloads to a temp file (blocking), ffmpeg reads it
    //             (bypasses the Windows piped-stdio bug between sidecars entirely)
    let ffmpeg_input: String;
    let mut temp_file: Option<std::path::PathBuf> = None;

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
        match resolve_url(&app, &source).await {
            Ok((_stream_url, t)) => title = title_hint.unwrap_or(t),
            Err(e) => {
                emit(&app, "error", None, Some(e.clone()));
                release(&state).await;
                return Err(e);
            }
        }

        // Unique temp path under the OS temp dir.
        let now_ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let pid = std::process::id();
        let temp_path = std::env::temp_dir()
            .join(format!("distokoloshe_pipe_{pid}_{now_ns}.audio"));
        log(&app, "yt-dlp", format!("downloading to {}", temp_path.display()));

        let temp_path_str = temp_path.to_string_lossy().to_string();
        let yt_args = [
            "--no-playlist",
            "-f", "bestaudio/best",
            "--no-part",             // don't write .part files — write straight to target
            "--no-progress",         // cleaner stderr
            "-o", &temp_path_str,
            &source,
        ];
        log(&app, "yt-dlp", format!("yt-dlp {}", yt_args.join(" ")));
        let mut yt_cmd = sidecar_command(&ytdlp_path);
        yt_cmd.env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUNBUFFERED", "1")
            .args(yt_args);
        let mut yt_child = match yt_cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("yt-dlp spawn: {e}");
                emit(&app, "error", None, Some(msg.clone()));
                release(&state).await;
                return Err(msg);
            }
        };

        // Drain yt-dlp stderr to devtools while we wait.
        let app_for_yt_err = app.clone();
        let mut yt_stderr = yt_child.stderr.take().expect("yt-dlp stderr piped");
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

        // Wait for download to finish.
        let yt_status = match yt_child.wait().await {
            Ok(s) => s,
            Err(e) => {
                let msg = format!("yt-dlp wait: {e}");
                emit(&app, "error", None, Some(msg.clone()));
                let _ = std::fs::remove_file(&temp_path);
                release(&state).await;
                return Err(msg);
            }
        };
        if !yt_status.success() || !temp_path.exists() {
            let msg = format!(
                "yt-dlp download failed (exit {:?}, file exists: {})",
                yt_status.code(),
                temp_path.exists()
            );
            emit(&app, "error", None, Some(msg.clone()));
            let _ = std::fs::remove_file(&temp_path);
            release(&state).await;
            return Err(msg);
        }
        log(&app, "yt-dlp", format!(
            "download complete ({} bytes)",
            std::fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0)
        ));
        ffmpeg_input = temp_path_str;
        temp_file = Some(temp_path);
    }

    // Spawn ffmpeg via tokio directly (bypassing tauri-plugin-shell to avoid
    // the plugin's CREATE_NO_WINDOW flag which interacts badly with PyInstaller
    // and some static ffmpeg builds on Windows — sustained stdout writes go
    // silent otherwise. See plugins-workspace#2135 and pyinstaller#8426.)
    let ffmpeg_args = vec![
        "-nostdin".to_string(),
        "-loglevel".into(), "verbose".into(),
        "-i".into(), ffmpeg_input.clone(),
        "-vn".into(),
        "-ac".into(), "2".into(),
        "-ar".into(), "48000".into(),
        "-f".into(), "s16le".into(),
        "pipe:1".into(),
    ];
    log(&app, "ffmpeg", format!("spawning ffmpeg {}", ffmpeg_args.join(" ")));
    let mut ffmpeg_cmd = sidecar_command(&ffmpeg_path);
    ffmpeg_cmd.args(&ffmpeg_args);
    let mut ffmpeg_child = match ffmpeg_cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("ffmpeg spawn: {e}");
            emit(&app, "error", None, Some(msg.clone()));
            if let Some(p) = &temp_file { let _ = std::fs::remove_file(p); }
            release(&state).await;
            return Err(msg);
        }
    };

    let ffmpeg_stdout = ffmpeg_child.stdout.take().expect("ffmpeg stdout piped");
    let ffmpeg_stderr = ffmpeg_child.stderr.take().expect("ffmpeg stderr piped");
    // ffmpeg's stdin is unused (we always read from a file or resolve path).
    // Dropping the handle closes it so ffmpeg sees EOF if it ever tries.
    drop(ffmpeg_child.stdin.take());

    // PCM frames channel (cache for poor uplink: ~20 s)
    let (frame_tx, mut frame_rx) = mpsc::channel::<Vec<u8>>(RING_FRAMES);
    // Stop signal — flipped by pipe_stop to break the upload loop cleanly.
    let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);

    // Wrap ffmpeg_child for shared kill from stop path.
    let ffmpeg_arc: Arc<TokioMutex<Option<TokioChild>>> =
        Arc::new(TokioMutex::new(Some(ffmpeg_child)));

    // ffmpeg stderr → devtools log + capture tail for error message
    let app_for_err = app.clone();
    let stderr_tail: Arc<TokioMutex<Vec<u8>>> = Arc::new(TokioMutex::new(Vec::with_capacity(8192)));
    let stderr_tail_clone = stderr_tail.clone();
    tokio::spawn(async move {
        const MAX_TAIL: usize = 4096;
        let mut reader = ffmpeg_stderr;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    log(&app_for_err, "ffmpeg", String::from_utf8_lossy(&buf[..n]).into_owned());
                    let mut t = stderr_tail_clone.lock().await;
                    t.extend_from_slice(&buf[..n]);
                    if t.len() > MAX_TAIL * 2 {
                        let drop = t.len() - MAX_TAIL;
                        t.drain(..drop);
                    }
                }
                Err(_) => break,
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
                Ok(0) => break,
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
                Err(_) => break,
            }
        }
        // Flush partial frame
        if !pcm_buf.is_empty() {
            pcm_buf.resize(PCM_FRAME_BYTES, 0);
            let _ = frame_tx.send(pcm_buf).await;
        }
        // Wait on ffmpeg exit so we have the real code for the error message.
        let code: Option<i32>;
        {
            let mut guard = ffmpeg_for_decoder.lock().await;
            code = match guard.as_mut() {
                Some(child) => child.wait().await.ok().and_then(|s| s.code()),
                None => None,
            };
        }
        let stderr_text = String::from_utf8_lossy(&*stderr_for_decoder.lock().await).trim().to_string();
        let short_tail: String = stderr_text
            .lines()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        log(&app_for_decoder, "ffmpeg", format!("exited code={code:?}, bytes={bytes_seen}"));
        let bad_exit = code.map_or(true, |c| c != 0);
        if bad_exit || bytes_seen == 0 {
            let detail = if short_tail.is_empty() {
                format!("ffmpeg produced no audio (exit {code:?}, no stderr)")
            } else {
                format!("ffmpeg exit {code:?}: {short_tail}")
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
                if let Some(p) = active.temp_file.take() {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
        emit(&app_for_uploader, "stopped", None, None);
    });

    {
        let mut guard = state.0.lock().await;
        *guard = Some(ActivePipe {
            ffmpeg: Some(ffmpeg_arc.clone()),
            ytdlp: None,
            stop: Some(stop_tx),
            temp_file,
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
        if let Some(p) = active.temp_file.take() {
            let _ = std::fs::remove_file(&p);
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
            if let Some(p) = active.temp_file.take() {
                let _ = std::fs::remove_file(&p);
            }
        }
    });
}
