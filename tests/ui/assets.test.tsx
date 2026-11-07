import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetsPage } from "../../apps/web/src/features/assets/AssetsPage.tsx";

const asset = {
  id: "a1",
  name: "测试产品图.png",
  asset_type: "image",
  file_id: "f1",
  origin: "owned",
  provenance: "user_import",
  tags: ["产品"],
  notes: "",
  catalog: "file",
  created_at: "",
  updated_at: "",
  file: {
    id: "f1",
    original_name: "测试产品图.png",
    mime_type: "image/png",
    size: 502,
    sha256: "abc",
    duration: null,
    width: 320,
    height: 200,
  },
  previewKind: "image",
  contentUrl: "/api/files/f1/content",
  downloadUrl: "/api/files/f1/download",
  thumbUrl: "/api/files/f1/thumb",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/assets"]}>
        <Routes>
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/assets/:id" element={<div>资产详情页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("assets page (T09)", () => {
  it("shows the empty state with an import entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ datasetId: "d", items: [], tags: [] }))),
    );
    renderPage();
    expect(await screen.findByText("资产库还是空的")).toBeVisible();
    expect(screen.getAllByRole("button", { name: /导入文件/ }).length).toBeGreaterThan(0);
  });

  it("renders media cards with real metadata and opens detail", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.startsWith("/api/assets")) {
          return new Response(JSON.stringify({ datasetId: "d", items: [asset], tags: ["产品"] }));
        }
        return new Response(JSON.stringify({ items: [] }));
      }),
    );
    renderPage();
    expect(await screen.findByRole("heading", { name: "测试产品图.png" })).toBeVisible();
    expect(screen.getByText("320×200")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "测试产品图.png" }));
    expect(await screen.findByText("资产详情页")).toBeVisible();
  });

  it("requires a file before importing and explains failures", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ datasetId: "d", items: [], tags: [] }))),
    );
    renderPage();
    await screen.findByText("资产库还是空的");
    await user.click(screen.getAllByRole("button", { name: /导入文件/ })[0]!);
    const dialog = screen.getByRole("dialog", { name: "导入本地文件" });
    await user.click(within(dialog).getByRole("button", { name: "导入" }));
    expect(await within(dialog).findByText("请选择要导入的文件。")).toBeVisible();
  });

  it("shows a clear-filter action when a search has no matches", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ datasetId: "d", items: [], tags: [] }))),
    );
    renderPage();
    await screen.findByText("资产库还是空的");
    await user.type(screen.getByLabelText("搜索资产"), "不存在");
    expect(await screen.findByText("没有符合筛选的资产")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    await waitFor(() => expect(screen.getByLabelText("搜索资产")).toHaveValue(""));
  });
});

