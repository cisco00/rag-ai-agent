// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

// ---------------------------------------------------------------------------
// Backend process wrapper — kills the child on drop
// ---------------------------------------------------------------------------

struct BackendProcess(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

impl Drop for BackendProcess {
    fn drop(&mut self) {
        if let Some(child) = self.0.lock().unwrap().take() {
            eprintln!("[tauri] Shutting down backend");
            let _ = child.kill();
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Pick an unused TCP port on 127.0.0.1.
fn find_free_port() -> u16 {
    portpicker::pick_unused_port().expect("No free TCP port available")
}

/// Poll GET /health until we get a 200, or timeout.
fn wait_for_backend(port: u16, timeout_secs: u64) -> bool {
    let url = format!("http://127.0.0.1:{}/health", port);
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    while Instant::now() < deadline {
        match reqwest::blocking::get(&url) {
            Ok(resp) if resp.status().is_success() => return true,
            _ => thread::sleep(Duration::from_millis(500)),
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    let port = find_free_port();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            eprintln!("[tauri] Starting backend on port {} using sidecar", port);

            // Use Tauri's sidecar API to resolve the bundled binary path automatically.
            // This handles the target-triple suffix and platform-specific extensions.
            let sidecar = app
                .shell()
                .sidecar("vantage-backend")
                .map_err(|e| format!("Failed to create sidecar command: {}", e))?
                .env("PORT", port.to_string())
                .env("HOST", "127.0.0.1")
                .env("ENVIRONMENT", "desktop");

            let (mut rx, child) = sidecar
                .spawn()
                .map_err(|e| format!("Failed to spawn backend: {}", e))?;

            eprintln!("[tauri] Backend sidecar spawned");
            app.manage(BackendProcess(Mutex::new(Some(child))));

            // Log backend stdout/stderr in a background thread
            thread::spawn(move || {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.blocking_recv() {
                    match event {
                        CommandEvent::Stdout(line) => {
                            eprint!("[backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprint!("[backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[tauri] Backend error: {}", err);
                        }
                        CommandEvent::Terminated(status) => {
                            eprintln!("[tauri] Backend terminated: {:?}", status);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Wait for backend health in a background thread to avoid blocking UI
            let handle = app.handle().clone();
            thread::spawn(move || {
                if wait_for_backend(port, 30) {
                    eprintln!("[tauri] Backend is healthy on port {}", port);
                } else {
                    eprintln!("[tauri] WARNING: Backend did not become healthy within 30s");
                }

                // Inject the backend URL into the webview
                if let Some(window) = handle.get_webview_window("main") {
                    let js = format!(
                        "window.__VANTAGE_API_URL__ = 'http://127.0.0.1:{}'; \
                         window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || true; \
                         console.log('[Vantage] Backend URL set to port {}');",
                        port, port
                    );
                    let _ = window.eval(&js);

                    // Reload the page so the React app picks up the backend URL
                    let _ = window.eval("setTimeout(() => location.reload(), 500);");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Clean up the backend when the last window closes
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<BackendProcess>() {
                    if let Some(child) = state.0.lock().unwrap().take() {
                        eprintln!("[tauri] Window destroyed - killing backend");
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Vantage AI");
}
