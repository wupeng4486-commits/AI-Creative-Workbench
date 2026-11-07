import { FileText, FileWarning } from "lucide-react";

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
    return <img className="media-image" src={url} alt={name} />;
  }
  if (kind === "video") {
    return <video className="media-video" src={url} controls preload="metadata" />;
  }
  if (kind === "audio") {
    return <audio className="media-audio" src={url} controls />;
  }
  if (kind === "pdf") {
    return <iframe className="media-pdf" src={url} title={name} />;
  }
  return (
    <pre className="media-text">
      <FileText size={14} aria-hidden /> {text ?? "文本内容加载中…"}
    </pre>
  );
}
