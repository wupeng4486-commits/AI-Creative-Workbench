import type { ReactNode } from "react";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "demo" | "shared" | "success" | "warn";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
