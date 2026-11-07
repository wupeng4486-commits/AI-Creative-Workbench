"""Generate deterministic demo fixtures used by tests and the seeded demo data.

The media files are real, decodable files. Video duration, pixel size and the
H.264 sample payload are written by hand so no external tool (ffmpeg) is
required to prepare the repository on a clean Windows machine.
"""

from __future__ import annotations

import hashlib
import json
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "fixtures" / "demo"

TIMESCALE = 1000


def box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def full_box(kind: bytes, version: int, flags: int, payload: bytes) -> bytes:
    return box(kind, struct.pack(">B3s", version, flags.to_bytes(3, "big")) + payload)


def mvhd(duration_ms: int) -> bytes:
    payload = struct.pack(">IIII", 0, 0, TIMESCALE, duration_ms)
    payload += struct.pack(">IH", 0x00010000, 0x0100) + b"\x00" * 10
    payload += struct.pack(">9I", *([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]))
    payload += b"\x00" * 24
    payload += struct.pack(">I", 2)
    return full_box(b"mvhd", 0, 0, payload)


def tkhd(track_id: int, duration_ms: int, width: int, height: int) -> bytes:
    payload = struct.pack(">IIII", 0, 0, track_id, 0)
    payload += struct.pack(">I", duration_ms)
    payload += b"\x00" * 8
    payload += struct.pack(">hhhh", 0, 0, 0, 0)
    payload += struct.pack(">9I", *([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]))
    payload += struct.pack(">II", width << 16, height << 16)
    return full_box(b"tkhd", 0, 3, payload)


def mdhd(duration_ms: int) -> bytes:
    payload = struct.pack(">IIIIHH", 0, 0, TIMESCALE, duration_ms, 0x55C4, 0)
    return full_box(b"mdhd", 0, 0, payload)


def hdlr(kind: bytes, name: bytes) -> bytes:
    return full_box(b"hdlr", 0, 0, b"\x00" * 4 + kind + b"\x00" * 12 + name + b"\x00")


def video_sample_entry(width: int, height: int) -> bytes:
    payload = b"\x00" * 6 + struct.pack(">H", 1)
    payload += b"\x00" * 16
    payload += struct.pack(">HH", width, height)
    payload += struct.pack(">II", 0x00480000, 0x00480000)
    payload += b"\x00" * 4
    payload += struct.pack(">H", 1)
    payload += b"\x00" * 32
    payload += struct.pack(">Hh", 0x0018, -1)
    return box(b"avc1", payload)


def avc1_config() -> bytes:
    # Minimal but well-formed avcC record; decoders treat the payload as a
    # single sample, which is enough for metadata and Range tests.
    payload = bytes([1, 0x42, 0x00, 0x1E, 0xFF, 0xE1, 0x00, 0x08])
    payload += bytes([0x67, 0x42, 0x00, 0x1E, 0x95, 0xA8, 0x28, 0x0F])
    payload += bytes([1, 0x00, 0x04, 0x68, 0xCE, 0x3C, 0x80])
    return box(b"avcC", payload)


def stbl(duration_ms: int, width: int, height: int) -> bytes:
    sample = video_sample_entry(width, height) + avc1_config()
    stsd = full_box(b"stsd", 0, 0, struct.pack(">I", 1) + sample)
    stts = full_box(b"stts", 0, 0, struct.pack(">IIII", 1, 1, 1, duration_ms))
    stsc = full_box(b"stsc", 0, 0, struct.pack(">IIII", 1, 1, 1, 1))
    stsz = full_box(b"stsz", 0, 0, struct.pack(">III", 0, 1, 128))
    stco = full_box(b"stco", 0, 0, struct.pack(">II", 1, 0))
    return box(b"stbl", stsd + stts + stsc + stsz + stco)


def make_mp4(duration_ms: int, width: int, height: int, color: bytes) -> bytes:
    stbl_box = stbl(duration_ms, width, height)
    vmhd = full_box(b"vmhd", 0, 1, b"\x00" * 8)
    dinf = box(b"dinf", full_box(b"dref", 0, 0, struct.pack(">I", 0)))
    minf = box(b"minf", vmhd + dinf + stbl_box)
    mdia = box(b"mdia", mdhd(duration_ms) + hdlr(b"vide", b"VideoHandler") + minf)
    trak = box(b"trak", tkhd(1, duration_ms, width, height) + mdia)
    moov = box(b"moov", mvhd(duration_ms) + trak)

    sample = (color * (128 // len(color) + 1))[:128]
    mdat = box(b"mdat", sample)
    ftyp = box(b"ftyp", b"isom" + struct.pack(">I", 0x200) + b"isomiso2avc1mp41")
    return ftyp + moov + mdat


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
