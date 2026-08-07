import importlib.util
import json
import pathlib
import tempfile
import unittest


MODULE_PATH = pathlib.Path(__file__).parents[1] / "scripts" / "refresh_fantasypros.py"
SPEC = importlib.util.spec_from_file_location("fantasypros_refresh", MODULE_PATH)
refresh = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(refresh)


class FantasyProsRefreshTests(unittest.TestCase):
    def test_compact_ranking_preserves_overall_and_position_fields(self):
        row = refresh.compact_ranking(
            {
                "player_id": 42,
                "player_name": "Example Player",
                "player_team_id": "BUF",
                "player_position_id": "QB",
                "rank_ecr": 3,
                "pos_rank": 1,
                "tier": 1,
                "rank_min": 1,
                "rank_max": 7,
                "rank_std": 1.4,
            }
        )
        self.assertEqual(row["rank"], 3)
        self.assertEqual(row["pos_rank"], 1)
        self.assertEqual(row["position"], "QB")
        self.assertEqual(row["rank_min"], 1)
        self.assertEqual(row["rank_max"], 7)

    def test_validation_fails_closed_on_incomplete_overall_board(self):
        snapshot = {
            "season": refresh.SEASON,
            "scoring": refresh.SCORING,
            "rankings": {key: [] for key in refresh.MINIMUM_RANKINGS},
        }
        with self.assertRaisesRegex(ValueError, "OVERALL ranking count"):
            refresh.validate_snapshot(snapshot)

    def test_atomic_write_replaces_snapshot_with_valid_json(self):
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / "snapshot.json"
            output.write_text('{"old":true}\n', encoding="utf-8")
            refresh.atomic_write({"schema_version": 2, "ready": True}, output)
            self.assertEqual(
                json.loads(output.read_text(encoding="utf-8")),
                {"schema_version": 2, "ready": True},
            )


if __name__ == "__main__":
    unittest.main()
