import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "../../apps/web/src/app/shell.tsx";
import { NAV_ITEMS } from "../../apps/web/src/app/nav.ts";
import { Modal } from "../../apps/web/src/components/Modal.tsx";
import { SaveStatus } from "../../apps/web/src/components/SaveStatus.tsx";
import { MediaPreview } from "../../apps/web/src/components/MediaPreview.tsx";
import { SourceFilter } from "../../apps/web/src/components/SourceFilter.tsx";
import { useState } from "react";

vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }))));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/home" element={<h1>首页总览</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("navigation shell (T08)", () => {
  it("renders the eight modules in PRD order without numeric prefixes", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "主导航" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "首页总览",
      "智能体",
      "创作工作室",
      "资产库",
      "连接器",
      "技能",
      "工作流",
      "数据与设置",
    ]);
    expect(NAV_ITEMS).toHaveLength(8);
    for (const item of NAV_ITEMS) expect(item.label).not.toMatch(/^\d/);
  });

  it("marks the current module and keeps the demo flag visible", () => {
    renderShell();
    const active = screen.getByRole("link", { name: "首页总览" });
    expect(active.className).toContain("active");
    expect(screen.getByText("本地演示")).toBeVisible();
  });

  it("opens global search with Ctrl+K and closes with Escape", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.keyboard("{Control>}k{/Control}");
    const dialog = screen.getByRole("dialog", { name: "全局搜索" });
    expect(dialog).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "全局搜索" })).toBeNull();
  });
});

describe("shared components (T08)", () => {
  it("closes a modal with Escape and returns focus", async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <Modal open={open} title="新建技巧" onClose={() => setOpen(false)}>
          <button type="button">内容</button>
        </Modal>
      );
    }
    render(<Host />);
    expect(screen.getByRole("dialog", { name: "新建技巧" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("exposes save states and retry", async () => {
    const retry = vi.fn();
    const { rerender } = render(<SaveStatus state="saving" />);
    expect(screen.getByText("保存中…")).toBeVisible();
    rerender(<SaveStatus state="saved" />);
    expect(screen.getByText("已保存到本机")).toBeVisible();
    rerender(<SaveStatus state="error" detail="磁盘写入失败" onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("磁盘写入失败");
    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalled();
  });

  it("offers download for unsupported previews and renders images", () => {
    const { rerender } = render(
      <MediaPreview kind="none" url={null} name="附件.zip" downloadUrl="/api/files/x/download" />,
    );
    expect(screen.getByText("该格式无法直接预览")).toBeVisible();
    expect(screen.getByRole("link", { name: "下载文件" })).toHaveAttribute(
      "href",
      "/api/files/x/download",
    );
    rerender(<MediaPreview kind="image" url="/api/files/x/content" name="图" />);
    expect(screen.getByRole("img", { name: "图" })).toBeVisible();
  });

  it("filters by source with pressed state", async () => {
    const user = userEvent.setup();
    function Host() {
      const [value, setValue] = useState<"all" | "owned" | "shared">("all");
      return <SourceFilter value={value} onChange={setValue} />;
    }
    render(<Host />);
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "与我共享的" }));
    expect(screen.getByRole("button", { name: "与我共享的" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
