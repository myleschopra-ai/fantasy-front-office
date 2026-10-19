import json
import pathlib
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone

SCRIPTS = pathlib.Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import league_watcher as watcher

POLICY = watcher.load_policy()
START = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)


class AlertRuleTests(unittest.TestCase):
    def test_policy_comes_from_config(self):
        config = json.loads((SCRIPTS.parent / "config" / "decision_policy.json").read_text())["alerts"]
        for key, value in watcher.DEFAULT_ALERT_POLICY.items():
            self.assertEqual(config[key], value)

    def test_small_moves_on_big_values_and_any_move_on_tiny_values_are_ignored(self):
        self.assertEqual(watcher.trend_decision(8221, 62, None, START, POLICY)[0], None, "Puka +62 is under 1% of value")
        self.assertEqual(watcher.trend_decision(234, 81, None, START, POLICY)[0], None, "a 234-value player is not material")
        self.assertEqual(watcher.trend_decision(579, 231, None, START, POLICY)[0], "SELL HIGH")
        self.assertEqual(watcher.trend_decision(2655, -260, None, START, POLICY)[0], "RISK")

    def test_hysteresis_and_cooldown_block_flip_flops(self):
        flag, record = watcher.trend_decision(1000, 120, None, START, POLICY)
        self.assertEqual(flag, "SELL HIGH")
        flag, record = watcher.trend_decision(1000, -120, record, START + timedelta(days=2), POLICY)
        self.assertIsNone(flag, "no reverse flag inside the cooldown")
        flag, record = watcher.trend_decision(1000, 90, record, START + timedelta(days=8), POLICY)
        self.assertIsNone(flag, "still in the same excursion: never fell under the re-arm level")
        flag, record = watcher.trend_decision(1000, 20, record, START + timedelta(days=9), POLICY)
        self.assertIsNone(flag)
        self.assertTrue(record["armed"])
        flag, record = watcher.trend_decision(1000, -100, record, START + timedelta(days=10), POLICY)
        self.assertEqual(flag, "RISK", "re-armed and past the cooldown")

    def test_legacy_string_state_is_upgraded(self):
        flag, record = watcher.trend_decision(1500, -200, "RISK", START, POLICY)
        self.assertIsNone(flag, "a legacy flag counts as already alerted")
        self.assertFalse(record["armed"])

    def test_risers_need_real_value_and_a_big_move(self):
        self.assertFalse(watcher.riser_decision(95, 96, None, START, POLICY)[0])
        self.assertFalse(watcher.riser_decision(1500, 68, None, START, POLICY)[0])
        alert, record = watcher.riser_decision(1037, 783, None, START, POLICY)
        self.assertTrue(alert)
        self.assertFalse(watcher.riser_decision(1037, 790, record, START + timedelta(days=3), POLICY)[0])

    def test_digest_sends_once_per_day_after_the_digest_hour(self):
        state = {"digest_queue": [{"title": "a", "message": "b"}]}
        morning = datetime(2026, 10, 2, 8, tzinfo=timezone.utc)
        self.assertFalse(watcher.digest_due(state, morning, POLICY))
        self.assertTrue(watcher.digest_due(state, morning.replace(hour=14), POLICY))
        state["last_digest_date"] = "2026-10-02"
        self.assertFalse(watcher.digest_due(state, morning.replace(hour=20), POLICY))
        self.assertIn("…and 2 more", watcher.digest_message([{"title": str(i), "message": "m"} for i in range(14)]))

    def test_replaying_the_old_alert_stream_cuts_noise(self):
        history = json.loads((SCRIPTS.parent / "watcher_state.json").read_text()).get("history", [])
        pattern = re.compile(r"trending ([+-]\d+) over 30 days \(value (\d+)\)")
        records, alerts = {}, []
        for item in history:
            title = item.get("title", "")
            if not (title.startswith("RISK:") or title.startswith("SELL HIGH:")):
                continue
            match = pattern.search(item.get("message", ""))
            if not match:
                continue
            name = title.split(": ", 1)[1]
            when = watcher.parse_time(item["timestamp"])
            flag, records[name] = watcher.trend_decision(int(match.group(2)), int(match.group(1)), records.get(name), when, POLICY)
            if flag:
                alerts.append((name, flag, when))
        old = sum(1 for item in history if item.get("title", "").startswith(("RISK:", "SELL HIGH:")))
        if old:
            self.assertLess(len(alerts), old / 4, f"{len(alerts)} alerts would replace {old}")
        for name in {alert[0] for alert in alerts}:
            mine = sorted((alert for alert in alerts if alert[0] == name), key=lambda alert: alert[2])
            for first, second in zip(mine, mine[1:]):
                self.assertGreaterEqual(second[2] - first[2], timedelta(days=7), f"{name} alerted twice within 7 days")


if __name__ == "__main__":
    unittest.main()
