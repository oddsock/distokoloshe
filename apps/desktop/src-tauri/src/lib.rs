mod pipe;

use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Mutex as TokioMutex;
use url::Url;

// ── Auth state (synced from JS so Rust can send leave on window close) ──
#[derive(Clone)]
struct AuthInfo {
    token: String,
    server_url: String,
}
struct AuthState(Mutex<Option<AuthInfo>>);

#[tauri::command]
fn set_auth_info(state: tauri::State<'_, AuthState>, token: String, server_url: String) {
    *state.0.lock().unwrap() = Some(AuthInfo { token, server_url });
}

#[tauri::command]
fn clear_auth_info(state: tauri::State<'_, AuthState>) {
    *state.0.lock().unwrap() = None;
}

#[tauri::command]
async fn send_leave(token: String, server_url: String) -> Result<(), String> {
    let url = format!("{}/api/events/leave", server_url);
    let body = serde_json::json!({ "token": token }).to_string();
    reqwest::Client::new()
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Update state ─────────────────────────────────────────
struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Serialize, Clone)]
struct UpdateInfo {
    version: String,
    body: Option<String>,
}

#[tauri::command]
async fn check_for_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, PendingUpdate>,
    server_url: String,
) -> Result<Option<UpdateInfo>, String> {
    let base = server_url.trim_end_matches('/');
    let endpoint =
        [base, "/api/updates/{{target}}/{{arch}}/{{current_version}}"].concat();
    let endpoint_url = Url::parse(&endpoint).map_err(|e| e.to_string())?;

    let update = app
        .updater_builder()
        .endpoints(vec![endpoint_url])
        .map_err(|e: tauri_plugin_updater::Error| e.to_string())?
        .build()
        .map_err(|e: tauri_plugin_updater::Error| e.to_string())?
        .check()
        .await
        .map_err(|e: tauri_plugin_updater::Error| e.to_string())?;

    match update {
        Some(u) => {
            let info = UpdateInfo {
                version: u.version.clone(),
                body: u.body.clone(),
            };
            *state.0.lock().unwrap() = Some(u);
            Ok(Some(info))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = state
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("No pending update")?;

    if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
        // Clear stale state so a fresh check can be performed
        *state.0.lock().unwrap() = None;
        return Err(e.to_string());
    }

    app.restart();
}

// ── App entry ────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(AuthState(Mutex::new(None)))
        .manage(PendingUpdate(Mutex::new(None)))
        .manage(pipe::PipeState(TokioMutex::new(None)))
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
                app.handle()
                    .plugin(tauri_plugin_window_state::Builder::default().build())?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_for_update,
            install_update,
            set_auth_info,
            clear_auth_info,
            send_leave,
            pipe::pipe_start,
            pipe::pipe_stop,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Tear down any active pipe before the runtime exits so the
                // server's pipe lock is released and the radio resumes.
                pipe::force_stop_blocking(window.app_handle());

                // Send leave signal via native HTTP, bypassing webview CORS restrictions.
                let auth = window.app_handle().state::<AuthState>().0.lock().unwrap().clone();
                if let Some(info) = auth {
                    let url = format!("{}/api/events/leave", info.server_url);
                    let body = serde_json::json!({ "token": info.token }).to_string();
                    let _ = reqwest::blocking::Client::new()
                        .post(&url)
                        .header("Content-Type", "application/json")
                        .body(body)
                        .timeout(std::time::Duration::from_secs(2))
                        .send();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
