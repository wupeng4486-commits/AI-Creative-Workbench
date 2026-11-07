import { FieldError } from "../../components/FieldError.tsx";
import type { Draft } from "../../lib/types.ts";

export function ProductionParameters({ draft, edit, errors }: { draft: Draft; edit: (changes: Partial<Draft>) => void; errors: Record<string, string> }) {
  const update = (key: string, value: string | number) => edit({ parameters: { ...draft.parameters, [key]: value } });
  if (draft.creationType === "ai_video") return <fieldset>
    <legend>AI 视频参数</legend>
    <label className="field">目标时长（秒）<input type="number" min={1} max={120} aria-label="目标时长" value={Number(draft.parameters.duration ?? 15)} onChange={(event) => update("duration", Number(event.target.value))} /><FieldError message={errors.duration} /></label>
    <label className="field">画面比例<select aria-label="画面比例" value={String(draft.parameters.ratio ?? "9:16")} onChange={(event) => update("ratio", event.target.value)}>{["9:16", "16:9", "1:1"].map((ratio) => <option key={ratio}>{ratio}</option>)}</select><FieldError message={errors.ratio} /></label>
    <label className="field">分镜要求<textarea rows={5} aria-label="分镜要求" value={String(draft.parameters.shotRequirements ?? "")} onChange={(event) => update("shotRequirements", event.target.value)} /><FieldError message={errors.shotRequirements} /></label>
  </fieldset>;
  if (draft.creationType === "ai_image") return <fieldset>
    <legend>AI 图片参数</legend>
    <label className="field">目标宽度<input type="number" min={64} max={4096} aria-label="目标宽度" value={Number(draft.parameters.width ?? 1024)} onChange={(event) => update("width", Number(event.target.value))} /><FieldError message={errors.width} /></label>
    <label className="field">目标高度<input type="number" min={64} max={4096} aria-label="目标高度" value={Number(draft.parameters.height ?? 1024)} onChange={(event) => update("height", Number(event.target.value))} /><FieldError message={errors.height} /></label>
    <label className="field">候选数量<input type="number" min={1} max={8} aria-label="候选数量" value={Number(draft.parameters.count ?? 3)} onChange={(event) => update("count", Number(event.target.value))} /><FieldError message={errors.count} /></label>
    <label className="field">构图要求<textarea aria-label="构图要求" value={String(draft.parameters.composition ?? "")} onChange={(event) => update("composition", event.target.value)} /></label>
    <label className="field">风格要求<textarea aria-label="风格要求" value={String(draft.parameters.style ?? "")} onChange={(event) => update("style", event.target.value)} /><FieldError message={errors.style} /></label>
  </fieldset>;
  return null;
}
