import sys, os, json
sys.path.insert(0, r'c:\Users\lnipu\Projects\Sports-Analysis\sports-ai')
# Ensure env var present before importing module that reads it
os.environ.setdefault('ALLSPORTS_API_KEY', '7fa5fdc7782679128be269bc63d1038a36b8d1d657884cf2d91e6833e57d46a9')
from backend.app.agents.game_analytics_agent import allsports_client
r = allsports_client.livescore()
print('success=', r.get('success'), ' result_len=', len(r.get('result') or []))
print(json.dumps(r, indent=2)[:4000])
