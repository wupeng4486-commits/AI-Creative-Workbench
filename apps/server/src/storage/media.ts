import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";

export interface MediaMetadata {
  duration: number | null;
  width: number | null;
  height: number | null;
}

const EMPTY: MediaMetadata = { duration: null, width: null, height: null };

function readBoxes(
  buffer: Buffer,
  start: number,
  end: number,
  visit: (type: string, payloadStart: number, payloadEnd: number) => void,
): void {
  let offset = start;
  while (offset + 8 <= end) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (size < 8 || offset + size > end) return;
    visit(type, offset + 8, offset + size);
    offset += size;
  }
}

/** Parses the mvhd and tkhd boxes of an ISO base media file. */
export function readMp4Metadata(buffer: Buffer): MediaMetadata {
  let duration: number | null = null;
  let width: number | null = null;
  let height: number | null = null;

  const walk = (start: number, end: number): void => {
    readBoxes(buffer, start, end, (type, payloadStart, payloadEnd) => {
      if (type === "mvhd") {
        const version = buffer[payloadStart];
        if (version === 1) {
          const timescale = buffer.readUInt32BE(payloadStart + 20);
          const units = buffer.readBigUInt64BE(payloadStart + 24);
          duration = timescale ? Number(units) / timescale : null;
        } else {
          const timescale = buffer.readUInt32BE(payloadStart + 12);
          const units = buffer.readUInt32BE(payloadStart + 16);
          duration = timescale ? units / timescale : null;
        }
      } else if (type === "tkhd") {
        // The track header ends with 32.32 fixed-point width and height.
        if (payloadEnd - 8 > payloadStart) {
          width = buffer.readUInt32BE(payloadEnd - 8) / 65536;
          height = buffer.readUInt32BE(payloadEnd - 4) / 65536;
        }
      } else if (
        type === "moov" ||
        type === "trak" ||
        type === "mdia" ||
        type === "minf" ||
        type === "stbl"
      ) {
        walk(payloadStart, payloadEnd);
      }
    });
  };

  try {
    walk(0, buffer.length);
  } catch {
    return EMPTY;
  }
  return { duration, width, height };
}

/** Reads EBML Duration (in timecode scale units) from a WebM header. */
export function readWebmMetadata(buffer: Buffer): MediaMetadata {
  const scaleIndex = buffer.indexOf(Buffer.from([0x2a, 0xd7, 0xb1, 0x83]));
  const durationIndex = buffer.indexOf(Buffer.from([0x44, 0x89]));
  if (scaleIndex < 0 || durationIndex < 0) return EMPTY;
  const scale = buffer.readUInt32BE(scaleIndex + 4);
  const sizeByte = buffer[durationIndex + 2] ?? 0;
  const width = (sizeByte & 0x80 ? 1 : 0) + (sizeByte & 0x40 ? 1 : 0) + (sizeByte & 0x20 ? 1 : 0) + (sizeByte & 0x10 ? 1 : 0);
  if (!width || width > 8 || durationIndex + 3 + width > buffer.length) return EMPTY;
  let value = 0;
  for (let i = 0; i < width; i += 1) value = value * 256 + buffer[durationIndex + 3 + i]!;
  return { duration: scale ? (value * (scale / 1_000_000_000)) || null : null, width: null, height: null };
}

function pngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1]!;
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function gifSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.toString("latin1", 0, 3) !== "GIF") return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

function probeWithFfprobe(file: string): MediaMetadata {
  const result = spawnSync(
    FFPROBE,
    ["-v", "error", "-show_entries", "format=duration:stream=width,height", "-of", "json", file],
    { encoding: "utf8", timeout: 8000 },
  );
  if (result.status !== 0 || !result.stdout) return EMPTY;
  try {
    const data = JSON.parse(result.stdout) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const stream = data.streams?.find((item) => item.width || item.height);
    return {
      duration: data.format?.duration ? Number(data.format.duration) : null,
      width: stream?.width ?? null,
      height: stream?.height ?? null,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Reads duration and pixel size without external tools. When ffprobe is
 * available it is preferred for exotic containers.
 */
export function readMediaMetadata(file: string, mimeType: string): MediaMetadata {
  let buffer: Buffer;
  try {
    const size = fs.statSync(file).size;
    const handle = fs.openSync(file, "r");
    const length = Math.min(size, 4 * 1024 * 1024);
    buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, 0);
    fs.closeSync(handle);
  } catch {
    return EMPTY;
  }

  if (mimeType.startsWith("video/")) {
    const probed = probeWithFfprobe(file);
    if (probed.duration || probed.width) return probed;
    if (mimeType.includes("webm")) return readWebmMetadata(buffer);
    return readMp4Metadata(buffer);
  }
  if (mimeType.startsWith("image/")) {
    const dimensions = pngSize(buffer) ?? jpegSize(buffer) ?? gifSize(buffer);
    if (dimensions) return { duration: null, ...dimensions };
  }
  return EMPTY;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

/** Writes a small solid-colour PNG used as the preview for media assets. */
export function writeThumbnail(
  target: string,
  width: number,
  height: number,
  color: [number, number, number] = [86, 110, 150],
): void {
  const w = Math.max(2, Math.min(width, 320));
  const h = Math.max(2, Math.min(height, 320));
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)]);
  for (let x = 0; x < w; x += 1) {
    row[1 + x * 3] = color[0];
    row[2 + x * 3] = color[1];
    row[3 + x * 3] = color[2];
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, png);
}
