import type { ActivitySlide, Deck } from "@orbit/shared";
import type { CSSProperties } from "react";

type ActivityThemeProperties = CSSProperties &
  Record<`--activity-color-${string}`, string>;

export function createActivityThemeStyle(
  theme?: Deck["theme"],
  slideStyle?: ActivitySlide["style"]
): ActivityThemeProperties {
  const background =
    slideStyle?.backgroundColor ?? theme?.backgroundColor ?? "#f8faf7";
  const foreground = slideStyle?.textColor ?? theme?.textColor ?? "#191c1b";
  const accent =
    slideStyle?.accentColor ??
    theme?.accentColor ??
    theme?.palette.primary ??
    "#2563eb";
  const surface = theme?.palette.surface ?? "#ffffff";
  const muted = theme?.palette.muted ?? "#f3f4f6";
  const border = theme?.palette.border ?? "#e5e7eb";
  const secondary = theme?.palette.secondary ?? accent;

  return {
    "--activity-color-accent": accent,
    "--activity-color-background": background,
    "--activity-color-border": border,
    "--activity-color-muted": muted,
    "--activity-color-on-accent": readableTextColor(accent),
    "--activity-color-on-background": foreground,
    "--activity-color-on-surface": readableTextColor(surface),
    "--activity-color-secondary": secondary,
    "--activity-color-surface": surface
  };
}

function readableTextColor(hexColor: string) {
  const normalized = hexColor.replace("#", "");
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255
  );
  const luminance =
    channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;

  return luminance > 0.58 ? "#191c1b" : "#ffffff";
}
