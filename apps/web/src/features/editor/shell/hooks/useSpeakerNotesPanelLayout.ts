import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { useEffect, useRef, useState } from "react";

const defaultHeight = 240;
const initialHeight = 360;
export const minSpeakerNotesPanelHeight = 120;
const hideThreshold = 84;
const keyboardStep = 24;
const defaultViewportHeight = 960;
const maxViewportHeightRatio = 2 / 3;

export function getSpeakerNotesPanelMaxHeight(viewportHeight: number) {
  return Math.max(
    minSpeakerNotesPanelHeight,
    Math.floor(viewportHeight * maxViewportHeightRatio),
  );
}

export function useSpeakerNotesPanelLayout(args: {
  projectId: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [height, setHeight] = useState(defaultHeight);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const heightRef = useRef(defaultHeight);
  const hasExpandedRef = useRef(false);
  const shouldMeasureInitialHeightRef = useRef(false);

  function getMaxHeight() {
    return getSpeakerNotesPanelMaxHeight(
      typeof window === "undefined" ? defaultViewportHeight : window.innerHeight,
    );
  }

  function commitHeight(nextHeight: number) {
    const clamped = Math.min(
      getMaxHeight(),
      Math.max(minSpeakerNotesPanelHeight, nextHeight)
    );
    heightRef.current = clamped;
    setHeight(clamped);
    setIsExpanded(true);
  }

  function collapse() {
    setIsExpanded(false);
    setIsMaximized(false);
    setIsResizing(false);
  }

  function toggle() {
    if (isExpanded) {
      collapse();
      return;
    }
    setIsExpanded(true);
    if (!hasExpandedRef.current) {
      hasExpandedRef.current = true;
      shouldMeasureInitialHeightRef.current = true;
    }
  }

  function toggleMaximized() {
    setIsExpanded(true);
    setIsMaximized((current) => !current);
    if (!hasExpandedRef.current) {
      hasExpandedRef.current = true;
      shouldMeasureInitialHeightRef.current = true;
    }
  }

  function handleResizeStart(
    event: ReactPointerEvent<HTMLButtonElement>,
    isEditing: boolean
  ) {
    if (isEditing) return;
    event.preventDefault();
    const startClientY = event.clientY;
    const startHeight = heightRef.current;
    setIsResizing(true);

    function handlePointerMove(pointerEvent: PointerEvent) {
      const nextHeight = startHeight + (startClientY - pointerEvent.clientY);
      if (nextHeight < hideThreshold) {
        collapse();
        return;
      }
      commitHeight(nextHeight);
    }

    function finishResize() {
      setIsResizing(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  function handleResizeKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    isEditing: boolean
  ) {
    if (isEditing) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      commitHeight(heightRef.current + keyboardStep);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextHeight = heightRef.current - keyboardStep;
      if (nextHeight < minSpeakerNotesPanelHeight) collapse();
      else commitHeight(nextHeight);
    }
  }

  useEffect(() => {
    setIsExpanded(false);
    setIsMaximized(false);
    hasExpandedRef.current = false;
    shouldMeasureInitialHeightRef.current = false;
    setHeight(defaultHeight);
    heightRef.current = defaultHeight;
  }, [args.projectId]);

  useEffect(() => {
    function clampHeightToViewport() {
      const maxHeight = getSpeakerNotesPanelMaxHeight(window.innerHeight);
      if (heightRef.current <= maxHeight) return;
      heightRef.current = maxHeight;
      setHeight(maxHeight);
    }

    window.addEventListener("resize", clampHeightToViewport);
    return () => window.removeEventListener("resize", clampHeightToViewport);
  }, []);

  useEffect(() => {
    if (!isExpanded || !shouldMeasureInitialHeightRef.current || !contentRef.current) {
      return;
    }
    shouldMeasureInitialHeightRef.current = false;
    commitHeight(Math.max(initialHeight, contentRef.current.scrollHeight + 65));
  }, [isExpanded]);

  return {
    actions: {
      expand: () => setIsExpanded(true),
      getMaxHeight,
      handleResizeKeyDown,
      handleResizeStart,
      toggle,
      toggleMaximized
    },
    refs: { contentRef },
    state: { height, isExpanded, isMaximized, isResizing }
  };
}
