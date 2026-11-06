"""Photonics P1 CPU smoke and optional GPU agreement tests."""
from __future__ import annotations

import importlib.util
import pathlib
import unittest

import torch

BASE = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "photonics_p1", BASE / "scripts" / "photonics-p1.py"
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class PhotonicsP1Tests(unittest.TestCase):
    def test_projection_deterministic(self):
        torch.testing.assert_close(
            module.projection_for(12, 369),
            module.projection_for(12, 369)
        )

    def test_cpu_report_is_bounded_and_comparable(self):
        report = module.experiment(samples=128, steps=12, nodes=16,
                                   repeats=2, device="cpu")
        self.assertEqual(report["schema"], module.SCHEMA)
        self.assertEqual(report["source"], "measured-local-pytorch-digital")
        self.assertFalse(report["hardware"]["actual_optical_device"])
        self.assertFalse(report["hardware"]["power_measured"])
        self.assertEqual(report["protocol"]["method_order"], list(module.CPU_METHODS))
        self.assertEqual(len(report["runs"]), 2)
        for run in report["runs"]:
            for method in module.CPU_METHODS:
                result = run["methods"][method]
                self.assertEqual(result["route"], ["cpu", "cpu", "cpu"])
                self.assertEqual(result["transfer_bytes"], 0)
                self.assertIsNone(result["peak_incremental_cuda_allocated_bytes"])
                self.assertTrue(0 <= result["accuracy"] <= 1)
                self.assertEqual(result["held_out_samples"], 32)
                confusion = result["confusion_actual_rows_predicted_columns"]
                self.assertEqual(sum(sum(row) for row in confusion), 32)
                self.assertAlmostEqual(
                    (confusion[0][0] + confusion[1][1]) / 32,
                    result["accuracy"], places=5)
                self.assertGreaterEqual(result["wall_ms"], 0)

    def test_invalid_bounds_rejected(self):
        for config in (
            {"samples": 32}, {"nodes": 0}, {"steps": 100},
            {"repeats": 11}, {"ridge": float("nan")}
        ):
            with self.assertRaises(ValueError):
                module.experiment(device="cpu", **config)

    @unittest.skipUnless(torch.cuda.is_available(), "GPU/CUDA unavailable on CI")
    def test_gpu_hybrid_feature_agreement(self):
        report = module.experiment(samples=128, steps=8, nodes=8,
                                   repeats=1, device="cuda")
        self.assertEqual(report["protocol"]["method_order"], list(module.ALL_METHODS))
        r = report["runs"][0]["methods"]
        for name in module.CUDA_METHODS:
            self.assertEqual(r[name]["route"][0], "cuda")
            self.assertLess(r[name]["max_abs_feature_drift_from_cpu"], .02)
            self.assertGreater(r[name]["transfer_bytes"], 0)
        self.assertEqual(r["hybrid_cuda_cpu_cuda_sine"]["route"],
                         ["cuda", "cpu", "cuda"])


if __name__ == "__main__":
    unittest.main()
