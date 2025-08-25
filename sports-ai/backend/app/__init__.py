# Make 'app' a package so relative imports in main.py work when launched via uvicorn
from .main import app  # re-export for `uvicorn app:app` convenience
