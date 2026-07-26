import { useEffect } from "react";

export type PresenterKeyboardCommand = "next-step" | "previous-slide";

const presenterKeyboardIgnoredTargetSelector = [
  "[contenteditable]",
  "[contenteditable='true']",
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "summary",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
  "[role='textbox']"
].join(", ");

export function usePresenterKeyboard(args: {
  enabled?: boolean;
  onNextStep: () => void;
  onPreviousSlide: () => void;
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
}) {
  const {
    enabled = true,
    onNextStep,
    onPreviousSlide,
    target = typeof window === "undefined" ? undefined : window
  } = args;

  useEffect(() => {
    if (!enabled || !target) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const command = getPresenterKeyboardCommand(event);

      if (!command) {
        return;
      }

      event.preventDefault();
      if (command === "next-step") {
        onNextStep();
      } else {
        onPreviousSlide();
      }
    };

    target.addEventListener("keydown", handleKeyDown);

    return () => {
      target.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, onNextStep, onPreviousSlide, target]);
}

export function getPresenterKeyboardCommand(
  event: Pick<KeyboardEvent, "key" | "target">
): PresenterKeyboardCommand | null {
  if (isPresenterKeyboardIgnoredTarget(event.target)) {
    return null;
  }

  if (
    event.key === " " ||
    event.key === "ArrowRight" ||
    event.key === "PageDown" ||
    event.key === "Enter"
  ) {
    return "next-step";
  }

  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    return "previous-slide";
  }

  return null;
}

export function isPresenterKeyboardIgnoredTarget(target: EventTarget | null) {
  if (!target || typeof target !== "object") {
    return false;
  }

  const element = target as {
    closest?: (selector: string) => Element | null;
    getAttribute?: (name: string) => string | null;
    hasAttribute?: (name: string) => boolean;
    isContentEditable?: boolean;
    parentElement?: { closest?: (selector: string) => Element | null } | null;
    tagName?: string;
  };
  const tagName = element.tagName?.toLowerCase();
  const role = element.getAttribute?.("role")?.toLowerCase();

  if (
    element.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    tagName === "button" ||
    tagName === "summary" ||
    (tagName === "a" && (element.hasAttribute?.("href") ?? false)) ||
    role === "button" ||
    role === "link" ||
    role === "menuitem" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "switch" ||
    role === "tab" ||
    role === "textbox"
  ) {
    return true;
  }

  if (element.closest?.(presenterKeyboardIgnoredTargetSelector)) {
    return true;
  }

  if (element.parentElement?.closest?.(presenterKeyboardIgnoredTargetSelector)) {
    return true;
  }

  return false;
}

export function isPresenterKeyboardEditableTarget(target: EventTarget | null) {
  return isPresenterKeyboardIgnoredTarget(target);
}
