# Vantage AI — Desktop App

Standalone desktop application built with [Tauri v2](https://v2.tauri.app/). Users download a single installer — no Docker, Python, or terminal required.

## Architecture

```
┌─────────────────────────────────────────┐
│          Tauri Desktop App              │
│  ┌──────────┐    ┌──────────────────┐   │
│  │ Rust core │──▶│ React Frontend   │   │
│  │ (Tauri)   │   │ (native WebView) │   │
│  └─────┬─────┘   └──────────────────┘   │
│        │ spawns           │ API calls   │
│        ▼                  ▼             │
│  ┌──────────────────────────────────┐   │
│  │  Python Backend (sidecar)       │   │
│  │  PyInstaller standalone binary  │   │
│  │  http://127.0.0.1:<random port> │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Prerequisites

- **Rust** (latest stable): [rustup.rs](https://rustup.rs/)
- **Node.js 18+**: [nodejs.org](https://nodejs.org/)
- **Python 3.11+**: for building the backend binary

### Linux only
```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

## Building

### 1. Build the backend binary

```bash
# Install backend deps + PyInstaller
pip install -r backend/requirements.txt
pip install pyinstaller

# Build the standalone binary
python desktop/build-backend.py
```

This creates `desktop/src-tauri/binaries/vantage-backend-<target-triple>[.exe]`.

### 2. Install frontend dependencies

```bash
cd frontend && npm install
```

### 3. Build the desktop app

```bash
cd desktop
npx tauri build
```

Installers are output to `desktop/src-tauri/target/release/bundle/`:
- **Windows**: `msi/Vantage AI_2.6.0_x64_en-US.msi`
- **macOS**: `dmg/Vantage AI.dmg`
- **Linux**: `deb/vantage-ai_2.6.0_amd64.deb` and `appimage/Vantage AI.AppImage`

## Development

```bash
# Build the backend binary first (one time)
python desktop/build-backend.py

# Start Tauri dev mode (hot-reloads the frontend)
cd desktop
npx tauri dev
```

## CI/CD

Push a tag like `v2.6.0` to trigger the GitHub Actions workflow (`.github/workflows/build-desktop.yml`). It builds installers for all three platforms and creates a draft GitHub Release.

```bash
git tag v2.6.0
git push origin v2.6.0
```

## Auto-Updates

The app checks `https://github.com/cisco00/rag-ai-agent/releases/latest/download/latest.json` for new versions. When an update is available, a dialog prompts the user to install it.

To publish an update:
1. Push a new version tag
2. Let CI build the installers
3. Publish the draft release on GitHub

## Notes

- **Unsigned beta**: Since the app is not code-signed, users will see OS warnings:
  - **Windows**: "Windows protected your PC" → click "More info" → "Run anyway"
  - **macOS**: Right-click → "Open" → "Open" (bypasses Gatekeeper)
  - **Linux**: No warning (AppImage needs `chmod +x`)
- **App data**: stored in the OS-standard app data directory
- **LLM API key**: users provide their own key on first launch via the setup wizard
