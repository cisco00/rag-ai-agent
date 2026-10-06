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
                .sidecar("binaries/vantage-backend/vantage-backend")
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

            // Show a loading screen immediately so the user never sees a blank window
            if let Some(window) = app.get_webview_window("main") {
                let loading_html = format!(r#"
                    data:text/html,<!DOCTYPE html>
                    <html>
                    <head><meta charset="utf-8"><title>Vantage AI</title>
                    <style>
                        * {{ margin:0; padding:0; box-sizing:border-box; }}
                        body {{
                            background: #0f1117;
                            color: #e2e8f0;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            gap: 24px;
                        }}
                        .logo {{ font-size: 2rem; font-weight: 700; letter-spacing: -0.5px; }}
                        .logo span {{ color: #6366f1; }}
                        .spinner {{
                            width: 36px; height: 36px;
                            border: 3px solid #2d3748;
                            border-top-color: #6366f1;
                            border-radius: 50%;
                            animation: spin 0.8s linear infinite;
                        }}
                        @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
                        .status {{ font-size: 0.85rem; color: #718096; }}
                    </style>
                    </head>
                    <body>
                        <div class="logo">Vantage <span>AI</span></div>
                        <div class="spinner"></div>
                        <div class="status" id="s">Starting backend…</div>
                    </body>
                    </html>
                "#);
                let _ = window.navigate(loading_html.parse().unwrap());
            }

            // Wait for backend health in a background thread to avoid blocking UI
            let handle = app.handle().clone();
            thread::spawn(move || {
                if wait_for_backend(port, 60) {
                    eprintln!("[tauri] Backend is healthy on port {}", port);

                    if let Some(window) = handle.get_webview_window("main") {
                        // Set the API URL then navigate to the bundled frontend
                        let js = format!(
                            "window.__VANTAGE_API_URL__ = 'http://127.0.0.1:{port}'; \
                             console.log('[Vantage] Backend ready on port {port}');"
                        );
                        let _ = window.eval(&js);
                        // Navigate to the bundled index.html
                        let _ = window.navigate("tauri://localhost".parse().unwrap());
                    }
                } else {
                    eprintln!("[tauri] ERROR: Backend did not become healthy within 60s");

                    // Show a user-friendly error page instead of staying blank
                    if let Some(window) = handle.get_webview_window("main") {
                        let error_html = r#"data:text/html,<!DOCTYPE html>
                            <html><head><meta charset="utf-8"><title>Vantage AI — Error</title>
                            <style>
                                * { margin:0; padding:0; box-sizing:border-box; }
                                body {
                                    background:#0f1117; color:#e2e8f0;
                                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                                    display:flex; flex-direction:column;
                                    align-items:center; justify-content:center;
                                    height:100vh; gap:16px; padding:32px; text-align:center;
                                }
                                h2 { color:#fc8181; font-size:1.25rem; }
                                p  { color:#718096; font-size:0.875rem; max-width:420px; line-height:1.6; }
                                button {
                                    margin-top:8px; padding:10px 24px;
                                    background:#6366f1; color:#fff; border:none;
                                    border-radius:6px; font-size:0.875rem; cursor:pointer;
                                }
                                button:hover { background:#4f46e5; }
                            </style></head>
                            <body>
                                <h2>&#9888; Backend failed to start</h2>
                                <p>The Vantage AI backend service did not start within 60 seconds.
                                   This can happen if antivirus software is blocking the process,
                                   or if the app bundle is incomplete.</p>
                                <p>Try restarting the app. If the problem persists, reinstall
                                   from the latest release.</p>
                                <button onclick="location.reload()">Retry</button>
                            </body></html>"#;
                        let _ = window.navigate(error_html.parse().unwrap());
                    }
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
