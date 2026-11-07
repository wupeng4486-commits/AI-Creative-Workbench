import { afterEach, describe, expect, it } from "vitest";
import { makeApp, cleanupDirs } from "../helpers/app.ts";

afterEach(cleanupDirs);
describe("home and global search (T21)", () => {
  it("uses the same unique record counts as each destination and excludes product and static samples", async () => {
    const app = await makeApp();
    try {
      await app.inject({ method: "POST", url: "/api/products", payload: { name: "共享商品排除" } });
      const product = (await app.inject("/api/products")).json().items.find((item: { name: string }) => item.name === "共享商品排除");
      await app.inject({ method: "PATCH", url: `/api/assets/${product.id}`, payload: { origin: "shared" } });
      const home = (await app.inject("/api/home")).json();
      for (const [key, url] of Object.entries({ agents: "/api/agents", skills: "/api/skills", workflows: "/api/workflows", sharedFiles: "/api/assets?origin=shared&filesOnly=1" })) {
        const items = (await app.inject(url)).json().items;
        expect(home.counts[key]).toBe(new Set(items.map((item: { id: string }) => item.id)).size);
      }
      expect(home.shared.some((item: { id: string }) => item.id === product.id)).toBe(false);
      const created = (await app.inject({ method: "POST", url: "/api/workflows", payload: { name: "目录新增流程" } })).json().workflow;
      expect((await app.inject("/api/home")).json().counts.workflows).toBe(home.counts.workflows + 1);
      await app.inject({ method: "DELETE", url: `/api/workflows/${created.id}` });
      expect((await app.inject("/api/home")).json().counts.workflows).toBe(home.counts.workflows);
    } finally { await app.close(); }
  });

  it("filters shared records, searches names descriptions and tags and preserves original IDs", async () => {
    const app = await makeApp();
    try {
      const skill = (await app.inject({ method: "POST", url: "/api/skills", payload: { name: "SearchName", scenario: "唯一描述", tags: ["UniqueTag"], origin: "shared" } })).json().skill;
      for (const keyword of ["searchname", "唯一描述", "uniquetag"]) {
        const result = (await app.inject(`/api/search?q=${encodeURIComponent(keyword)}`)).json();
        expect(result.groups.find((group: { type: string }) => group.type === "skill").items.map((item: { id: string }) => item.id)).toContain(skill.id);
      }
      const shared = (await app.inject("/api/home?type=skill")).json().shared;
      expect(shared.length).toBeGreaterThan(0);
      expect(shared.every((item: { type: string; origin: string }) => item.type === "skill" && item.origin === "shared")).toBe(true);
      expect((await app.inject("/api/search?q=zz-no-results-xyz")).json().groups.flatMap((group: { items: unknown[] }) => group.items)).toEqual([]);
      expect((await app.inject("/api/search?q=%20")).json().groups.flatMap((group: { items: unknown[] }) => group.items)).toEqual([]);
    } finally { await app.close(); }
  });

  it("records actual recent visits, marks seed activities and removes dead recent links", async () => {
    const app = await makeApp();
    try {
      const skill = (await app.inject({ method: "POST", url: "/api/skills", payload: { name: "最近技能", scenario: "验收" } })).json().skill;
      await app.inject(`/api/skills/${skill.id}`);
      await app.inject("/api/workflows/seed-workflow-tietie");
      let home = (await app.inject("/api/home")).json();
      expect(home.recent.find((item: { id: string }) => item.id === skill.id).href).toBe(`/skills/${skill.id}`);
      expect(home.recent.some((item: { id: string }) => item.id === "seed-workflow-tietie")).toBe(true);
      expect(home.activities.some((item: { demo: boolean; action: string }) => item.demo && item.action.startsWith("示例动态"))).toBe(true);
      expect(home.activities.find((item: { action: string }) => item.action.includes("最近技能")).demo).toBe(false);
      await app.inject({ method: "DELETE", url: `/api/skills/${skill.id}` });
      home = (await app.inject("/api/home")).json();
      expect(home.recent.some((item: { id: string }) => item.id === skill.id)).toBe(false);
      expect(home.activities.find((item: { action: string }) => item.action.includes("删除技能：最近技能")).href).toBeNull();
    } finally { await app.close(); }
  });
});
