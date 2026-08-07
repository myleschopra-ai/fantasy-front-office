import importlib.util
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).parents[1] / "scripts" / "build_draft_intelligence.py"
SPEC = importlib.util.spec_from_file_location("draft_builder", MODULE_PATH)
builder = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(builder)


class DraftIntelligenceBuilderTests(unittest.TestCase):
    def test_staff_parser_uses_structured_cards_not_news_headlines(self):
        html = """
        <h3 class="d3-o-media-object__title">Old Coach arrives as head coach</h3>
        <div class="d3-o-media-object__body">
          <h5 class="d3-o-media-object__roofline">Defensive Coordinator</h5>
          <h3 class="d3-o-media-object__title">Wrong Coordinator</h3>
        </div>
        <div class="d3-o-media-object__body">
          <h3 class="d3-o-media-object__title">Alex Smith</h3>
          <h5 class="d3-o-media-object__roofline">Head Coach</h5>
        </div>
        <div class="d3-o-media-object__body">
          <h5 class="d3-o-media-object__roofline">Offensive Coordinator</h5>
          <h3 class="d3-o-media-object__title">Sam Brown</h3>
        </div>
        <div class="d3-o-media-object__body">
          <h5 class="d3-o-media-object__roofline">Assistant Quarterbacks</h5>
          <h3 class="d3-o-media-object__title">Taylor Green</h3>
        </div>
        <div class="d3-o-media-object__body">
          <h5 class="d3-o-media-object__roofline">Quarterbacks</h5>
          <h3 class="d3-o-media-object__title">Chris White</h3>
        </div>
        """
        staff = builder.parse_staff_html(html)
        self.assertEqual(staff["head_coach"], "Alex Smith")
        self.assertEqual(staff["offensive_coordinator"], "Sam Brown")
        self.assertEqual(staff["position_coaches"]["QB"], "Chris White")

    def test_fantasypros_format_filter_excludes_other_draft_games(self):
        rows = [
            {"page_type": "redraft-overall", "scrape_date": "2026-08-07", "player": "Redraft A"},
            {"page_type": "redraft-op", "scrape_date": "2026-08-07", "player": "Superflex A"},
            {"page_type": "dynasty-overall", "scrape_date": "2026-08-07", "player": "Dynasty A"},
            {"page_type": "best-overall", "scrape_date": "2026-08-07", "player": "Best Ball A"},
            {"page_type": "redraft-overall", "scrape_date": "2026-08-06", "player": "Stale A"},
        ]
        selected = builder.select_fantasypros_rows(rows, "redraft_1qb")
        self.assertEqual([row["player"] for row in selected], ["Redraft A"])

    def test_normalize_name_resolves_suffix_and_punctuation(self):
        self.assertEqual(builder.normalize_name("Patrick Mahomes II"), "patrick mahomes")
        self.assertEqual(builder.normalize_name("De'Von Achane"), "de von achane")

    def test_rank_fusion_outputs_overall_position_and_tiers(self):
        source_a = [
            builder.source_record("fantasycalc", "Alpha Runner", "RB", rank=1, pos_rank=1, value=9000),
            builder.source_record("fantasycalc", "Bravo Receiver", "WR", rank=2, pos_rank=1, value=8500),
            builder.source_record("fantasycalc", "Charlie Runner", "RB", rank=8, pos_rank=2, value=7000),
            builder.source_record("fantasycalc", "Delta Receiver", "WR", rank=9, pos_rank=2, value=6900),
        ]
        source_b = [
            builder.source_record("fantasy_football_calculator", "Bravo Receiver", "WR", rank=1, pos_rank=1, adp=1.2),
            builder.source_record("fantasy_football_calculator", "Alpha Runner", "RB", rank=2, pos_rank=1, adp=2.1),
            builder.source_record("fantasy_football_calculator", "Delta Receiver", "WR", rank=7, pos_rank=2, adp=7.4),
            builder.source_record("fantasy_football_calculator", "Charlie Runner", "RB", rank=8, pos_rank=2, adp=8.2),
        ]
        players = builder.merge_rankings({"fantasycalc": source_a, "fantasy_football_calculator": source_b})
        self.assertEqual([player["overall_rank"] for player in players], [1, 2, 3, 4])
        self.assertTrue(all(player["position_rank"] >= 1 for player in players))
        self.assertTrue(all(player["position_tier"] >= 1 for player in players))
        self.assertTrue(all(player["source_count"] == 2 for player in players))

    def test_scheme_fit_is_bounded_and_transition_lowers_confidence(self):
        players = [{"name": "Alpha Runner", "position": "RB", "team": "BUF"}]
        team_profiles = {
            "BUF": {
                "position_environment": {"QB": 50, "RB": 80, "WR": 50, "TE": 50},
                "metric_percentiles": {"rb_target_share": 75, "red_zone_pass_rate": 30},
                "staff": {"status": "verified"},
                "staff_transition": True,
                "strengths": ["RB receiving usage"],
            }
        }
        usage = {
            "alpha runner|RB": {
                "sample": 200,
                "archetype": ["receiving back", "goal-line runner"],
                "metrics": {"targets": 50, "rushes": 150, "red_zone_rushes": 25},
            }
        }
        builder.attach_scheme_fit(players, team_profiles, usage)
        fit = players[0]["scheme_fit"]
        self.assertGreaterEqual(fit["score"], 0)
        self.assertLessEqual(fit["score"], 100)
        self.assertLess(fit["confidence"], 80)
        self.assertTrue(any("new offensive staff" in reason for reason in fit["reasons"]))


if __name__ == "__main__":
    unittest.main()
