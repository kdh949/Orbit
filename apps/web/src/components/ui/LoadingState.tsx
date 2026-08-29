import type { ComponentPropsWithoutRef, ReactNode } from "react";

import "./loading-state.css";

export type OrbitLoadingStateProps = Omit<
  ComponentPropsWithoutRef<"section">,
  "children" | "title"
> & {
  description?: ReactNode;
  title: ReactNode;
};

export function OrbitLoadingState({
  className = "",
  description,
  title,
  ...sectionProps
}: OrbitLoadingStateProps) {
  return (
    <section
      {...sectionProps}
      aria-busy="true"
      aria-live="polite"
      className={`redesign-loading-state ${className}`.trim()}
      role="status"
    >
      <span aria-hidden="true" className="redesign-loading-state-visual">
        <span />
        <span />
        <span />
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
    </section>
  );
}
