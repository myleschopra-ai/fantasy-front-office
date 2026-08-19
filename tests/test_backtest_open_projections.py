import pathlib
import sys
import unittest

SCRIPTS = pathlib.Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import backtest_open_projections as backtest


class OpenProjectionBacktestTests(unittest.TestCase):
    def test_walk_forward_evaluates_full_middle_and_late_pool(self):
        rows = []
        positions = ["QB", "RB", "WR", "TE"]
        for index in range(160):
            position = positions[index % len(positions)]
            name = f"Backtest Player {index:03d}"
            prior = max(35, 250 - index)
            rows.extend([
                {"player_display_name": name, "position": position, "season": 2024, "games": 16, "fantasy_points": prior, "fantasy_points_ppr": prior + 40, "receptions": 40},
                {"player_display_name": name, "position": position, "season": 2025, "games": 16, "fantasy_points": prior * 0.96, "fantasy_points_ppr": prior * 0.96 + 42, "receptions": 42},
            ])
        result = backtest.evaluate(rows, 2025, {})
        self.assertEqual(result["players"], 160)
        self.assertEqual(result["late_players"], 40)
        self.assertGreater(result["spearman"], 0.8)
        self.assertGreaterEqual(result["late_hit_rate"], 0)
        self.assertLessEqual(result["late_hit_rate"], 1)


if __name__ == "__main__":
    unittest.main()
