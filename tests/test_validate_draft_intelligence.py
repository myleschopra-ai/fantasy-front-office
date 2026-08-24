import importlib.util
import json
import pathlib
import unittest


MODULE_PATH = pathlib.Path(__file__).parents[1] / "scripts" / "validate_draft_intelligence.py"
SPEC = importlib.util.spec_from_file_location("draft_validator", MODULE_PATH)
validator = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(validator)


class DraftIntelligenceValidationReportTests(unittest.TestCase):
    def test_report_preserves_actionable_source_and_coverage_failures(self):
        fixture = pathlib.Path(__file__).parents[1] / "data" / "draft_intelligence.json"
        report = validator.build_report(fixture, ["projection coverage incomplete"], 7)
        self.assertEqual(report["status"], "failed")
        self.assertIn("projection coverage incomplete", report["errors"])
        self.assertGreaterEqual(report["source_summary"]["total"], 1)
        self.assertTrue(report["projection_coverage"])


if __name__ == "__main__":
    unittest.main()
