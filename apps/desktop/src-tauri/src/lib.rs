use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

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

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}

// ── App entry ────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingUpdate(Mutex::new(None)))
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
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Fire the leave beacon before the webview is destroyed.
                // This tells the server to skip the 15s grace period.
                if let Some(ww) = window.app_handle().get_webview_window("main") {
                    let _ = ww.eval(
                        "try { \
                            const token = localStorage.getItem('distokoloshe_token'); \
                            const server = localStorage.getItem('distokoloshe_server_url') || ''; \
                            if (token && server) { \
                                navigator.sendBeacon( \
                                    server + '/api/events/leave', \
                                    new Blob([JSON.stringify({ token })], { type: 'application/json' }) \
                                ); \
                            } \
                        } catch(e) {}"
                    );
                }
                // Brief pause to let the beacon fire
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
