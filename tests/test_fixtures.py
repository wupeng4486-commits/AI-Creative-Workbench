"""Verify the T01 fixture inventory, media metadata and acceptance ledger."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import struct
import unittest
import zlib
from datetime import datetime
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "fixtures" / "demo"
MANIFEST = ROOT / "fixtures" / "demo-manifest.json"
ACCEPTANCE_ID = re.compile(r"[A-Z]+-\d{2}")


def mp4_duration_ms(data: bytes) -> int:
    index = data.find(b"mvhd")
    assert index > 0, "mvhd box missing"
    offset = index + 16  # version+flags, creation and modification time
    timescale, duration = struct.unpack_from(">II", data, offset)
    assert timescale > 0
    return round(duration * 1000 / timescale)


def png_size(data: bytes) -> tuple[int, int]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack_from(">II", data, 16)
    return width, height


def png_crc_ok(data: bytes) -> bool:
    length = struct.unpack_from(">I", data, 8)[0]
    kind = data[12:16]
    payload = data[16 : 16 + length]
    crc = struct.unpack_from(">I", data, 16 + length)[0]
    return zlib.crc32(kind + payload) & 0xFFFFFFFF == crc


class FixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        cls.by_name = {item["name"]: item for item in cls.manifest["files"]}

    def test_manifest_lists_required_media(self):
        names = set(self.by_name)
        self.assertIn("测试产品图.png", names)
        self.assertIn("测试说明文档.pdf", names)
        self.assertIn("测试附件.txt", names)
        videos = sorted(name for name in names if name.endswith(".mp4"))
        self.assertEqual(len(videos), 3)
        self.assertTrue(all("测试视频" in name for name in videos))

    def test_every_file_matches_hash_and_size(self):
        for item in self.manifest["files"]:
            with self.subTest(file=item["name"]):
                path = DEMO / item["name"]
                data = path.read_bytes()
                self.assertEqual(len(data), item["bytes"])
                self.assertEqual(hashlib.sha256(data).hexdigest(), item["sha256"])

    def test_video_durations_and_dimensions(self):
        expected = {
            "测试视频A-4秒.mp4": 4000,
            "测试视频B-6秒.mp4": 6000,
            "测试视频C-5秒.mp4": 5000,
        }
        for name, duration in expected.items():
            with self.subTest(video=name):
                data = (DEMO / name).read_bytes()
                self.assertEqual(mp4_duration_ms(data), duration)
                # tkhd ends with 32.32 fixed-point width and height.
                index = data.find(b"tkhd") - 4
                size = struct.unpack_from(">I", data, index)[0]
                width = struct.unpack_from(">I", data, index + size - 8)[0] >> 16
                height = struct.unpack_from(">I", data, index + size - 4)[0] >> 16
                self.assertEqual((width, height), (640, 360))

    def test_image_and_document_are_valid(self):
        image = (DEMO / "测试产品图.png").read_bytes()
        self.assertEqual(png_size(image), (320, 200))
        self.assertTrue(png_crc_ok(image))
        pdf = (DEMO / "测试说明文档.pdf").read_bytes()
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertTrue(pdf.rstrip().endswith(b"%%EOF"))

    def test_acceptance_ledger_covers_prd_ids(self):
        prd = (ROOT / "PRD.md").read_text(encoding="utf-8")
        expected = {
            row.strip().strip("|").split("|")[0].strip()
            for row in prd.splitlines()
            if row.startswith("| ")
        }
        expected = {code for code in expected if ACCEPTANCE_ID.fullmatch(code)}
        ledger = (ROOT / "ACCEPTANCE.md").read_text(encoding="utf-8")
        actual = set(ACCEPTANCE_ID.findall(ledger))
        self.assertEqual(len(expected), 39)
        self.assertCountEqual(expected, actual)
        rows = [
            row
            for row in ledger.splitlines()
            if row.startswith("| ") and ACCEPTANCE_ID.fullmatch(row.split("|")[1].strip())
        ]
        self.assertEqual(len(rows), 39)
        for row in rows:
            cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
            with self.subTest(criterion=cells[0]):
                self.assertEqual(len(cells), 5)
                self.assertIn(cells[3], {"通过", "待电脑重启", "待人工验收"})
                self.assertRegex(cells[4], r"\d{4}-\d{2}-\d{2}")
                evidence_paths = re.findall(r"`((?:tests|scripts)/[^`]+)`", cells[4])
                self.assertTrue(evidence_paths, "每项验收必须关联可复核的测试或校验脚本")
                for evidence in evidence_paths:
                    self.assertTrue((ROOT / evidence).is_file(), evidence)
                if cells[3] != "通过":
                    self.assertIn("尚待", cells[4], "未完成验收必须明确剩余操作")

    def test_environment_record_documents_actual_versions(self):
        env = (ROOT / "ENVIRONMENT.md").read_text(encoding="utf-8")
        for token in ("v22.17.0", "10.9.2", "2.56.0", "better-sqlite3"):
            self.assertIn(token, env)

    def test_manual_acceptance_evidence_is_complete(self):
        evidence_dir = ROOT / "tests" / "evidence"
        reboot = json.loads((evidence_dir / "reboot-2026-11-07.json").read_text(encoding="utf-8"))
        self.assertEqual(reboot["status"], "passed_actual_reboot")
        before = datetime.fromisoformat(reboot["bootBefore"])
        after = datetime.fromisoformat(reboot["bootAfter"])
        self.assertGreater(after, before)
        self.assertGreaterEqual(datetime.fromisoformat(reboot["verifiedAt"]), after)
        self.assertEqual(reboot["clipOrder"], ["测试视频C-5秒.mp4", "测试视频A-4秒.mp4"])
        self.assertEqual(reboot["totalDuration"], 9)
        for check in ("requirementsPreserved", "runSnapshotPreserved", "archiveSourcePreserved"):
            self.assertTrue(reboot[check])
        for file in reboot["files"]:
            content = (DEMO / file["fixture"]).read_bytes()
            self.assertEqual(len(content), file["size"])
            self.assertEqual(hashlib.sha256(content).hexdigest(), file["sha256"])
        self.assertEqual(reboot["archiveSha256"], reboot["files"][1]["sha256"])
        nas = json.loads((evidence_dir / "nas-2026-11-07.json").read_text(encoding="utf-8"))
        self.assertEqual(nas["status"], "passed_live_nas")
        self.assertEqual(nas["httpStatus"], 200)
        self.assertEqual(urlsplit(nas["configuredAddress"]).netloc, urlsplit(nas["openedAddress"]).netloc)
        self.assertIn("Synology", nas["title"])
        self.assertIn("NAS 入口", nas["openedThrough"])
        for evidence in (nas, reboot):
            self.assertRegex(evidence["verifiedAt"], r"^2026-11-07T")
            self.assertIn("node scripts/", evidence["verificationCommand"])

    def test_delivery_documents_match_runtime_and_entry_points(self):
        guide = (ROOT / "使用说明.md").read_text(encoding="utf-8")
        report = (ROOT / "TEST_REPORT.md").read_text(encoding="utf-8")
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertIn(package["version"], guide)
        self.assertIn(package["version"], report)
        for entry in ("启动平台.cmd", "停止平台.cmd", "scripts/start-local.ps1", "scripts/stop-local.ps1"):
            self.assertTrue((ROOT / entry).is_file())
        for operation in ("导出完整备份", "上传备份并校验", "确认替换当前数据集", "补充缺失示例"):
            self.assertIn(operation, guide)
        for location in ("active.json", "database.sqlite", "server.err.log", "127.0.0.1:4173"):
            self.assertIn(location, guide)
        for test_path in re.findall(r"`(tests/[^`]+\.(?:ts|tsx|json))`", report):
            self.assertTrue((ROOT / test_path).is_file(), test_path)


if __name__ == "__main__":
    unittest.main()
