import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "../../apps/web/src/features/chat/ChatPage.tsx";

function renderChat() {
  return render(<MemoryRouter><ChatPage /></MemoryRouter>);
}

beforeEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

describe("team general agent entry", () => {
  it("explains the pending model state and keeps sending disabled", () => {
    renderChat();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("今天，想一起完成什么？");
    expect(screen.getByText("团队内部使用")).toBeVisible();
    expect(screen.getByText("待接入模型")).toBeVisible();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "给主 Agent 的消息" })).toHaveValue("");
  });

  it("preserves existing input when using a starter and returns focus to the composer", async () => {
    renderChat();
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "给主 Agent 的消息" });
    await user.type(input, "我的原始思路");
    await user.click(screen.getByRole("button", { name: /写一份好文案/ }));
    expect(input).toHaveValue("我的原始思路\n\n请帮我起草一份团队内部通知。背景是……，需要传达的重点是……，希望语气清晰、简洁。");
    expect(input).toHaveFocus();
  });

  it("restores the browser draft after leaving and reopening the page", async () => {
    const first = renderChat();
    await userEvent.setup().type(screen.getByRole("textbox"), "需要留到下次的团队问题");
    expect(JSON.parse(localStorage.getItem("aiw.mainAgentDraft")!)).toBe("需要留到下次的团队问题");
    first.unmount();
    renderChat();
    expect(screen.getByRole("textbox")).toHaveValue("需要留到下次的团队问题");
    expect(screen.getByRole("status")).toHaveTextContent("草稿已保存在当前浏览器");
  });

  it("recovers from corrupt or incorrectly typed browser storage", () => {
    localStorage.setItem("aiw.mainAgentDraft", "{invalid json");
    const first = renderChat();
    expect(screen.getByRole("textbox")).toHaveValue("");
    first.unmount();
    localStorage.setItem("aiw.mainAgentDraft", JSON.stringify({ text: "old incompatible value" }));
    renderChat();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("reports failed storage without losing the input and saves after storage becomes available", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota exceeded"); });
    renderChat();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "保存失败也要保留");
    expect(screen.getByRole("alert")).toHaveTextContent("当前浏览器无法保存草稿");
    expect(screen.getByRole("textbox")).toHaveValue("保存失败也要保留");
    write.mockRestore();
    await user.type(screen.getByRole("textbox"), "，继续编辑");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(JSON.parse(localStorage.getItem("aiw.mainAgentDraft")!)).toBe("保存失败也要保留，继续编辑");
  });

  it("does not issue requests or create a synthetic response when Enter is pressed", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    renderChat();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "讨论本周计划{Enter}还有下周安排");
    expect(screen.getByRole("textbox")).toHaveValue("讨论本周计划\n还有下周安排");
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  });

  it("links to the real team agent and skill directories", () => {
    renderChat();
    expect(screen.getByRole("link", { name: /探索团队智能体/ })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: /查看团队技能/ })).toHaveAttribute("href", "/skills");
    expect(screen.getAllByRole("button").length).toBe(5);
  });
});
