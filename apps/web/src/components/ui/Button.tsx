import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode
} from "react";
import "./button.css";

export type OrbitButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type OrbitButtonSize = "compact" | "default" | "prominent";

export function OrbitButton(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: ReactNode;
    loading?: boolean;
    size?: OrbitButtonSize;
    variant?: OrbitButtonVariant;
  }
) {
  const {
    children,
    className = "",
    disabled,
    icon,
    loading = false,
    size = "default",
    type = "button",
    variant = "primary",
    ...buttonProps
  } = props;

  return (
    <button
      aria-busy={loading || undefined}
      className={`redesign-button redesign-button-${variant} redesign-button-${size} ${className}`.trim()}
      disabled={disabled || loading}
      type={type}
      {...buttonProps}
    >
      {loading ? <span aria-hidden="true" className="redesign-button-spinner" /> : icon}
      <span>{children}</span>
    </button>
  );
}

export function OrbitButtonLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & {
    icon?: ReactNode;
    size?: OrbitButtonSize;
    variant?: OrbitButtonVariant;
  }
) {
  const {
    children,
    className = "",
    icon,
    size = "default",
    variant = "primary",
    ...anchorProps
  } = props;

  return (
    <a
      className={`redesign-button redesign-button-${variant} redesign-button-${size} ${className}`.trim()}
      {...anchorProps}
    >
      {icon}
      <span>{children}</span>
    </a>
  );
}
