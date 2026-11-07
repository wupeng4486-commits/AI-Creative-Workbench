import type { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  meta,
  actions,
  children,
  onClick,
}: {
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <article
      className={`card ${onClick ? "card-clickable" : ""}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick();
        }
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="card-actions">{actions}</div>}
      </div>
      {children}
      {meta && <div className="card-meta">{meta}</div>}
    </article>
  );
}
