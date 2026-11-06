"""CPU-only smoke tests for photonics R0 numerical simulation.

Install PyTorch first. This test never needs optical or GPU hardware.
"""
from __future__ import annotations

import importlib.util
import pathlib
import unittest

HERE = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "photonics_r0", HERE / "scripts" / "photonics-r0.py"
)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class PhotonicsR0Test(unittest.TestCase):
    def test_deterministic_data_generation(self):
        import torch
        a = module.data_for(64, 8, 369, torch.device("cpu"))
        b = module.data_for(64, 8, 369, torch.device("cpu"))
        for left, right in zip(a, b):
            torch.testing.assert_close(left, right)

    def test_reproducible_model_features(self):
        import torch
        x, _, _ = module.data_for(64, 8, 369, torch.device("cpu"))
        for method in ("photonic_inspired_sine", "electronic_tanh"):
            first = module.reservoir(x, 12, 369, method)
            second = module.reservoir(x, 12, 369, method)
            torch.testing.assert_close(first, second)
            self.assertEqual(first.shape, (64, 24))
            self.assertTrue(torch.isfinite(first).all())

    def test_bounded_report_and_metrics(self):
        report = module.experiment(samples=64, steps=8, nodes=8,
                                   repeats=2, seed=369, device="cpu")
        self.assertEqual(report["schema"], module.SCHEMA)
        self.assertEqual(report["source"], "numerical-simulation-pytorch")
        self.assertFalse(report["research_reference"]["replication_of_paper"])
        self.assertFalse(report["interfaces"]["execution_authorized"])
        self.assertEqual(len(report["runs"]), 2)
        for run in report["runs"]:
            for method in module.METHODS:
                record = run["methods"][method]
                self.assertTrue(0 <= record["accuracy"] <= 1)
                confusion = record["confusion_actual_rows_predicted_columns"]
                self.assertEqual(sum(sum(row) for row in confusion), 16)
                self.assertAlmostEqual(
                    record["accuracy"], (confusion[0][0] + confusion[1][1]) / 16,
                    places=5
                )
        self.assertEqual(report["environment"]["device"], "cpu")

    def test_bad_config_fails(self):
        with self.assertRaises(ValueError):
            module.experiment(samples=16, device="cpu")
        with self.assertRaises(ValueError):
            module.experiment(nodes=0, device="cpu")
        with self.assertRaises(ValueError):
            module.experiment(ridge=float("nan"), device="cpu")


if __name__ == "__main__":
    unittest.main()
