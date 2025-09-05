import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]  # repo root
SA = ROOT / "sports-ai"
if str(SA) not in sys.path:
    sys.path.insert(0, str(SA))
