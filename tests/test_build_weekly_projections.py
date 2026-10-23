import sys
import tempfile
import unittest
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as parquet

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_weekly_projections as builder  # noqa: E402
from weekly_projection_engine import index_rows, lookup  # noqa: E402

SCHEDULES = [
    {"season": 2026, "week": 1, "gameday": "2026-09-10", "home_team": "CIN", "away_team": "CLE"},
    {"season": 2026, "week": 1, "gameday": "2026-09-13", "home_team": "BUF", "away_team": "MIA"},
    {"season": 2026, "week": 2, "gameday": "2026-09-17", "home_team": "CIN", "away_team": "BAL"},
    {"season": 2026, "week": 3, "gameday": "2026-09-24", "home_team": "PIT", "away_team": "CIN"},
]
PLAYER = {"name": "Test Receiver", "position": "WR", "source_ids": {"gsis": "00-1"}}


def write(path: Path, rows: list[dict]) -> Path:
    parquet.write_table(pa.Table.from_pylist(rows), path)
    return path


def chart(dt: str, rank: int, gsis: str = "00-1", group: str = "3WR 1TE", slot: str = "WR") -> dict:
    return {"dt": dt, "team": "CIN", "player_name": "Test Receiver", "espn_id": "1", "gsis_id": gsis,
            "pos_grp_id": "x", "pos_grp": group, "pos_id": "x", "pos_name": slot, "pos_abb": slot,
            "pos_slot": 1, "pos_rank": rank}


class DepthChartLoaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_timestamp_only_format_loads_and_respects_the_week_cutoff(self):
        # Written out of date order on purpose: nflverse files are not sorted.
        path = write(self.dir / "depth.parquet", [
            chart("2026-09-20T12:00:00Z", 1),   # week 2 under way -> week 2
            chart("2026-09-08T12:00:00Z", 3),   # before week 1 -> week 0
            chart("2026-09-15T12:00:00Z", 2),   # after week 1 games -> week 1
            chart("2026-09-25T12:00:00Z", 1),   # week 3 under way -> week 3
            chart("2026-09-08T12:00:00Z", 1, gsis="00-other"),
        ])
        rows = builder.load_depth_for_players(path, [PLAYER], SCHEDULES)
        self.assertEqual({row["gsis_id"] for row in rows}, {"00-1"})
        self.assertEqual([(row["season"], row["week"]) for row in rows], [(2026, 0), (2026, 1), (2026, 2), (2026, 3)])
        self.assertEqual([row["pos_rank"] for row in lookup(index_rows(rows, 2026, 1), PLAYER)], [3])
        self.assertEqual(lookup(index_rows(rows, 2026, 2), PLAYER)[-1]["pos_rank"], 2)
        self.assertEqual(lookup(index_rows(rows, 2026, 3), PLAYER)[-1]["pos_rank"], 1)

    def test_eastern_shift_keeps_a_late_night_chart_in_the_prior_week(self):
        # 03:00 UTC on Sep 17 is still Sep 16 in the US, before week 2 kicks off.
        path = write(self.dir / "depth.parquet", [chart("2026-09-17T03:00:00Z", 2)])
        self.assertEqual(builder.load_depth_for_players(path, [PLAYER], SCHEDULES)[0]["week"], 1)

    def test_return_slots_do_not_count_as_a_starting_role(self):
        path = write(self.dir / "depth.parquet", [
            chart("2026-09-15T12:00:00Z", 3),
            chart("2026-09-15T12:00:00Z", 1, group="Special Teams", slot="KR"),
            chart("2026-09-15T12:00:00Z", 1, gsis="00-k", group="Special Teams", slot="PK"),
        ])
        rows = builder.load_depth_for_players(path, [PLAYER, {"source_ids": {"gsis": "00-k"}}], SCHEDULES)
        self.assertEqual(sorted((row["gsis_id"], row["pos_abb"]) for row in rows), [("00-1", "WR"), ("00-k", "PK")])

    def test_same_day_multiple_slots_keep_the_best_rank_last(self):
        path = write(self.dir / "depth.parquet", [
            chart("2026-09-15T12:00:00Z", 1),
            chart("2026-09-15T12:00:00Z", 2),
        ])
        rows = builder.load_depth_for_players(path, [PLAYER], SCHEDULES)
        self.assertEqual(lookup(index_rows(rows, 2026, 2), PLAYER)[-1]["pos_rank"], 1)

    def test_legacy_format_keeps_its_own_season_and_week(self):
        path = write(self.dir / "depth.parquet", [
            {"season": 2024, "week": 5, "gsis_id": "00-1", "full_name": "Test Receiver", "position": "WR",
             "depth_team": "1", "dt": None, "team": "CIN", "pos_abb": None, "pos_rank": None},
        ])
        rows = builder.load_depth_for_players(path, [PLAYER], SCHEDULES)
        self.assertEqual([(row["season"], row["week"]) for row in rows], [(2024, 5)])

    def test_without_a_schedule_timestamp_rows_are_dropped_not_leaked(self):
        path = write(self.dir / "depth.parquet", [chart("2026-09-25T12:00:00Z", 1)])
        self.assertEqual(builder.load_depth_for_players(path, [PLAYER], []), [])


if __name__ == "__main__":
    unittest.main()
