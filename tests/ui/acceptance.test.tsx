import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MediaPreview } from "../../apps/web/src/components/MediaPreview.tsx";
import { Modal } from "../../apps/web/src/components/Modal.tsx";

afterEach(() => vi.unstubAllGlobals());
it("keeps keyboard focus while a modal input changes across renders", async () => {
  function Host() {
    const [value, setValue] = useState("");
    return <Modal open title="连续输入" onClose={() => {}}><input aria-label="连续输入内容" value={value} onChange={(event) => setValue(event.target.value)} /></Modal>;
  }
  render(<Host />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("连续输入内容"), "modal-focus-regression");
  expect(screen.getByLabelText("连续输入内容")).toHaveValue("modal-focus-regression");
  expect(screen.getByLabelText("连续输入内容")).toHaveFocus();
});

it("reads text from the real text endpoint, supports empty documents and reports read failure", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ text: "文件里的正文" })));
  vi.stubGlobal("fetch", fetch);
  const { rerender } = render(<MediaPreview kind="text" url="/api/files/one/content" name="正文" />);
  expect(await screen.findByText("文件里的正文")).toBeVisible();
  expect(fetch).toHaveBeenCalledWith("/api/files/one/text", expect.anything());
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ text: "" })));
  rerender(<MediaPreview kind="text" url="/api/files/two/content" name="空文件" />);
  expect(await screen.findByText("空文本文件")).toBeVisible();
  fetch.mockResolvedValueOnce(new Response("", { status: 500 }));
  rerender(<MediaPreview kind="text" url="/api/files/three/content" name="读取失败" downloadUrl="/download" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("文本读取失败");
  expect(screen.getByRole("link", { name: "下载原文件" })).toHaveAttribute("href", "/download");
});

it("reports a failed media decode and retains the original download", () => {
  render(<MediaPreview kind="image" url="/broken" name="坏图" downloadUrl="/original" />);
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByRole("alert")).toHaveTextContent("媒体无法解码或读取");
  expect(screen.getByRole("link", { name: "下载原文件" })).toHaveAttribute("href", "/original");
});
