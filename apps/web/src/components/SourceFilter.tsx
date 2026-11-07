import type { Origin } from "@workbench/shared";

export type SourceValue = "all" | Origin;

const OPTIONS: Array<{ value: SourceValue; label: string }> = [
  { value: "all", label: "全部" },
  { value: "owned", label: "我创建的" },
  { value: "shared", label: "与我共享的" },
];

export function SourceFilter({
  value,
  onChange,
  label = "来源筛选",
}: {
  value: SourceValue;
  onChange: (value: SourceValue) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
