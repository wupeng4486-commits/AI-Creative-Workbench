import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftSaveQueue } from "../../apps/web/src/features/studio/DraftSaveQueue.ts";
import { ApiRequestError } from "../../apps/web/src/lib/api.ts";
import type { Draft } from "../../apps/web/src/lib/types.ts";

const draft: Draft = { id: "d1", creationType: "ai_video", name: "草稿", requirements: "", parameters: {}, agentId: null, productId: null, workflowId: null, assetIds: [], skillIds: [], clips: [], revision: 1, createdAt: "t", updatedAt: "t" };
const queues: DraftSaveQueue[] = [];
function create(write: (draft: Draft) => Promise<Draft>) {
  const queue = new DraftSaveQueue(structuredClone(draft), write, vi.fn(), 50);
  queues.push(queue);
  return queue;
}
afterEach(() => { for (const queue of queues.splice(0)) queue.dispose(); vi.useRealTimers(); });

describe("draft autosave queue (T16)", () => {
  it("coalesces edits into the latest pending version", async () => {
    const write = vi.fn(async (input: Draft) => ({ ...input, revision: input.revision + 1 }));
    const queue = create(write);
    queue.edit({ requirements: "初稿" });
    queue.edit({ requirements: "最新稿" });
    await queue.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0].requirements).toBe("最新稿");
    expect(queue.dirty).toBe(false);
    expect(queue.state).toBe("saved");
  });

  it("serializes in-flight edits and preserves new input when an older response arrives", async () => {
    let resolveFirst!: (draft: Draft) => void;
    const write = vi.fn<(input: Draft) => Promise<Draft>>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(async (input) => ({ ...input, revision: input.revision + 1 }));
    const queue = create(write);
    queue.edit({ requirements: "第一版" });
    const pending = queue.flush();
    queue.edit({ requirements: "等待期间的新输入" });
    expect(write).toHaveBeenCalledTimes(1);
    resolveFirst({ ...draft, requirements: "第一版", revision: 2 });
    await pending;
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![0]).toMatchObject({ revision: 2, requirements: "等待期间的新输入" });
    expect(queue.draft).toMatchObject({ revision: 3, requirements: "等待期间的新输入" });
  });

  it("retains input on save failure and retries without advancing the revision early", async () => {
    const write = vi.fn<(input: Draft) => Promise<Draft>>().mockRejectedValueOnce(new Error("磁盘写入失败")).mockImplementationOnce(async (input) => ({ ...input, revision: 2 }));
    const queue = create(write);
    queue.edit({ requirements: "需要保留的输入" });
    await expect(queue.flush()).rejects.toThrow("磁盘写入失败");
    expect(queue.draft).toMatchObject({ requirements: "需要保留的输入", revision: 1 });
    expect(queue.state).toBe("error");
    await queue.flush();
    expect(write.mock.calls[1]![0]).toMatchObject({ requirements: "需要保留的输入", revision: 1 });
    expect(queue.draft.revision).toBe(2);
  });

  it("retains conflicting input until the user chooses to overwrite the observed revision", async () => {
    const write = vi.fn<(input: Draft) => Promise<Draft>>()
      .mockRejectedValueOnce(new ApiRequestError(409, { code: "REVISION_CONFLICT", message: "修订冲突", currentRevision: 5 }))
      .mockImplementationOnce(async (input) => ({ ...input, revision: 6 }));
    const queue = create(write);
    queue.edit({ requirements: "我的输入" });
    await expect(queue.flush()).rejects.toThrow("修订冲突");
    expect(queue.conflictRevision).toBe(5);
    expect(queue.draft.requirements).toBe("我的输入");
    await queue.overwriteLatest();
    expect(write.mock.calls[1]![0]).toMatchObject({ revision: 5, requirements: "我的输入" });
    expect(queue.draft.revision).toBe(6);
  });

  it("autosaves after StrictMode effect cleanup and reactivation", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (input: Draft) => ({ ...input, revision: 2 }));
    const queue = create(write);
    queue.dispose();
    queue.activate();
    queue.edit({ requirements: "自动保存" });
    await vi.advanceTimersByTimeAsync(50);
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.state).toBe("saved");
  });

  it("cancels a queued save when the editor is disposed", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (input: Draft) => input);
    const queue = create(write);
    queue.edit({ requirements: "尚未提交" });
    queue.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(write).not.toHaveBeenCalled();
  });
});
