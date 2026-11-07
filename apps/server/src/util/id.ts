import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function prefixedId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
