#!/usr/bin/env python
"""Convenience launcher to start FastAPI backend without wrestling with PYTHONPATH.
Usage (from project root):
    python run_server.py --port 8030
Optional args:
    --host 0.0.0.0  (default 127.0.0.1)
The script prepends the 'sports-ai' directory to sys.path so 'backend.app' becomes importable
even though the folder contains a hyphen.
"""
from __future__ import annotations
import sys, argparse, pathlib, importlib, traceback, textwrap, os
# Load .env automatically so env vars in project root are available to the app
try:
    from dotenv import load_dotenv
    load_dotenv(str(pathlib.Path(__file__).parent.resolve() / '.env'))
except Exception:
    # python-dotenv may not be installed in the active environment; fallback to no-op
    pass

# Set AllSports API key if not already set
os.environ.setdefault('ALLSPORTS_API_KEY', '7fa5fdc7782679128be269bc63d1038a36b8d1d657884cf2d91e6833e57d46a9')

import uvicorn

ROOT = pathlib.Path(__file__).parent.resolve()
SPORTS_DIR = ROOT / "sports-ai"
if not SPORTS_DIR.exists():
    print("ERROR: Expected directory 'sports-ai' not found next to run_server.py")
    sys.exit(1)
# Ensure sports-ai root on path so 'backend' is importable as top-level package
sys.path.insert(0, str(SPORTS_DIR))

# Quick sanity: locate backend/app/main.py
main_mod_path = SPORTS_DIR / "backend" / "app" / "main.py"
if not main_mod_path.exists():
    print("ERROR: backend/app/main.py not found under sports-ai")
    sys.exit(1)

parser = argparse.ArgumentParser()
parser.add_argument("--host", default="127.0.0.1")
parser.add_argument("--port", type=int, default=8000)
parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
parser.add_argument("--debug", action="store_true", help="Print extra diagnostics for import issues")
args = parser.parse_args()

module_str = "backend.app.main"
try:
    mod = importlib.import_module(module_str)
except Exception as e:
    print(f"Import failed for {module_str}: {e}")
    if args.debug:
        print("\n=== DEBUG INFO ===")
        print(f"Python: {sys.executable}")
        print(f"Version: {sys.version}")
        print("CWD:", os.getcwd())
        print("Project ROOT:", ROOT)
        print("sports-ai path added?:", str(SPORTS_DIR) in sys.path)
        print("sys.path (first 10):")
        for p in sys.path[:10]:
            print("  ", p)
        print("\nTraceback:")
        traceback.print_exc()
        print("\nIf this import keeps failing, run with: python run_server.py --debug and share output.")
    sys.exit(1)

app = getattr(mod, "app", None)
if app is None:
    print("ERROR: 'app' not found in backend.app.main")
    sys.exit(1)

if args.debug:
    print("Loaded module:", mod)
    print("Found app object:", app)
    print("Environment minimal check: fastapi version loaded OK")
    # Show relevant env vars (mask API key partially)
    api_key = os.environ.get('API_KEY') or os.environ.get('API_FOOTBALL_KEY')
    base_url = os.environ.get('BASE_URL')
    if api_key:
        masked = api_key[:4] + '...' + api_key[-4:]
    else:
        masked = '<not set>'
    print(f"API_KEY: {masked}")
    print(f"BASE_URL: {base_url}")

print(f"Starting server on http://{args.host}:{args.port} (reload={args.reload})")
try:
    uvicorn.run(app, host=args.host, port=args.port, reload=args.reload)
except Exception as e:
    print("Uvicorn failed to start:", e)
    if args.debug:
        traceback.print_exc()
    sys.exit(1)