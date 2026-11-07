import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveStatus({
  state,
  detail,
  onRetry,
}: {
  state: SaveState;
  detail?: string;
  onRetry?: () => void;
}) {
  if (state === "idle") return null;
  if (state === "saving") {
    return (
      <span className="save-status saving" role="status">
        <Loader2 size={14} className="spin" /> 保存中…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="save-status saved" role="status">
        <CheckCircle2 size={14} /> 已保存到本机
      </span>
    );
  }
  return (
    <span className="save-status error" role="alert">
      <AlertCircle size={14} /> {detail ?? "保存失败"}
      {onRetry && (
        <button type="button" className="link-btn" onClick={onRetry}>
          重试
        </button>
      )}
    </span>
  );
}
