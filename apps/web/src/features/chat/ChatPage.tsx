import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUp, BookOpen, ChartNoAxesCombined, FileText, Lightbulb, LockKeyhole, Sparkles } from "lucide-react";
import { readPersisted } from "../../lib/persisted.ts";

const STARTERS = [
  { title: "写一份好文案", description: "通知、邮件、内容初稿", icon: FileText, tone: "violet", prompt: "请帮我起草一份团队内部通知。背景是……，需要传达的重点是……，希望语气清晰、简洁。" },
  { title: "整理思路与资料", description: "提炼重点，梳理行动项", icon: BookOpen, tone: "blue", prompt: "请帮我整理以下资料，提炼核心信息、待确认的问题和下一步行动项。资料内容是……" },
  { title: "一起策划方案", description: "从一个想法到执行步骤", icon: Lightbulb, tone: "amber", prompt: "我想围绕……这个目标制定一份方案。面向的人群是……，时间和资源约束是……，请帮我梳理可执行的步骤。" },
  { title: "看懂业务数据", description: "发现趋势，提出分析问题", icon: ChartNoAxesCombined, tone: "green", prompt: "我想分析一份业务数据。数据背景是……，我关心的指标是……，请帮我梳理分析思路、趋势和需要关注的异常。" },
];

export function ChatPage() {
  const [draft, setDraft] = useState(() => {
    const saved = readPersisted<unknown>("mainAgentDraft", "");
    return typeof saved === "string" ? saved : "";
  });
  const [storageError, setStorageError] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem("aiw.mainAgentDraft", JSON.stringify(draft));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [draft]);

  function applyStarter(prompt: string) {
    setDraft((current) => current.trim() ? `${current}\n\n${prompt}` : prompt);
    input.current?.focus();
  }

  return (
    <div className="chat-page">
      <div className="chat-context">
        <span><span className="presence-dot" /> 团队通用主 Agent</span>
        <span className="chat-context-note"><LockKeyhole size={13} aria-hidden /> 团队内部使用</span>
      </div>

      <section className="chat-workspace" aria-label="主 Agent 对话">
        <header className="chat-intro">
          <div className="agent-emblem" aria-hidden><Sparkles size={28} strokeWidth={1.6} /></div>
          <p className="chat-eyebrow">一个入口，连接团队的每一个想法</p>
          <h1>今天，想一起完成什么？</h1>
          <p>整理资料、打磨文案、讨论方案。把你的想法写下来，从这里开始。</p>
        </header>

        <form className="chat-composer" aria-label="对话输入" onSubmit={(event) => event.preventDefault()}>
          <label className="sr-only" htmlFor="main-agent-input">给主 Agent 的消息</label>
          <textarea
            id="main-agent-input"
            ref={input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="说说你的想法，或者描述一个需要帮助的问题……"
            aria-describedby="main-agent-status main-agent-storage"
            rows={4}
          />
          <div className="composer-toolbar">
            <div className="composer-agent"><Sparkles size={15} aria-hidden /><span>主 Agent</span><span className="model-pending">待接入模型</span></div>
            <button className="composer-send" type="submit" disabled aria-label="发送消息" title="接入模型后即可发送"><ArrowUp size={19} aria-hidden /></button>
          </div>
        </form>

        <div className="chat-input-meta">
          <p id="main-agent-status">主 Agent 准备中，模型接入后即可开始对话。</p>
          <p id="main-agent-storage" role={storageError ? "alert" : "status"}>
            {storageError ? "当前浏览器无法保存草稿，请先复制你的输入。" : draft ? "草稿已保存在当前浏览器" : "输入草稿自动暂存于当前浏览器"}
          </p>
        </div>

        <section className="chat-starters" aria-labelledby="chat-starters-title">
          <div className="chat-section-heading"><h2 id="chat-starters-title">从一个小问题开始</h2><span>点击填入思路，随时继续编辑</span></div>
          <div className="starter-grid">
            {STARTERS.map(({ title, description, icon: Icon, tone, prompt }) => (
              <button className="starter-card" type="button" key={title} onClick={() => applyStarter(prompt)}>
                <span className={`starter-icon tone-${tone}`}><Icon size={19} strokeWidth={1.7} aria-hidden /></span>
                <span className="starter-copy"><strong>{title}</strong><span>{description}</span></span>
                <ArrowRight className="starter-arrow" size={15} aria-hidden />
              </button>
            ))}
          </div>
        </section>

        <div className="chat-resource-links">
          <span>让团队的经验接上每一次创作</span>
          <Link to="/agents">探索团队智能体 <ArrowRight size={13} aria-hidden /></Link>
          <Link to="/skills">查看团队技能 <ArrowRight size={13} aria-hidden /></Link>
        </div>
      </section>
      <footer className="chat-footer">AI Creative Workbench <span>·</span> 团队的想法，从这里向前</footer>
    </div>
  );
}
