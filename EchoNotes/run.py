"""
EchoNotes launcher — starts the Python backend and Electron app together.
Usage: python run.py
"""
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

# Force UTF-8 so emoji/box-drawing render on Windows Terminal
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT     = Path(__file__).parent
BACKEND  = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV     = BACKEND / ".venv"
PYTHON   = VENV / "Scripts" / "python.exe"
UVICORN  = VENV / "Scripts" / "uvicorn.exe"

CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


def banner():
    print(f"""
{CYAN}{BOLD}
  ███████╗ ██████╗██╗  ██╗ ██████╗     ███╗   ██╗ ██████╗ ████████╗███████╗███████╗
  ██╔════╝██╔════╝██║  ██║██╔═══██╗    ████╗  ██║██╔═══██╗╚══██╔══╝██╔════╝██╔════╝
  █████╗  ██║     ███████║██║   ██║    ██╔██╗ ██║██║   ██║   ██║   █████╗  ███████╗
  ██╔══╝  ██║     ██╔══██║██║   ██║    ██║╚██╗██║██║   ██║   ██║   ██╔══╝  ╚════██║
  ███████╗╚██████╗██║  ██║╚██████╔╝    ██║ ╚████║╚██████╔╝   ██║   ███████╗███████║
  ╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝     ╚═╝  ╚═══╝ ╚═════╝    ╚═╝   ╚══════╝╚══════╝
{RESET}""")


def log(icon: str, msg: str, color: str = RESET):
    print(f"  {color}{icon}  {msg}{RESET}")


def setup():
    if not VENV.exists():
        log("📦", "Creating virtual environment...", YELLOW)
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)

    needs_install = subprocess.run(
        [str(PYTHON), "-c", "import faster_whisper, fastapi, asyncpg, dotenv"],
        capture_output=True,
    ).returncode != 0

    if needs_install:
        log("⬇️ ", "Installing backend dependencies (first run — may take a minute)...", YELLOW)
        subprocess.run(
            [str(PYTHON), "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt")],
            check=True,
        )
        log("✅", "Dependencies installed.", GREEN)


def wait_for_backend(timeout: int = 300) -> bool:
    url = "http://127.0.0.1:8000/health"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            response = urllib.request.urlopen(url, timeout=2)
            if response.getcode() == 200:
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def main():
    # Enable ANSI colors on Windows
    import os
    os.system("")

    banner()

    print(f"  {BOLD}{'─' * 64}{RESET}")
    log("🔧", "Running setup checks...", YELLOW)
    setup()
    log("✅", "Setup complete.", GREEN)
    print(f"  {BOLD}{'─' * 64}{RESET}\n")

    # ── Start backend ────────────────────────────────────────────
    log("🚀", "Starting FastAPI backend on http://127.0.0.1:8000 ...", CYAN)
    if not UVICORN.exists():
        log("❌", f"uvicorn not found at {UVICORN}. Run setup first.", RED)
        sys.exit(1)
    backend = subprocess.Popen(
        [str(UVICORN), "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=str(BACKEND),
        env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"},
    )
    time.sleep(0.5)
    if backend.poll() is not None:
        log("❌", "Backend process exited immediately. Check logs above.", RED)
        sys.exit(1)

    # ── Start Electron immediately ───────────────────────────────
    log("🖥️ ", "Launching EchoNotes window...", CYAN)
    electron = subprocess.Popen(
        "npm run start:desktop",
        cwd=str(FRONTEND),
        shell=True,
    )

    # ── Wait for backend health (background monitor) ─────────────
    log("⏳", "Waiting for backend to become ready...", YELLOW)
    if wait_for_backend():
        log("✅", "Backend is ready — all systems go!", GREEN)
    else:
        log("❌", "Backend did not respond in time. Check logs above.", RED)
        electron.terminate()
        backend.terminate()
        sys.exit(1)

    print(f"\n  {GREEN}{BOLD}{'─' * 64}")
    print(f"  🎙️   EchoNotes is running!")
    print(f"  {'─' * 64}{RESET}\n")

    # ── Wait for Electron to close ───────────────────────────────
    try:
        electron.wait()
    finally:
        log("🛑", "Electron closed — shutting down backend...", YELLOW)
        backend.terminate()
        try:
            backend.wait(timeout=10)
        except subprocess.TimeoutExpired:
            backend.kill()
        log("👋", "EchoNotes stopped. Goodbye!", CYAN)


if __name__ == "__main__":
    main()
