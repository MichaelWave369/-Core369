"""Photonics P4 local-capture safety and hash-integrity tests (no torch needed)."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "photonics_p4", HERE / "scripts" / "photonics-p4.py"
)
P4 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P4)


class P4Tests(unittest.TestCase):
    def test_dry_run_never_creates_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            capture_root = Path(tmp) / "captures"
            with patch.object(P4, "CAPTURE_ROOT", capture_root):
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    result = P4.main(["--session", "dry_run", "--device", "cuda"])
            self.assertEqual(result, 0)
            self.assertFalse(capture_root.exists())
            self.assertIn("DRY RUN", output.getvalue())

    def test_bad_session_and_settings_rejected_before_work(self):
        namespace = argparse.Namespace(verify=None,execute=False,session="../escape",
                                     samples=256,steps=12,nodes=32,repeats=6,
                                     seed=369,ridge=.1,device="cuda")
        with self.assertRaisesRegex(ValueError, "session slug"):
            P4.assert_args(namespace)
        namespace.session = "valid"
        namespace.repeats = 2
        with self.assertRaisesRegex(ValueError, "bounded P2"):
            P4.assert_args(namespace)
        namespace.repeats = 6
        namespace.device = "auto"
        with self.assertRaisesRegex(ValueError, "explicit"):
            P4.assert_args(namespace)

    def test_verify_manifest_detects_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            records = {
                "p2-a.json": b'{"a":"one"}',
                "p2-b.json": b'{"b":"two"}',
                "p3-comparison.json": b'{"schema":"comparison"}',
            }
            for name,data in records.items():
                (folder / name).write_bytes(data)
            artifacts = {
                role: P4.digest(folder / name) for role,name in P4.NAMES.items()
            }
            manifest = {
                "schema": P4.SCHEMA,
                "source": "operator_requested_local_digital",
                "execution_authorized": False,
                "actual_optical_hardware": False,
                "measured_energy": False,
                "artifacts": artifacts,
                "requested_device": "cpu",
            }
            (folder / "manifest.json").write_text(json.dumps(manifest),
                                                   encoding="utf-8")
            with patch.object(P4, "compare", return_value={"schema":"comparison"}):
                self.assertEqual(P4.verify_bundle(folder, node="node")["schema"],
                                 P4.SCHEMA)
                (folder / "p2-a.json").write_bytes(b"modified")
                with self.assertRaisesRegex(ValueError, "hash/byte mismatch"):
                    P4.verify_bundle(folder, node="node")

    def test_verify_recalculates_comparison(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            for filename in P4.NAMES.values():
                (folder / filename).write_text("{}",encoding="utf-8")
            manifest = {
                "schema": P4.SCHEMA,
                "source": "operator_requested_local_digital",
                "execution_authorized": False,
                "actual_optical_hardware": False,
                "measured_energy": False,
                "artifacts": {
                    role:P4.digest(folder / filename)
                    for role,filename in P4.NAMES.items()
                },
            }
            (folder / "manifest.json").write_text(json.dumps(manifest),
                                                   encoding="utf-8")
            with patch.object(P4, "compare", return_value={"unexpected": True}):
                with self.assertRaisesRegex(ValueError, "Saved P3 comparison differs"):
                    P4.verify_bundle(folder, node="node")

    def test_digest_includes_sha256_and_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "test.json"
            file.write_bytes(b"abc")
            result = P4.digest(file)
            self.assertEqual(result["sha256"], hashlib.sha256(b"abc").hexdigest())
            self.assertEqual(result["bytes"], 3)
            self.assertEqual(result["file"], "test.json")


if __name__ == "__main__":
    unittest.main()
