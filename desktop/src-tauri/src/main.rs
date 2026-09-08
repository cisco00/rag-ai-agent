// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::Manager;

// ---------------------------------------------------------------------------
// Backend process wrapper — kills the child on drop
// ---------------------------------------------------------------------------

struct BackendProcess(Mutex<Option<Child>>);

impl Drop for BackendProcess {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            eprintln!("[tauri] Shutting down backend (pid {:?})", child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ---------------------------------------------------------------------------
// State for sharing the backend port with the webview
// ---------------------------------------------------------------------------

struct BackendPort(u16);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Pick an unused TCP port on 127.0.0.1.
fn find_free_port() -> u16 {
    portpicker::pick_unused_port().expect("No free TCP port available")
}

/// Resolve the path to the bundled backend binary.
/// Tauri bundles externalBin with the target triple suffix, e.g.
/// `vantage-backend-x86_64-pc-windows-msvc.exe`
fn resolve_backend_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource directory: {}", e))?;

    // TAURI_ENV_TARGET_TRIPLE is injected by tauri-build during compilation
    let target_triple = env!("TAURI_ENV_TARGET_TRIPLE");
    let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
    let binary_filename = format!("vantage-backend-{}{}", target_triple, ext);

    // Check in the bundled resource directory
    let bundled = resource_dir.join("binaries").join(&binary_filename);
    eprintln!("[tauri] Looking for backend at: {:?}", bundled);
    if bundled.exists() {
        return Ok(bundled);
    }

    // Fallback: check directly in the resource dir (some bundle formats flatten)
    let flat = resource_dir.join(&binary_filename);
    eprintln!("[tauri] Fallback: looking at: {:?}", flat);
    if flat.exists() {
        return Ok(flat);
    }

    // Fallback for `cargo tauri dev` — look in src-tauri/binaries/
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(&binary_filename);
    eprintln!("[tauri] Dev fallback: looking at: {:?}", dev_path);
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err(format!(
        "Backend binary '{}' not found.\nSearched:\n  1. {:?}\n  2. {:?}\n  3. {:?}\n\nRun `python desktop/build-backend.py` first.",
        binary_filename, bundled, flat, dev_path
    ))
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
        .manage(BackendPort(port))
        .setup(move |app| {
            let backend_path = match resolve_backend_path(&app.handle()) {
                Ok(path) => path,
                Err(msg) => {
                    eprintln!("[tauri] ERROR: {}", msg);
                    // Show error in the webview instead of crashing
                    if let Some(window) = app.get_webview_window("main") {
                        let error_html = format!(
                            "document.body.innerHTML = '<div style=\"display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#f8fafc;font-family:system-ui;padding:2rem\"><div style=\"text-align:center;max-width:500px\"><h1 style=\"color:#f87171\">Backend Not Found</h1><p style=\"color:#94a3b8;margin-top:1rem\">{}</p></div></div>';",
                            msg.replace('\"', "\\\"").replace('\n', "<br>")
                        );
                        let _ = window.eval(&error_html);
                    }
                    return Ok(());
                }
            };

            eprintln!(
                "[tauri] Starting backend on port {} from {:?}",
                port, backend_path
            );

            // Spawn the PyInstaller-built backend as a child process
            let child = match Command::new(&backend_path)
                .env("PORT", port.to_string())
                .env("HOST", "127.0.0.1")
                .env("ENVIRONMENT", "desktop")
                .spawn()
            {
                Ok(child) => child,
                Err(e) => {
                    let msg = format!("Failed to start backend: {}", e);
                    eprintln!("[tauri] ERROR: {}", msg);
                    if let Some(window) = app.get_webview_window("main") {
                        let error_html = format!(
                            "document.body.innerHTML = '<div style=\"display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#f8fafc;font-family:system-ui\"><div style=\"text-align:center\"><h1 style=\"color:#f87171\">Startup Error</h1><p style=\"color:#94a3b8;margin-top:1rem\">{}</p></div></div>';",
                            msg.replace('\"', "\\\"")
                        );
                        let _ = window.eval(&error_html);
                    }
                    return Ok(());
                }
            };

            eprintln!("[tauri] Backend spawned (pid {})", child.id());
            app.manage(BackendProcess(Mutex::new(Some(child))));

            // Wait for backend health in a background thread to avoid blocking UI
            let handle = app.handle().clone();
            thread::spawn(move || {
                if wait_for_backend(port, 30) {
                    eprintln!("[tauri] Backend is healthy on port {}", port);
                } else {
                    eprintln!("[tauri] WARNING: Backend did not become healthy within 30 s");
                }

                // Inject the backend URL into the webview
                if let Some(window) = handle.get_webview_window("main") {
                    let js = format!(
                        "window.__VANTAGE_API_URL__ = 'http://127.0.0.1:{}'; console.log('[Vantage] Backend URL set to port {}');",
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
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        eprintln!("[tauri] Window destroyed - killing backend");
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Vantage AI");
}
