import pathlib
import sys
import unittest

SCRIPTS = pathlib.Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import weekly_projection_engine as engine


class WeeklyProjectionEngineTests(unittest.TestCase):
    def test_future_week_never_enters_projection(self):
        player = {"name": "Test Runner", "position": "RB", "team": "BUF", "projected_points": 170, "expected_games": 16, "identity_confidence": 100, "projection_confidence": 80}
        past = [{"player_display_name": "Test Runner", "position": "RB", "season": 2025, "week": 1, "fantasy_points": 10, "receptions": 2, "carries": 15}]
        future = {"player_display_name": "Test Runner", "position": "RB", "season": 2026, "week": 2, "fantasy_points": 100, "receptions": 10, "carries": 40}
        first = engine.build([player], {"weekly": past}, 2026, 1)[0]
        second = engine.build([player], {"weekly": past + [future]}, 2026, 1)[0]
        self.assertEqual(first["projected_points"], second["projected_points"])
        self.assertEqual(first["evidence_cutoff"], "before 2026 week 1")

    def test_injury_probability_and_distribution_are_explicit(self):
        player = {"name": "Test Receiver", "position": "WR", "team": "KC", "projected_points": 200, "expected_games": 16}
        rows = [{"player_display_name": "Test Receiver", "position": "WR", "season": 2025, "week": week, "fantasy_points": 10, "receptions": 4, "targets": 7} for week in range(1, 7)]
        injuries = [{"player_name": "Test Receiver", "position": "WR", "season": 2025, "week": 18, "report_status": "Questionable"}]
        result = engine.build([player], {"weekly": rows, "injuries": injuries}, 2026, 1)[0]
        self.assertEqual(result["availability_probability"], 0.78)
        self.assertLessEqual(result["distribution"]["p10"], result["distribution"]["p50"])
        self.assertGreaterEqual(result["distribution"]["p90"], result["distribution"]["p50"])


if __name__ == "__main__":
    unittest.main()
