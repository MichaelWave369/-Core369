"""P2 CPU-only science checks; CUDA is optional and never faked."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import statistics
import unittest

HERE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("photonics_p2", HERE / "scripts" / "photonics-p2.py")
P2 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P2)


class P2Checks(unittest.TestCase):
    def test_deterministic_projection_task_and_shuffle(self):
        a = P2.data_for_task("temporal_xor", 64, 8, 369)
        b = P2.data_for_task("temporal_xor", 64, 8, 369)
        for x, y in zip(a, b):
            P2.torch.testing.assert_close(x, y)
        _, first, _ = P2.data_for_task("first_pulse_memory", 64, 8, 369)
        self.assertEqual(tuple(first.shape), (64,))
        self.assertFalse(P2.torch.equal(first, a[1]))

    def test_cpu_has_two_tasks_and_no_imaginary_cuda(self):
        report = P2.experiment(samples=64, steps=8, nodes=8,
                               repeats=3, seed=369, device="cpu")
        self.assertEqual(report["schema"], P2.SCHEMA)
        self.assertFalse(report["hardware"]["actual_optical_device"])
        self.assertFalse(report["hardware"]["power_measured"])
        self.assertEqual(report["protocol"]["methods"], list(P2.P1.CPU_METHODS))
        self.assertEqual(list(report["tasks"]), list(P2.TASKS))
        for task in P2.TASKS:
            rows = report["tasks"][task]["runs"]
            self.assertEqual(len(rows), 3)
            for i, run in enumerate(rows):
                self.assertEqual(run["seed"], 369+i)
                self.assertEqual(sorted(run["method_execution_order"]),
                                 sorted(P2.P1.CPU_METHODS))
                for method in P2.P1.CPU_METHODS:
                    result = run["methods"][method]
                    self.assertEqual(result["held_out_samples"], 16)
                    self.assertIsNone(result["peak_incremental_cuda_allocated_bytes"])
                    self.assertTrue(0 <= result["accuracy"] <= 1)
            delta = report["tasks"][task]["paired_comparisons"][0]
            observed = [
                r["methods"]["cpu_tanh"]["wall_ms"] -
                r["methods"]["cpu_sine"]["wall_ms"] for r in rows
            ]
            self.assertAlmostEqual(delta["median_candidate_minus_baseline_ms"],
                                   statistics.median(observed), places=3)
            lo, hi = delta["exploratory_bootstrap_95pct_median_delta_ms"]
            self.assertLessEqual(lo, hi)
            self.assertGreaterEqual(lo, min(observed) - .001)
            self.assertLessEqual(hi, max(observed) + .001)

    def test_invalid_options_rejected(self):
        for settings in ({"samples":12}, {"repeats":2}, {"repeats":13},
                         {"ridge":float("nan")}, {"nodes":2}):
            with self.assertRaises(ValueError):
                P2.experiment(device="cpu", **settings)

    def test_known_percentile(self):
        self.assertEqual(P2.percentile([1,2,3], .5), 2)
        self.assertAlmostEqual(P2.percentile([1,2,3], .25), 1.5)


if __name__ == "__main__":
    unittest.main()
