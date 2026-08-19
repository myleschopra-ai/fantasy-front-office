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

    def test_role_signals_are_bounded_and_exclude_target_season(self):
        player = {"name": "Signal Receiver", "position": "WR", "position_rank": 40}
        history = [{"player_display_name": "Signal Receiver", "position": "WR", "season": 2024, "games": 16, "fantasy_points": 120, "receptions": 50}]
        opportunity = [
            {"player_display_name": "Signal Receiver", "position": "WR", "season": 2024, "week": week, "expected_fantasy_points": 5 if week <= 6 else 10}
            for week in range(1, 13)
        ] + [
            {"player_display_name": "Signal Receiver", "position": "WR", "season": 2025, "week": 18, "expected_fantasy_points": 1000}
        ]
        result = engine.build_for_players([player], history, 2025, {"opportunity": opportunity})["signal receiver|WR"]
        self.assertEqual(result["role_signals"]["opportunity_delta"], 0.25)
        self.assertLessEqual(abs(result["role_signals"]["adjustment"]), 0.15)
        self.assertTrue(any("expected-opportunity" in item for item in result["role_signal_evidence"]))

    def test_future_production_never_enters_walk_forward_projection(self):
        player = {"name": "No Lookahead", "position": "RB", "position_rank": 20}
        rows = [
            {"player_display_name": "No Lookahead", "position": "RB", "season": 2024, "games": 16, "fantasy_points": 100, "receptions": 20},
            {"player_display_name": "No Lookahead", "position": "RB", "season": 2025, "games": 16, "fantasy_points": 500, "receptions": 100},
        ]
        with_future = engine.build_for_players([player], rows, 2025)["no lookahead|RB"]
        without_future = engine.build_for_players([player], rows[:1], 2025)["no lookahead|RB"]
        self.assertEqual(with_future["points_half"], without_future["points_half"])


if __name__ == "__main__":
    unittest.main()
