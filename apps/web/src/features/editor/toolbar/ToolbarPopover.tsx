import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import "./ToolbarPopover.css";

type ToolbarPopoverRenderArgs = {
  close: (restoreFocus?: boolean) => void;
};

export function getToolbarPopoverPosition(args: {
  content: { height: number; width: number };
  trigger: { bottom: number; left: number; top: number };
  viewport: { height: number; width: number };
}) {
  const viewportPadding = 8;
  const gap = 6;
  const below = args.trigger.bottom + gap;
  const above = args.trigger.top - args.content.height - gap;
  const top =
    below + args.content.height <= args.viewport.height - viewportPadding ||
    above < viewportPadding
      ? below
      : above;
  return {
    left: Math.max(
      viewportPadding,
      Math.min(
        args.viewport.width - args.content.width - viewportPadding,
        Math.max(viewportPadding, args.trigger.left),
      ),
    ),
    top: Math.max(viewportPadding, top),
  };
}

export function ToolbarPopover(props: {
  active?: boolean | "mixed";
  buttonClassName?: string;
  buttonContent: ReactNode;
  children: ReactNode | ((args: ToolbarPopoverRenderArgs) => ReactNode);
  contentLabel: string;
  contentRole?: "dialog" | "listbox" | "menu";
  disabled?: boolean;
  label: string;
  onOpenChange?: (isOpen: boolean) => void;
  onPreserveInteraction?: () => void;
}) {
  const contentId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const close = useCallback(
    (restoreFocus = true) => {
      setIsOpen(false);
      props.onOpenChange?.(false);
      if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [props.onOpenChange],
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const content = contentRef.current;
    if (!trigger || !content) return;
    const triggerRect = trigger.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    setPosition(
      getToolbarPopoverPosition({
        content: contentRect,
        trigger: triggerRect,
        viewport: { height: window.innerHeight, width: window.innerWidth },
      }),
    );
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const frame = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(frame);
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const controls = Array.from(
        contentRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [role="option"]:not([aria-disabled="true"])',
        ) ?? [],
      );
      if (controls.length === 0) return;
      event.preventDefault();
      const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? controls.length - 1
            : event.key === "ArrowUp"
              ? (currentIndex - 1 + controls.length) % controls.length
              : (currentIndex + 1) % controls.length;
      controls[nextIndex]?.focus();
    }
    function handleScroll(event: Event) {
      if (event.target === contentRef.current) return;
      close(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [close, isOpen, updatePosition]);

  function openPopover() {
    if (props.disabled) return;
    props.onPreserveInteraction?.();
    setIsOpen(true);
    props.onOpenChange?.(true);
  }

  function handleTriggerPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    props.onPreserveInteraction?.();
  }

  const content =
    isOpen && typeof document !== "undefined" && document.body
      ? createPortal(
          <div
            aria-label={props.contentLabel}
            className="editor-toolbar-popover"
            id={contentId}
            onPointerDownCapture={() => props.onPreserveInteraction?.()}
            ref={contentRef}
            role={props.contentRole ?? "dialog"}
            style={position}
          >
            {typeof props.children === "function"
              ? props.children({ close })
              : props.children}
          </div>,
          document.body,
        )
      : null;

  return (
    <span className="editor-toolbar-popover-anchor">
      <button
        aria-controls={isOpen ? contentId : undefined}
        aria-expanded={isOpen}
        aria-haspopup={props.contentRole ?? "dialog"}
        aria-label={props.label}
        aria-pressed={props.active}
        className={`editor-toolbar-popover-trigger ${props.buttonClassName ?? ""}`.trim()}
        disabled={props.disabled}
        ref={triggerRef}
        title={props.label}
        type="button"
        onClick={() => (isOpen ? close(false) : openPopover())}
        onPointerDown={handleTriggerPointerDown}
      >
        {props.buttonContent}
      </button>
      {content}
    </span>
  );
}
