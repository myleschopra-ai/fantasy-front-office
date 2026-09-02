import pathlib
import sys
import unittest

SCRIPTS = pathlib.Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import build_rookie_profiles as rookies


class RookieProfileTests(unittest.TestCase):
    def test_draft_capital_is_used_without_fabricating_college_grade(self):
        identity = {"players": [{"player_key": "gsis:1", "name": "Rookie One", "position": "WR", "college": "Example", "age": 21.5}]}
        draft = [{"season": 2026, "player_name": "Rookie One", "position": "WR", "round": 1, "pick": 12, "team": "BUF"}]
        combine = [{"player_name": "Rookie One", "pos": "WR", "forty": 4.35, "vertical": 39}]
        result = rookies.build(identity, draft, combine, 2026)["players"][0]
        self.assertGreater(result["draft_capital_score"], 90)
        self.assertIsNotNone(result["athletic_score"])
        self.assertIsNone(result["college_production_score"])


if __name__ == "__main__":
    unittest.main()
