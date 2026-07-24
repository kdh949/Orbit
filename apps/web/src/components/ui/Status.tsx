import type { ReactNode } from "react";
import "./status.css";

export type OrbitStatusTone = "neutral" | "primary" | "lilac" | "success" | "warning" | "info" | "danger";

export function OrbitStatus(props: { children: ReactNode; tone?: OrbitStatusTone }) {
  const { children, tone = "neutral" } = props;
  return <span className={`redesign-status redesign-status-${tone}`}>{children}</span>;
}
