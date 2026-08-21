import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dk = load("dk_collector", "scrape_draftkings_season_props.py")
sharp = load("sharp_collector", "collect_sharpapi_season_props.py")
merge = load("vegas_merge", "merge_vegas_quotes.py")
weekly_collector = load("weekly_collector", "collect_sharpapi_weekly_props.py")
weekly_builder = load("weekly_builder", "build_weekly_vegas_projections.py")


class VegasCollectorTests(unittest.TestCase):
    def test_sharp_pagination_switches_from_offset_to_cursor(self):
        pages = [
            {"data": [{"id": 1}], "pagination": {"has_more": True, "next_offset": 200, "next_cursor": "cursor-2"}},
            {"data": [{"id": 2}], "pagination": {"has_more": False}},
        ]
        calls = []
        def fake_page(api_key, base_url, offset=0, limit=200, cursor=None):
            calls.append({"offset": offset, "cursor": cursor})
            return pages[len(calls) - 1]
        with patch.object(sharp, "fetch_page", side_effect=fake_page), patch.object(sharp.time, "sleep"):
            rows, count = sharp.fetch_all_rows("secret", "https://example.test")
        self.assertEqual([row["id"] for row in rows], [1, 2])
        self.assertEqual(count, 2)
        self.assertEqual(calls[0]["cursor"], None)
        self.assertEqual(calls[1]["cursor"], "cursor-2")

    def test_sharp_rate_limit_retries_same_cursor_once(self):
        calls = []
        def fake_page(api_key, base_url, offset=0, limit=200, cursor=None):
            calls.append(cursor)
            if len(calls) == 1:
                raise sharp.SharpRateLimitError(44)
            return {"data": [{"id": 1}], "pagination": {"has_more": False}}
        with patch.object(sharp, "fetch_page", side_effect=fake_page), patch.object(sharp.time, "sleep") as sleeper:
            rows, pages = sharp.fetch_all_rows("secret", "https://example.test")
        self.assertEqual(rows, [{"id": 1}])
        self.assertEqual(calls, [None, None])
        sleeper.assert_called_once_with(44)

    def test_draftkings_discovers_player_season_markets(self):
        payload = {
            "categories": [{"id": 20, "name": "Player Futures"}],
            "subcategories": [
                {"id": 21, "categoryId": 20, "name": "Regular Season Receiving Yards"},
                {"id": 22, "categoryId": 20, "name": "MVP"},
            ],
        }
        self.assertEqual(dk.discover_player_subcategories(payload), [("20", "21", "Regular Season Receiving Yards")])

    def test_draftkings_prefers_main_line(self):
        payload = {
            "markets": [{"id": 1, "name": "NFL 2026/27 - Test WR Regular Season Receiving Yards"}],
            "selections": [
                {"marketId": 1, "label": "Over 900.5", "displayOdds": {"american": "+120"}},
                {"marketId": 1, "label": "Under 900.5", "displayOdds": {"american": "-140"}},
                {"marketId": 1, "label": "Over 1000.5", "displayOdds": {"american": "-110"}, "main": True},
                {"marketId": 1, "label": "Under 1000.5", "displayOdds": {"american": "-110"}, "main": True},
            ],
        }
        rows = dk.parse_feed(payload, "test", "2026-08-21T00:00:00Z")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["line"], 1000.5)

    def test_sharp_rejects_weekly_event_prop(self):
        event = {"player_name": "Test QB", "sportsbook": "draftkings", "market_type": "player_passing_yards", "selection": "Over", "line": 275.5, "odds_american": -110, "event_id": "week-1-game"}
        rows, rejected = sharp.parse_rows([event], "2026-08-21T00:00:00Z")
        self.assertEqual(rows, [])
        self.assertEqual(rejected["not_season_long"], 1)

    def test_merge_deduplicates_book_across_providers(self):
        public = {"provider": "draftkings_public", "quotes": [{"player_key": "test-wr", "book": "DraftKings", "market": "receiving_yards", "line": 900.5, "source_type": "public_undocumented_api", "updated_at": "2026-08-21T12:00:00Z"}]}
        licensed = {"provider": "sharpapi", "quotes": [{"player_key": "test-wr", "book": "DraftKings", "market": "receiving_yards", "line": 925.5, "source_type": "licensed_api", "updated_at": "2026-08-21T11:00:00Z"}]}
        result = merge.merge_payloads([public, licensed])
        self.assertEqual(len(result["quotes"]), 1)
        self.assertEqual(result["quotes"][0]["line"], 925.5)
        self.assertEqual(result["deduplication"]["discarded"], 1)

    def test_weekly_collector_excludes_season_markets(self):
        rows = [
            {"player_name": "Weekly QB", "sportsbook": "draftkings", "market_type": "player_passing_yards", "selection": "Over", "line": 275.5, "odds_american": -110, "event_id": "week-1"},
            {"player_name": "Season QB", "sportsbook": "draftkings", "market_type": "regular_season_player_passing_yards", "selection": "Over", "line": 4000.5, "odds_american": -110, "event_id": "season-future"},
        ]
        quotes, rejected = weekly_collector.parse_weekly_rows(rows, "2026-09-10T00:00:00Z")
        self.assertEqual(len(quotes), 1)
        self.assertEqual(quotes[0]["player_name"], "Weekly QB")
        self.assertEqual(rejected["season_long_excluded"], 1)

    def test_weekly_collector_parses_anytime_touchdown_yes_no(self):
        rows = [
            {"player_name": "Test RB", "sportsbook": "draftkings", "market_type": "anytime_td", "selection": "Yes", "line": None, "odds_american": -125, "event_id": "week-1"},
            {"player_name": "Test RB", "sportsbook": "draftkings", "market_type": "anytime_td", "selection": "No", "line": None, "odds_american": 105, "event_id": "week-1"},
        ]
        quotes, _ = weekly_collector.parse_weekly_rows(rows, "2026-09-10T00:00:00Z")
        self.assertEqual(len(quotes), 1)
        self.assertEqual(quotes[0]["market"], "anytime_touchdown")
        self.assertEqual(quotes[0]["yes_odds"], -125)
        self.assertEqual(quotes[0]["no_odds"], 105)

    def test_weekly_builder_devigs_anytime_touchdown_probability(self):
        baselines = {"players": [{"name": "Test RB", "position": "RB", "projected_points": 15, "stats": {"rush_td": 0.35, "rec_td": 0.05}}]}
        quotes = {"quotes": [{"projection_scope": "weekly", "player_name": "Test RB", "book": "DraftKings", "market": "anytime_touchdown", "line": 0.5, "yes_odds": -125, "no_odds": 105}]}
        result = weekly_builder.build(baselines, quotes, {"rec": 0.5}, cap_pct=0.10)
        player = result["players"][0]
        self.assertGreater(player["adjusted_points"], 15)
        self.assertLessEqual(player["adjusted_points"], 16.5)

    def test_generic_qb_touchdowns_use_passing_td_scoring(self):
        baselines = {"players": [{"name": "Test QB", "position": "QB", "projected_points": 20, "stats": {"pass_td": 1.2}}]}
        quotes = {"quotes": [{"projection_scope": "weekly", "player_name": "Test QB", "book": "FanDuel", "market": "touchdowns", "line": 1.5, "over_odds": -110, "under_odds": -110}]}
        result = weekly_builder.build(baselines, quotes, {"pass_td": 4, "rec": 0.5}, cap_pct=0.10)
        detail = result["players"][0]["market_detail"]["touchdowns"]
        self.assertEqual(detail["fantasy_point_rate"], 4)
        self.assertEqual(detail["point_delta"], 1.2)
        self.assertEqual(result["players"][0]["market_label"], "single_book_signal")

    def test_weekly_builder_replaces_only_supported_components_and_caps(self):
        baselines = {"players": [{"name": "Test QB", "position": "QB", "projected_points": 20, "stats": {"pass_yds": 250, "pass_td": 2}}]}
        quotes = {"quotes": [
            {"projection_scope": "weekly", "player_name": "Test QB", "book": "DraftKings", "market": "passing_yards", "line": 300},
            {"projection_scope": "weekly", "player_name": "Test QB", "book": "FanDuel", "market": "passing_yards", "line": 290},
        ]}
        result = weekly_builder.build(baselines, quotes, {"pass_td": 4, "pass_int": -2, "rec": 0.5}, cap_pct=0.10)
        player = result["players"][0]
        self.assertEqual(player["raw_market_delta"], 1.8)
        self.assertEqual(player["adjusted_points"], 21.8)
        self.assertNotIn("passing_touchdowns", player["market_detail"])


if __name__ == "__main__":
    unittest.main()
