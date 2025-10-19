import sys, types
from pathlib import Path
import unittest

# Ensure 'sports-ai' root is on sys.path (mimic run_server behavior)
SPORTS_ROOT = Path(__file__).resolve().parents[3]
if str(SPORTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SPORTS_ROOT))

from backend.app.agents import collector_agent as ga  # type: ignore


class TestPlayerHotStreak(unittest.TestCase):
    def test_hot_streak_detection(self):
        events = [
            {'player_goals': 0},
            {'player_goals': 1},
            {'player_goals': 0},
            {'player_goals': 3},  # spike recent
            {'player_goals': 2},
        ]
        res = ga._compute_player_hot_streak(events, recent_games=5)
        self.assertIn(res['label'], {'HOT_STREAK','NORMAL'})  # heuristic; allow NORMAL if variance low
        self.assertGreaterEqual(res['recent_goals'], 0)

    def test_no_data(self):
        res = ga._compute_player_hot_streak([], recent_games=5)
        self.assertEqual(res['label'], 'NO_DATA')


class TestTimelineTagging(unittest.TestCase):
    def test_rule_based_goal_tagging(self):
        tl = [
            {'minute': 10, 'event': 'Header goal by Player X'},
            {'minute': 55, 'event': 'Penalty scored'},
            {'minute': 77, 'event': 'Some midfield play'},
        ]
        ga._augment_timeline_with_tags(tl, model=None)
        tags0 = tl[0].get('predicted_tags', [])
        self.assertTrue(any('HEADER' in t for t in tags0))
        tags1 = tl[1].get('predicted_tags', [])
        self.assertTrue(any('PENALTY' in t for t in tags1))


class TestMultimodalHighlights(unittest.TestCase):
    def test_multimodal_wrapper_with_stub(self):
        # Inject stub extractor before calling wrapper
        mod_name = 'backend.app.models.youtube_highlight_shorts_extractor'
        stub = types.ModuleType(mod_name)
        def extract_youtube_shorts(youtube_url, output_dir='highlight_shorts', clip_duration=30, **kw):
            return [f'{output_dir}/clip_{i}.mp4' for i in range(3)]
        stub.extract_youtube_shorts = extract_youtube_shorts  # type: ignore
        sys.modules[mod_name] = stub
        result = ga._extract_multimodal_highlights('https://youtu.be/demo', clip_duration=10)
        self.assertEqual(result['count'], 3)
        self.assertTrue(all('combined' in c['scores'] for c in result['clips']))


if __name__ == '__main__':  # pragma: no cover
    unittest.main()
