"""Verify the T01 fixture inventory, media metadata and acceptance ledger."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import struct
import unittest
import zlib

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
                index = data.find(b"tkhd")
                width = struct.unpack_from(">I", data, index + 80)[0] >> 16
                height = struct.unpack_from(">I", data, index + 84)[0] >> 16
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
        self.assertTrue(all("待验收" in row for row in rows))

    def test_environment_record_documents_actual_versions(self):
        env = (ROOT / "ENVIRONMENT.md").read_text(encoding="utf-8")
        for token in ("v22.17.0", "10.9.2", "2.56.0", "better-sqlite3"):
            self.assertIn(token, env)


if __name__ == "__main__":
    unittest.main()
