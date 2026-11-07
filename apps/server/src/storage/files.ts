import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { newId } from "../util/id.ts";
import { nowIso } from "../util/time.ts";
import { readMediaMetadata, writeThumbnail } from "./media.ts";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json",
  ".psd": "image/vnd.adobe.photoshop",
  ".ai": "application/postscript",
  ".zip": "application/zip",
};

export function guessMimeType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

export function safeExtension(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

export interface FileRecord {
  id: string;
  relative_path: string;
  original_name: string;
  mime_type: string;
  size: number;
  sha256: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  state: "ready" | "quarantined";
  created_at: string;
}

export interface ImportedFile {
  id: string;
  relativePath: string;
  absolutePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface UploadResult {
  file: FileRecord;
  previewUrl: string | null;
  contentUrl: string;
  downloadUrl: string;
  previewKind: "image" | "video" | "audio" | "pdf" | "text" | "none";
}

export function filesRoot(datasetDir: string): string {
  return path.join(datasetDir, "files");
}

export function previewsRoot(datasetDir: string): string {
  return path.join(datasetDir, "previews");
}

export function absoluteFilePath(datasetDir: string, relativePath: string): string {
  const root = filesRoot(datasetDir);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) {
    throw new Error("文件路径越界。");
  }
  return resolved;
}

/** Streams an upload into staging and returns a verified staging file. */
export async function stageUpload(
  stagingDir: string,
  stream: NodeJS.ReadableStream,
): Promise<{ stagingPath: string; size: number; sha256: string }> {
  fs.mkdirSync(stagingDir, { recursive: true });
  const stagingPath = path.join(stagingDir, `${newId()}.upload`);
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(stagingPath, "w");
  let size = 0;
  try {
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        hash.update(buffer);
        fs.writeSync(handle, buffer);
      }
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    const sha256 = hash.digest("hex");
    const actual = fs.statSync(stagingPath).size;
    if (actual !== size) throw new Error("上传写入不完整。");
    return { stagingPath, size, sha256 };
  } catch (error) {
    fs.rmSync(stagingPath, { force: true });
    throw error;
  }
}

export function commitStagedFile(
  datasetDir: string,
  stagingPath: string,
  originalName: string,
  mimeType: string,
  sha256: string,
): ImportedFile {
  const id = newId();
  // Browsers occasionally send a generic type; the extension is more reliable.
  if (!mimeType || mimeType === "application/octet-stream") {
    mimeType = guessMimeType(originalName);
  }
  const ext = safeExtension(originalName);
  const relativePath = path.join(id, `original${ext}`);
  const target = absoluteFilePath(datasetDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(stagingPath, target);
  const metadata = readMediaMetadata(target, mimeType);
  if (mimeType.startsWith("video/") || mimeType.startsWith("image/")) {
    writeThumbnail(
      path.join(previewsRoot(datasetDir), id, "thumb.png"),
      metadata.width ?? 320,
      metadata.height ?? 180,
    );
  }
  return {
    id,
    relativePath,
    absolutePath: target,
    originalName,
    mimeType,
    size: fs.statSync(target).size,
    sha256,
  };
}

export function insertFile(db: Database.Database, file: ImportedFile): FileRecord {
  const metadata = readMediaMetadata(file.absolutePath, file.mimeType);
  const record: FileRecord = {
    id: file.id,
    relative_path: file.relativePath,
    original_name: file.originalName,
    mime_type: file.mimeType,
    size: file.size,
    sha256: file.sha256,
    duration: metadata.duration,
    width: metadata.width,
    height: metadata.height,
    state: "ready",
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO files (id, relative_path, original_name, mime_type, size, sha256, duration, width, height, state, created_at)
     VALUES (@id, @relative_path, @original_name, @mime_type, @size, @sha256, @duration, @width, @height, @state, @created_at)`,
  ).run(record);
  return record;
}

export function getFile(db: Database.Database, id: string): FileRecord | undefined {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRecord | undefined;
}

export function previewKind(mimeType: string): UploadResult["previewKind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/") || mimeType === "application/json") return "text";
  return "none";
}

export function describeFile(record: FileRecord): UploadResult {
  return {
    file: record,
    previewUrl: ["image", "video", "audio", "pdf", "text"].includes(previewKind(record.mime_type))
      ? `/api/files/${record.id}/content`
      : null,
    contentUrl: `/api/files/${record.id}/content`,
    downloadUrl: `/api/files/${record.id}/download`,
    previewKind: previewKind(record.mime_type),
  };
}

export function removeFile(datasetDir: string, record: FileRecord): void {
  fs.rmSync(path.join(filesRoot(datasetDir), path.dirname(record.relative_path)), {
    recursive: true,
    force: true,
  });
  fs.rmSync(path.join(previewsRoot(datasetDir), record.id), { recursive: true, force: true });
}

/**
 * Moves files that exist on disk but are not registered in `files` to a
 * quarantine folder so the startup check never deletes user data.
 */
export function quarantineUnregisteredFiles(
  datasetDir: string,
  db: Database.Database,
): string[] {
  const root = filesRoot(datasetDir);
  if (!fs.existsSync(root)) return [];
  const known = new Set(
    (db.prepare("SELECT id FROM files").all() as Array<{ id: string }>).map((row) => row.id),
  );
  const quarantined: string[] = [];
  const quarantine = path.join(datasetDir, "quarantine");
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || known.has(entry.name)) continue;
    fs.mkdirSync(quarantine, { recursive: true });
    fs.renameSync(path.join(root, entry.name), path.join(quarantine, entry.name));
    quarantined.push(entry.name);
  }
  return quarantined;
}
