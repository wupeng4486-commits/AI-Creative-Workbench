import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import yauzl from "yauzl";

export interface ZipEntry {
  name: string;
  size: number;
}

/** Reads only entry metadata; nothing is extracted to disk. */
export function listZipEntries(file: string): Promise<{ entries: ZipEntry[]; comment: string }> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("无法读取压缩包。"));
      const entries: ZipEntry[] = [];
      let settled = false;
      zip.on("entry", (entry) => {
        entries.push({ name: entry.fileName, size: entry.uncompressedSize });
        zip.readEntry();
      });
      zip.on("end", () => {
        settled = true;
        resolve({ entries, comment: zip.comment });
      });
      zip.on("close", () => {
        if (!settled) resolve({ entries, comment: zip.comment });
      });
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

export function readZipEntry(file: string, name: string, limit = 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("无法读取压缩包。"));
      let found = false;
      zip.on("entry", (entry) => {
        if (entry.fileName !== name) return zip.readEntry();
        found = true;
        if (entry.uncompressedSize > limit) {
          zip.close();
          return reject(new Error(`条目过大：${name}`));
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error("读取失败。"));
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            stream.destroy();
            resolve(Buffer.concat(chunks));
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => {
        if (!found) reject(new Error(`压缩包缺少条目：${name}`));
      });
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

/**
 * Rejects absolute paths, drive letters and `..` traversal before extraction.
 */
export function assertSafeZipEntry(name: string): void {
  const normalized = name.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").includes("..") ||
    normalized.includes("\u0000")
  ) {
    throw new Error(`备份包含不安全路径：${name}`);
  }
}

/** Extracts every entry below `targetDir` after validating sizes and paths. */
export function extractZip(
  file: string,
  targetDir: string,
  onEntry?: (name: string, sha256: string, size: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("无法读取压缩包。"));
      const root = path.resolve(targetDir);
      zip.on("entry", (entry) => {
        try {
          assertSafeZipEntry(entry.fileName);
        } catch (validationError) {
          zip.close();
          return reject(validationError);
        }
        const destination = path.resolve(root, entry.fileName);
        if (!destination.startsWith(root + path.sep)) {
          zip.close();
          return reject(new Error(`备份路径越界：${entry.fileName}`));
        }
        if (entry.fileName.endsWith("/")) {
          fs.mkdirSync(destination, { recursive: true });
          return zip.readEntry();
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            zip.close();
            return reject(streamError ?? new Error("解包失败。"));
          }
          const hash = crypto.createHash("sha256");
          let size = 0;
          const output = fs.createWriteStream(destination);
          stream.on("data", (chunk: Buffer) => {
            hash.update(chunk);
            size += chunk.length;
          });
          stream.on("error", (readError) => {
            output.destroy();
            reject(readError);
          });
          output.on("error", reject);
          output.on("close", () => {
            if (size !== entry.uncompressedSize) {
              return reject(new Error(`文件大小不一致：${entry.fileName}`));
            }
            onEntry?.(entry.fileName, hash.digest("hex"), size);
            zip.readEntry();
          });
          stream.pipe(output);
        });
      });
      zip.on("end", () => resolve());
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}
