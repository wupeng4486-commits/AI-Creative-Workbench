"""Generate deterministic demo fixtures used by tests and the seeded demo data.

The media files are real, decodable files. Video regeneration uses FFmpeg
from FFMPEG_EXE or PATH. The generated files are committed so ordinary app
startup and tests use the prepared media directly.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "demo"

def make_mp4(duration_ms: int, width: int, height: int, color: bytes) -> bytes:
    encoder = os.environ.get("FFMPEG_EXE") or shutil.which("ffmpeg")
    if not encoder:
        raise RuntimeError("Regenerating video fixtures requires FFmpeg. Set FFMPEG_EXE to its executable path.")
    with tempfile.TemporaryDirectory(prefix="aiw-video-fixture-") as directory:
        target = Path(directory) / "fixture.mp4"
        subprocess.run(
            [encoder, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
             f"color=c=0x{color.hex()}:s={width}x{height}:r=12:d={duration_ms / 1000}",
             "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "0",
             "-crf", "38", "-deadline", "realtime", "-cpu-used", "6", "-threads", "1", "-g", "12",
             "-flags:v", "+bitexact", "-fflags", "+bitexact", "-map_metadata", "-1",
             "-movflags", "+faststart", "-y", str(target)],
            check=True,
            capture_output=True,
        )
        return target.read_bytes()


def make_png(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    raw = b"".join(b"\x00" + bytes(color) * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def make_pdf(lines: list[str]) -> bytes:
    content = "BT /F1 18 Tf 72 720 Td 24 TL\n" + "".join(
        f"({line}) Tj T*\n" for line in lines
    ) + "ET"
    stream = content.encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % index + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    return bytes(out)


def make_text() -> bytes:
    return (
        "企业 AI 内容生产平台测试附件\n"
        "本文件仅用于验证上传、下载、哈希和备份恢复，不包含业务真实资料。\n"
    ).encode("utf-8")


FILES = {
    "测试产品图.png": lambda: make_png(320, 200, (58, 108, 214)),
    "测试视频A-4秒.mp4": lambda: make_mp4(4000, 640, 360, b"\x12\x34\x56"),
    "测试视频B-6秒.mp4": lambda: make_mp4(6000, 640, 360, b"\x65\x43\x21"),
    "测试视频C-5秒.mp4": lambda: make_mp4(5000, 640, 360, b"\x77\x11\x99"),
    "测试说明文档.pdf": lambda: make_pdf(["AI Creative Workbench", "Test fixture PDF"]),
    "测试附件.txt": make_text,
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name, factory in FILES.items():
        data = factory()
        path = OUT / name
        path.write_bytes(data)
        manifest.append(
            {
                "name": name,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
        print(f"{name}\t{len(data)}\t{manifest[-1]['sha256']}")
    (ROOT / "fixtures" / "demo-manifest.json").write_text(
        json.dumps({"files": manifest}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
