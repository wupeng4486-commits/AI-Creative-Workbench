import { FileText, FileWarning } from "lucide-react";
import { useEffect, useState } from "react";

function TextPreview({ url, name, text, downloadUrl }: { url: string; name: string; text?: string; downloadUrl?: string | null }) {
  const [content, setContent] = useState(text ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(text === undefined);
  useEffect(() => {
    if (text !== undefined) { setContent(text); setLoading(false); setError(""); return; }
    const controller = new AbortController();
    setContent(""); setError(""); setLoading(true);
    void fetch(url.replace(/\/content$/, "/text"), { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("文本读取失败，请重试或下载原文件。");
      const result = await response.json() as { text: string };
      if (!controller.signal.aborted) { setContent(result.text); setLoading(false); }
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [url, text]);
  return <><pre className="media-text" aria-label={name}><FileText size={14} aria-hidden /> {content || (error ? "" : loading ? "正在读取文本…" : "空文本文件")}</pre>{error && <p role="alert">{error} {downloadUrl && <a href={downloadUrl} download>下载原文件</a>}</p>}</>;
}

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | "none";

export function MediaPreview({
  kind,
  url,
  name,
  downloadUrl,
  text,
}: {
  kind: PreviewKind;
  url: string | null;
  name: string;
  downloadUrl?: string | null;
  text?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (failed) return <div role="alert" className="media-fallback">媒体无法解码或读取，请下载原文件检查。{downloadUrl && <a href={downloadUrl} download>下载原文件</a>}</div>;
  if (!url || kind === "none") {
    return (
      <div className="media-fallback">
        <FileWarning size={20} />
        <span>该格式无法直接预览</span>
        {downloadUrl && (
          <a href={downloadUrl} download>
            下载文件
          </a>
        )}
      </div>
    );
  }
  if (kind === "image") {
    return <img className="media-image" src={url} alt={name} onError={() => setFailed(true)} />;
  }
  if (kind === "video") {
    return <video className="media-video" src={url} controls preload="metadata" onError={() => setFailed(true)} />;
  }
  if (kind === "audio") {
    return <audio className="media-audio" src={url} controls onError={() => setFailed(true)} />;
  }
  if (kind === "pdf") {
    return <iframe className="media-pdf" src={url} title={name} />;
  }
  return <TextPreview url={url} name={name} text={text} downloadUrl={downloadUrl} />;
}
