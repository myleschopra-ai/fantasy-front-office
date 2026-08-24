import unittest

from scripts.reconcile_wwpa_decisions import build_report, extract_records


def decision(index, *, locked=True):
    won = index % 2
    return {
        "id": f"decision-{index}",
        "capturedAt": "2026-09-01T12:00:00Z",
        "sourceGeneratedAt": "2026-09-01T11:00:00Z" if locked else "2026-09-01T13:00:00Z",
        "predictedWinRate": 50,
        "outcome": {"won": won, "modelPoints": 2010 + index % 3, "baselinePoints": 2000},
    }


class ForwardDecisionReconciliationTests(unittest.TestCase):
    def test_extracts_session_envelope(self):
        rows = [decision(0)]
        self.assertEqual(extract_records({"payload": {"decisionLedger": {"records": rows}}}), rows)

    def test_promotes_only_when_every_gate_passes(self):
        report = build_report([decision(index) for index in range(120)])
        self.assertEqual(report["status"], "PROMOTION_READY")
        self.assertEqual(report["counts"]["resolved"], 120)
        self.assertAlmostEqual(report["probability"]["expectedCalibrationError"], 0)
        self.assertGreater(report["decisionLift"]["lower95"], 0)

    def test_rejects_leakage_and_small_samples(self):
        rows = [decision(index) for index in range(80)]
        rows[0] = decision(0, locked=False)
        report = build_report(rows)
        self.assertEqual(report["status"], "EVIDENCE_ACCUMULATING")
        self.assertFalse(report["gates"]["minimumResolvedDecisions"])
        self.assertFalse(report["gates"]["allResolvedInputsTimeLocked"])


if __name__ == "__main__":
    unittest.main()
