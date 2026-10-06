#!/usr/bin/env python3
"""Build the Vantage AI backend into a standalone executable using PyInstaller.

Usage:
    python desktop/build-backend.py

The output binary is placed in desktop/src-tauri/binaries/ with the
platform-specific name that Tauri expects (e.g. vantage-backend-x86_64-pc-windows-msvc.exe).
"""

import os
import sys
import argparse
import platform
import subprocess


def get_tauri_target_triple():
    """Return the Rust-style target triple for the current platform."""
    machine = platform.machine().lower()
    system = platform.system().lower()

    if system == "windows":
        arch = "x86_64" if machine in ("x86_64", "amd64") else "aarch64"
        return f"{arch}-pc-windows-msvc"
    elif system == "darwin":
        arch = "aarch64" if machine == "arm64" else "x86_64"
        return f"{arch}-apple-darwin"
    elif system == "linux":
        arch = "x86_64" if machine in ("x86_64", "amd64") else "aarch64"
        return f"{arch}-unknown-linux-gnu"
    else:
        raise RuntimeError(f"Unsupported platform: {system}")


def main():
    parser = argparse.ArgumentParser(description="Build Vantage AI backend binary")
    parser.add_argument(
        "--target",
        help="Override the target triple (e.g. x86_64-apple-darwin). "
             "Auto-detected from the current platform if not specified.",
    )
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    backend_dir = os.path.join(project_root, "backend")
    output_dir = os.path.join(project_root, "desktop", "src-tauri", "binaries")

    os.makedirs(output_dir, exist_ok=True)

    target_triple = args.target or get_tauri_target_triple()
    ext = ".exe" if "windows" in target_triple else ""
    output_name = f"vantage-backend-{target_triple}{ext}"

    print("=" * 50)
    print(f"  Building Vantage AI backend")
    print(f"  Target:  {target_triple}")
    print(f"  Output:  {os.path.join(output_dir, output_name)}")
    print("=" * 50)

    # Hidden imports PyInstaller can't detect automatically
    hidden_imports = [
        # Uvicorn internals
        "uvicorn.logging", "uvicorn.loops", "uvicorn.loops.auto",
        "uvicorn.protocols", "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan", "uvicorn.lifespan.on",
        # SQLAlchemy dialects
        "sqlalchemy.dialects.sqlite", "sqlalchemy.dialects.postgresql",
        "sqlalchemy.dialects.mysql", "pymysql", "psycopg2",
        # ML / stats
        "sklearn", "sklearn.utils._typedefs", "sklearn.utils._heap",
        "sklearn.utils._sorting", "sklearn.utils._vector_sentinel",
        "statsmodels", "statsmodels.tsa", "statsmodels.tsa.holtwinters",
        # Email
        "email.mime.multipart", "email.mime.text", "email.mime.base",
        # LLM providers
        "google.generativeai", "openai", "anthropic",
        # Auth / crypto
        "bcrypt", "jose", "jose.jwt", "jose.constants",
        # Misc
        "dotenv", "alembic", "alembic.config",
        "reportlab", "pptx",
        "matplotlib", "matplotlib.backends.backend_agg",
        "apscheduler", "apscheduler.schedulers.background",
        "apscheduler.executors.pool",
        "langfuse",
    ]

    is_windows = "windows" in target_triple

    # --onedir: extract once to a folder next to the exe instead of to %TEMP%
    # on every launch (--onefile). This eliminates the 30-60 s Windows Defender
    # scan on first run and the blank console while extraction happens.
    # The Tauri externalBin points at the exe inside the folder (see tauri.conf.json).
    binary_dir = os.path.join(output_dir, f"vantage-backend-{target_triple}")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onedir",
        "--name", f"vantage-backend-{target_triple}",
        "--distpath", output_dir,
        "--workpath", os.path.join(project_root, "desktop", "build", "pyinstaller"),
        "--specpath", os.path.join(project_root, "desktop", "build"),
        "--clean",
        "--noconfirm",
    ]

    # Windows: hide the console window so no blank terminal flashes on launch.
    # Logs are written to a file by uvicorn instead of stdout.
    if is_windows:
        cmd.append("--noconsole")

    for imp in hidden_imports:
        cmd.extend(["--hidden-import", imp])

    # Bundle data files the backend needs at runtime
    sep = os.pathsep
    alembic_dir = os.path.join(backend_dir, "alembic")
    alembic_ini = os.path.join(backend_dir, "alembic.ini")
    env_template = os.path.join(backend_dir, ".env.template")

    if os.path.isdir(alembic_dir):
        cmd.extend(["--add-data", f"{alembic_dir}{sep}alembic"])
    if os.path.isfile(alembic_ini):
        cmd.extend(["--add-data", f"{alembic_ini}{sep}."])
    if os.path.isfile(env_template):
        cmd.extend(["--add-data", f"{env_template}{sep}."])

    # Entry point
    cmd.append(os.path.join(backend_dir, "api.py"))

    print(f"\nRunning PyInstaller...")
    result = subprocess.run(cmd, cwd=backend_dir)

    if result.returncode != 0:
        print("\nERROR: PyInstaller build FAILED")
        sys.exit(1)

    # With --onedir the exe lives inside a subdirectory
    output_path = os.path.join(output_dir, f"vantage-backend-{target_triple}", output_name)
    if os.path.exists(output_path):
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f"\nSUCCESS: Built {output_name} ({size_mb:.1f} MB)")
        print(f"  Location: {output_path}")
    else:
        print(f"\nERROR: Expected output not found: {output_path}")
        sys.exit(1)


if __name__ == "__main__":
    main()
