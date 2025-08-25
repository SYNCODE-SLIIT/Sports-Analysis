"""
Simple test to verify backend is working
"""
import requests
import json

def test_backend():
    try:
        print("Testing backend connection...")
        response = requests.get("http://localhost:8000/games?date=2025-08-24", timeout=10)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Success! Found {len(data)} games")
            if data:
                print(f"First game: {data[0].get('home_team')} vs {data[0].get('away_team')}")
                print(f"Provider: {data[0].get('provider')}")
        else:
            print(f"❌ Error: {response.status_code} - {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to backend. Is it running on port 8000?")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    test_backend()
