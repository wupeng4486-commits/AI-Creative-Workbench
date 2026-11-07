import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillDetailPage } from "../../apps/web/src/features/skills/SkillDetailPage.tsx";
import { SkillsPage } from "../../apps/web/src/features/skills/SkillsPage.tsx";
import type { Skill } from "../../apps/web/src/lib/types.ts";

const skill: Skill = {
  id: "skill-1",
  name: "视频交付检查",
  scenario: "AI 视频",
  origin: "owned",
  author: "本机用户",
  skill_type: "platform",
  tags: ["交付"],
  input_spec: "源文件",
  steps: "检查尺寸和附件",
  output_spec: "检查清单",
  examples: "检查示例",
  external_ref: "",
  created_at: "",
  updated_at: "",
  agents: [{ id: "agent-1", name: "视频导演" }],
  workflows: [],
};
const agents = [...skill.agents, { id: "agent-2", name: "图片助手" }];

function renderPage(path = "/skills/skill-1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/skills/:id" element={<SkillDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("skills pages (T11)", () => {
  it("shows one inline required-field error and keeps the create form open", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], scenarios: [] }))));
    renderPage("/skills");
    await user.click(screen.getAllByRole("button", { name: "新建技能" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "新建技能" });
    await user.click(within(dialog).getByRole("button", { name: "创建并编辑" }));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("技能名称不能为空");
    expect(dialog).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("exposes the visible Chinese labels for populated text fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ skill, agents, workflows: [] }))));
    renderPage();
    expect(await screen.findByLabelText("名称", { exact: true })).toHaveValue(skill.name);
    expect(screen.getByLabelText("输入要求", { exact: true })).toHaveValue(skill.input_spec);
    expect(screen.getByLabelText("步骤或指令正文", { exact: true })).toHaveValue(skill.steps);
    expect(screen.getByLabelText("输出格式", { exact: true })).toHaveValue(skill.output_spec);
    expect(screen.getByLabelText("示例", { exact: true })).toHaveValue(skill.examples);
  });

  it("preserves existing links and unsaved body when adding an agent", async () => {
    const user = userEvent.setup();
    let stored = structuredClone(skill);
    const fetchMock = vi.fn(async (input: string | URL, options?: RequestInit) => {
      if (String(input).endsWith("/links")) {
        const body = JSON.parse(String(options?.body));
        expect(body.agentIds).toEqual(["agent-1", "agent-2"]);
        stored = { ...stored, agents };
      }
      return new Response(JSON.stringify({ skill: stored, agents, workflows: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
    const steps = await screen.findByLabelText("步骤或指令正文", { exact: true });
    await user.clear(steps);
    await user.type(steps, "尚未保存的新正文");
    expect(screen.queryByText("保存中…")).toBeNull();
    await user.selectOptions(screen.getByLabelText("选择智能体"), "agent-2");
    await user.click(screen.getByRole("button", { name: "关联", exact: true }));
    expect(await screen.findByRole("link", { name: "图片助手" })).toBeVisible();
    expect(screen.getByRole("link", { name: "视频导演" })).toBeVisible();
    expect(steps).toHaveValue("尚未保存的新正文");
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1);
  });

  it("keeps input after a failed save and retries the same body successfully", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    let stored = structuredClone(skill);
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL, options?: RequestInit) => {
      if (options?.method === "PATCH") {
        attempts += 1;
        const body = JSON.parse(String(options.body));
        expect(body.steps).toBe("重试前保留的正文");
        if (attempts === 1) {
          return new Response(JSON.stringify({ code: "INTERNAL_ERROR", message: "磁盘写入失败" }), { status: 500 });
        }
        stored = { ...stored, steps: body.steps };
      }
      return new Response(JSON.stringify({ skill: stored, agents, workflows: [] }));
    }));
    renderPage();
    const steps = await screen.findByLabelText("步骤或指令正文", { exact: true });
    await user.clear(steps);
    await user.type(steps, "重试前保留的正文");
    await user.click(screen.getByRole("button", { name: "保存正文" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("磁盘写入失败");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(steps).toHaveValue("重试前保留的正文");
    await user.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存到本机"));
    expect(attempts).toBe(2);
    expect(steps).toHaveValue("重试前保留的正文");
  });
});
