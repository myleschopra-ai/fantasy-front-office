import pathlib
import sys
import unittest

SCRIPTS = pathlib.Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import open_projection_engine as engine


class OpenProjectionEngineTests(unittest.TestCase):
    def test_history_is_recency_weighted_and_scoring_is_consistent(self):
        players = [{"name": "Alpha Runner", "position": "RB", "position_rank": 12}]
        rows = [
            {"player_display_name": "Alpha Runner", "position": "RB", "season": 2025, "games": 16, "fantasy_points": 200, "receptions": 50},
            {"player_display_name": "Alpha Runner", "position": "RB", "season": 2024, "games": 16, "fantasy_points": 150, "receptions": 40},
        ]
        result = engine.build_for_players(players, rows, 2026)["alpha runner|RB"]
        self.assertEqual(result["projection_mode"], "OPEN_MODEL_PROJECTION")
        self.assertGreater(result["points_ppr"], result["points_half"])
        self.assertAlmostEqual(result["points_half"] - result["points"], result["stats"]["rec"] * 0.5, delta=0.1)
        self.assertGreaterEqual(result["projection_confidence"], 70)
        self.assertEqual(result["evidence_seasons"], [2025, 2024])

    def test_no_history_uses_conservative_labeled_prior(self):
        result = engine.project_player({"name": "Rookie Receiver", "position": "WR", "position_rank": 60}, {}, 2026)
        self.assertEqual(result["projection_confidence"], 42)
        self.assertIn("no usable NFL history", result["evidence"])
        self.assertGreater(result["points_ppr"], result["points"])


if __name__ == "__main__":
    unittest.main()
