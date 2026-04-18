// Client-piped audio playback: decode a URL or local file with bundled
// ffmpeg/yt-dlp sidecars, then stream s16le 48 kHz stereo PCM to the server's
// /api/music/pipe WebSocket. The server forwards frames into the music bot
// so playback appears to come from DJ Tokoloshe for everyone in the room.

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandEvent, CommandChild};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{mpsc, Mutex as TokioMutex};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::Message;

pub const PCM_FRAME_BYTES: usize = 3840; // 48000 * 2ch * 2B * 0.02s
const RING_FRAMES: usize = 1000; // ~20s of pre-buffered PCM upload-side

pub struct ActivePipe {
    pub child: Option<CommandChild>,
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
        *guard = Some(ActivePipe { child: None, stop: None });
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

    // Resolve source → ffmpeg input + display title
    let (input, title) = if kind == "file" {
        let display = title_hint
            .clone()
            .or_else(|| {
                std::path::Path::new(&source)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "Local file".into());
        (source.clone(), display)
    } else {
        match resolve_url(&app, &source).await {
            Ok((stream_url, title)) => (stream_url, title_hint.unwrap_or(title)),
            Err(e) => {
                emit(&app, "error", None, Some(e.clone()));
                release(&state).await;
                return Err(e);
            }
        }
    };

    // Spawn ffmpeg → s16le 48k stereo PCM on stdout.
    let ffmpeg_args: Vec<String> = vec![
        "-nostdin".into(),
        "-loglevel".into(), "info".into(),
        "-reconnect".into(), "1".into(),
        "-reconnect_streamed".into(), "1".into(),
        "-reconnect_delay_max".into(), "5".into(),
        "-i".into(), input.clone(),
        "-vn".into(),
        "-ac".into(), "2".into(),
        "-ar".into(), "48000".into(),
        "-f".into(), "s16le".into(),
        "pipe:1".into(),
    ];
    log(&app, "ffmpeg", format!("spawning ffmpeg {}", ffmpeg_args.join(" ")));
    let cmd = match app.shell().sidecar("ffmpeg") {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("ffmpeg sidecar missing: {e}");
            emit(&app, "error", None, Some(msg.clone()));
            release(&state).await;
            return Err(msg);
        }
    }
        .args(ffmpeg_args);
    let (mut ffmpeg_rx, ffmpeg_child) = match cmd.spawn() {
        Ok(pair) => pair,
        Err(e) => {
            let msg = format!("ffmpeg spawn: {e}");
            emit(&app, "error", None, Some(msg.clone()));
            release(&state).await;
            return Err(msg);
        }
    };

    // PCM frames channel (cache for poor uplink: ~20 s)
    let (frame_tx, mut frame_rx) = mpsc::channel::<Vec<u8>>(RING_FRAMES);
    // Stop signal — flipped by pipe_stop to break the upload loop cleanly.
    let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);

    // Decoder task: chunk ffmpeg stdout into 3840-byte frames.
    let app_for_decoder = app.clone();
    let decoder = tokio::spawn(async move {
        const STDERR_TAIL_BYTES: usize = 4096;
        let mut buf: Vec<u8> = Vec::with_capacity(PCM_FRAME_BYTES * 4);
        // Retain only the last STDERR_TAIL_BYTES so verbose ffmpeg output
        // still surfaces the actual error line at the end.
        let mut stderr_tail: Vec<u8> = Vec::with_capacity(STDERR_TAIL_BYTES * 2);
        let mut bytes_seen: u64 = 0;
        while let Some(ev) = ffmpeg_rx.recv().await {
            match ev {
                CommandEvent::Stdout(chunk) => {
                    bytes_seen += chunk.len() as u64;
                    buf.extend_from_slice(&chunk);
                    while buf.len() >= PCM_FRAME_BYTES {
                        let frame: Vec<u8> = buf.drain(..PCM_FRAME_BYTES).collect();
                        if frame_tx.send(frame).await.is_err() {
                            return; // uploader gone
                        }
                    }
                }
                CommandEvent::Stderr(b) => {
                    stderr_tail.extend_from_slice(&b);
                    if stderr_tail.len() > STDERR_TAIL_BYTES * 2 {
                        let drop = stderr_tail.len() - STDERR_TAIL_BYTES;
                        stderr_tail.drain(..drop);
                    }
                    let text = String::from_utf8_lossy(&b).into_owned();
                    log(&app_for_decoder, "ffmpeg", text);
                }
                CommandEvent::Terminated(t) => {
                    let code = t.code;
                    let stderr_text = String::from_utf8_lossy(&stderr_tail).trim().to_string();
                    // Keep the tail for the UI — the last 2-3 lines carry the
                    // actual failure, not the banner/codec setup chatter.
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
                            format!("ffmpeg produced no audio (exit {code:?}, no stderr — possibly a missing DLL or the binary isn't runnable)")
                        } else {
                            format!("ffmpeg exit {code:?}: {short_tail}")
                        };
                        emit(&app_for_decoder, "error", None, Some(detail));
                    }
                    break;
                }
                _ => {}
            }
        }
        // Flush any final partial frame by zero-padding (avoids tail glitch).
        if !buf.is_empty() {
            buf.resize(PCM_FRAME_BYTES, 0);
            let _ = frame_tx.send(buf).await;
        }
        // Channel drops here → uploader sees None and sends end.
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
                if let Some(child) = active.child.take() {
                    let _ = child.kill();
                }
            }
        }
        emit(&app_for_uploader, "stopped", None, None);
    });

    {
        let mut guard = state.0.lock().await;
        // Replace the reservation placeholder with the real handles.
        *guard = Some(ActivePipe {
            child: Some(ffmpeg_child),
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
        if let Some(child) = active.child.take() {
            let _ = child.kill();
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
            if let Some(child) = active.child.take() {
                let _ = child.kill();
            }
        }
    });
}
