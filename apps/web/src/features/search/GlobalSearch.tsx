import { useState } from "react";
import { Modal } from "../../components/Modal.tsx";
import { SearchInput } from "../../components/SearchInput.tsx";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api.ts";
import { Button } from "../../components/Button.tsx";
import { Badge } from "../../components/Badge.tsx";
import { type DiscoveryItem, RESOURCE_LABELS } from "../home/types.ts";

export function GlobalSearch({
  open,
  onClose,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useQuery({ queryKey: ["search", query], queryFn: () => api<{ groups: Array<{ type: string; items: DiscoveryItem[] }> }>(`/api/search?q=${encodeURIComponent(query)}`), enabled: open && Boolean(query.trim()) });
  return (
    <Modal open={open} title="全局搜索" onClose={onClose} size="large">
      <SearchInput label="全局搜索" value={query} onChange={setQuery} placeholder="名称、说明或标签" />
      <p className="hint">输入关键词以搜索本地智能体、技能、资产与团队工作流。</p>
      {results.isFetching && <p role="status">正在搜索…</p>}
      {results.isError && <p role="alert">{errorMessage(results.error)} <Button onClick={() => void results.refetch()}>重试</Button></p>}
      {query.trim() && results.data?.groups.every((group) => !group.items.length) && <p>没有匹配结果，请调整关键词。</p>}
      {query.trim() && results.data?.groups.filter((group) => group.items.length).map((group) => <section key={group.type} aria-label={`${RESOURCE_LABELS[group.type]}搜索结果`}><h3>{RESOURCE_LABELS[group.type]}</h3><ul>{group.items.map((item) => <li key={item.id}><Button onClick={() => onOpen(item.href)}>{item.name}</Button> <Badge tone={item.origin === "shared" ? "shared" : "neutral"}>{item.origin === "shared" ? "与我共享的" : "我创建的"}</Badge> {item.demo && <Badge tone="demo">示例 / 演示</Badge>}<p>{item.description}</p></li>)}</ul></section>)}
    </Modal>
  );
}
