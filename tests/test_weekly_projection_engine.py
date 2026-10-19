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
        # The target week's own pre-game report sets availability (see DECISION_LOG 2026-10-19).
        injuries = [{"player_name": "Test Receiver", "position": "WR", "season": 2026, "week": 1, "report_status": "Questionable"}]
        result = engine.build([player], {"weekly": rows, "injuries": injuries}, 2026, 1)[0]
        self.assertEqual(result["availability_probability"], 0.78)
        self.assertLessEqual(result["distribution"]["p10"], result["distribution"]["p50"])
        self.assertGreaterEqual(result["distribution"]["p90"], result["distribution"]["p50"])


    def test_stale_report_from_an_earlier_week_is_ignored(self):
        player = {"name": "Test Back", "position": "RB", "team": "KC", "projected_points": 200, "expected_games": 16}
        rows = [{"player_display_name": "Test Back", "position": "RB", "season": 2026, "week": week, "fantasy_points": 12, "receptions": 2, "carries": 15} for week in range(1, 5)]
        injuries = [{"player_name": "Test Back", "position": "RB", "season": 2026, "week": 2, "report_status": "Out"}]
        result = engine.build([player], {"weekly": rows, "injuries": injuries}, 2026, 6)[0]
        self.assertEqual(result["availability_probability"], 0.96, "a week 2 'Out' says nothing about week 6")
        self.assertGreater(result["projected_points"], 5)

    def test_reserve_list_and_bye_zero_the_week_but_keep_base_points(self):
        player = {"name": "Test End", "position": "TE", "team": "BUF", "projected_points": 150, "expected_games": 16, "source_ids": {"gsis": "00-1"}}
        weekly = [{"player_id": "00-1", "player_display_name": "Test End", "position": "TE", "season": 2026, "week": week, "fantasy_points": 9, "receptions": 5, "targets": 7} for week in range(1, 5)]
        rosters = [{"gsis_id": "00-1", "season": 2026, "week": 5, "status": "RES", "team": "BUF", "position": "TE"}]
        reserve = engine.build([player], {"weekly": weekly, "rosters": rosters}, 2026, 5)[0]
        self.assertEqual(reserve["projected_points"], 0)
        self.assertEqual(reserve["unavailable_reason"], "ROSTER_RES")
        self.assertGreater(reserve["base_points"], 5)
        self.assertEqual(reserve["ros_points"], 0)
        schedules = [{"season": 2026, "week": 5, "home_team": "KC", "away_team": "DEN"}]
        bye = engine.build([player], {"weekly": weekly, "schedules": schedules}, 2026, 5)[0]
        self.assertTrue(bye["bye"])
        self.assertEqual(bye["projected_points"], 0)
        self.assertGreater(bye["ros_points"], 5, "a bye week does not lower rest-of-season strength")

    def test_role_absence_counts_only_healthy_weeks_without_a_game(self):
        player = {"name": "Test Wideout", "position": "WR", "team": "MIA", "projected_points": 150, "expected_games": 16, "source_ids": {"gsis": "00-2"}}
        weekly = [{"player_id": "00-2", "player_display_name": "Test Wideout", "position": "WR", "season": 2026, "week": 1, "fantasy_points": 8, "receptions": 3, "targets": 5}]
        rosters = [{"gsis_id": "00-2", "season": 2026, "week": week, "status": "ACT", "team": "MIA", "position": "WR"} for week in range(1, 6)]
        absent = engine.build([player], {"weekly": weekly, "rosters": rosters}, 2026, 5, {"absent_factor": 0.5})[0]
        self.assertEqual(absent["features"]["role_absent_weeks"], 2)
        injuries = [{"gsis_id": "00-2", "player_display_name": "Test Wideout", "position": "WR", "season": 2026, "week": 4, "report_status": "Out"}]
        hurt = engine.build([player], {"weekly": weekly, "rosters": rosters, "injuries": injuries}, 2026, 5, {"absent_factor": 0.5})[0]
        self.assertEqual(hurt["features"]["role_absent_weeks"], 1, "a week missed while listed out is not a role loss")
        self.assertLess(absent["projected_points"], hurt["projected_points"])


if __name__ == "__main__":
    unittest.main()
