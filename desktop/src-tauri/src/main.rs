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
// Helpers
// ---------------------------------------------------------------------------

/// Pick an unused TCP port on 127.0.0.1.
fn find_free_port() -> u16 {
    portpicker::pick_unused_port().expect("No free TCP port available")
}

/// Resolve the path to the bundled backend binary.
/// In dev mode falls back to the binaries/ folder in the Tauri source dir.
fn resolve_backend_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let resource_dir = app
        .path()
        .resource_dir()
        .expect("Failed to resolve resource directory");

    let binary_name = if cfg!(target_os = "windows") {
        "binaries/vantage-backend.exe"
    } else {
        "binaries/vantage-backend"
    };

    let bundled = resource_dir.join(binary_name);
    if bundled.exists() {
        return bundled;
    }

    // Fallback for `cargo tauri dev` — look next to src-tauri/
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(binary_name);
    if dev_path.exists() {
        return dev_path;
    }

    panic!(
        "Backend binary not found at {:?} or {:?}. Run `python desktop/build-backend.py` first.",
        bundled, dev_path
    );
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
            let backend_path = resolve_backend_path(&app.handle());
            eprintln!(
                "[tauri] Starting backend on port {} from {:?}",
                port, backend_path
            );

            // Spawn the PyInstaller-built backend as a child process
            let child = Command::new(&backend_path)
                .env("PORT", port.to_string())
                .env("HOST", "127.0.0.1")
                .env("ENVIRONMENT", "desktop")
                .spawn()
                .unwrap_or_else(|e| {
                    panic!(
                        "Failed to start backend at {:?}: {}",
                        backend_path, e
                    );
                });

            eprintln!("[tauri] Backend spawned (pid {})", child.id());
            app.manage(BackendProcess(Mutex::new(Some(child))));

            // Block until the backend is healthy (up to 30 s)
            if wait_for_backend(port, 30) {
                eprintln!("[tauri] Backend is healthy on port {}", port);
            } else {
                eprintln!("[tauri] WARNING: Backend did not become healthy within 30 s");
            }

            // Inject the backend URL into the webview so the React app can find it
            let window = app
                .get_webview_window("main")
                .expect("main window not found");

            let js = format!(
                "window.__VANTAGE_API_URL__ = 'http://127.0.0.1:{}'",
                port
            );
            let _ = window.eval(&js);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Clean up the backend when the last window closes
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<BackendProcess>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        eprintln!("[tauri] Window destroyed — killing backend");
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Vantage AI");
}
