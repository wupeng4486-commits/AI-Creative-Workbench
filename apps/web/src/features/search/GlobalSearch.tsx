import { useState } from "react";
import { Modal } from "../../components/Modal.tsx";
import { SearchInput } from "../../components/SearchInput.tsx";

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
  void onOpen;
  return (
    <Modal open={open} title="全局搜索" onClose={onClose} size="large">
      <SearchInput label="全局搜索" value={query} onChange={setQuery} placeholder="名称、说明或标签" />
      <p className="hint">输入关键词以搜索本地智能体、技能、资产与团队工作流。</p>
    </Modal>
  );
}
