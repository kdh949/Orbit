import { useId, type ComponentPropsWithoutRef } from "react";
import { OrbitButton } from "./Button";
import "./failure-state.css";

export type OrbitFailureStateProps = Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  description: string;
  onRetry: () => void;
  retryLabel?: string;
  title: string;
};

export function OrbitFailureState({
  className = "",
  description,
  onRetry,
  retryLabel = "다시 시도",
  title,
  ...sectionProps
}: OrbitFailureStateProps) {
  const titleId = useId();

  return (
    <section
      {...sectionProps}
      className={`redesign-failure-state ${className}`.trim()}
      role="alert"
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{title}</h2>
      <p>{description}</p>
      <OrbitButton onClick={onRetry} size="prominent" variant="secondary">
        {retryLabel}
      </OrbitButton>
    </section>
  );
}
