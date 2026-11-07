import type { Draft } from "../../lib/types.ts";
import { ApiRequestError } from "../../lib/api.ts";
import type { SaveState } from "../../components/SaveStatus.tsx";

export class DraftSaveQueue {
  draft: Draft;
  state: SaveState = "idle";
  error: Error | null = null;
  conflictRevision: number | undefined;
  private sequence = 0;
  private acknowledged = 0;
  private pending: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(initial: Draft, private write: (draft: Draft) => Promise<Draft>, private notify: () => void, private delay = 500) {
    this.draft = initial;
  }

  get dirty() { return this.sequence > this.acknowledged; }

  edit(changes: Partial<Draft>) {
    this.draft = { ...this.draft, ...changes };
    this.sequence += 1;
    this.state = "dirty";
    this.error = null;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, this.delay);
    this.notify();
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.pending) return this.pending;
    this.pending = this.persist().finally(() => { this.pending = null; });
    return this.pending;
  }

  async overwriteLatest() {
    if (!this.conflictRevision) return;
    this.draft = { ...this.draft, revision: this.conflictRevision };
    this.conflictRevision = undefined;
    await this.flush();
  }

  dispose() {
    clearTimeout(this.timer);
    this.disposed = true;
  }

  activate() { this.disposed = false; }

  private async persist() {
    try {
      while (this.dirty && !this.disposed) {
        const sequence = this.sequence;
        const snapshot = structuredClone(this.draft);
        this.state = "saving";
        this.notify();
        const saved = await this.write(snapshot);
        this.draft = { ...this.draft, revision: saved.revision, updatedAt: saved.updatedAt };
        this.acknowledged = sequence;
      }
      this.state = "saved";
      this.error = null;
    } catch (error) {
      this.state = "error";
      this.error = error instanceof Error ? error : new Error("草稿保存失败，请重试。");
      this.conflictRevision = error instanceof ApiRequestError ? error.currentRevision : undefined;
      throw error;
    } finally {
      if (!this.disposed) this.notify();
    }
  }
}
