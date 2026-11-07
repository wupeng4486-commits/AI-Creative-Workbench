import { Search } from "lucide-react";

export function SearchInput({
  value,
  onChange,
  placeholder = "搜索",
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
}) {
  return (
    <label className="search-input">
      <Search aria-hidden size={16} />
      <input
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
