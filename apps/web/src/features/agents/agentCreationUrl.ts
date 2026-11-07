import type { Agent } from "../../lib/types.ts";

export function agentCreationUrl(agent: Pick<Agent, "id" | "domain">): string {
  const types: Record<string, string> = { "AI 图片": "ai_image", "美工": "design", "交付检查": "video_join" };
  return `/studio/${types[agent.domain] ?? "ai_video"}?agentId=${encodeURIComponent(agent.id)}`;
}
