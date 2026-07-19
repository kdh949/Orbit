import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import {
  beginSlideRailDrag,
  cancelSlideRailDrag,
  resolveSlideRailDrop,
  updateSlideRailDragTarget,
  type SlideRailDragState,
} from "../slideRailDragModel";
import {
  getSlideRailKeyboardTargetSlideId,
  type SlideRailItem,
} from "../slideRailModel";
import { IdBadge } from "./EditorIdBadge";

export type SlideRailProps = {
  canMutate: boolean;
  canvasAspectRatio: string;
  collapsed?: boolean;
  items: readonly SlideRailItem[];
  onDelete: (slideId: string) => void;
  onDuplicate: (slideId: string) => void;
  onMove: (slideId: string, direction: "down" | "up") => void;
  onReorder: (orderedSlideIds: readonly string[]) => void;
  onSelect: (slideId: string) => void;
  showIds?: boolean;
  thumbnailBackgrounds?: Readonly<Record<string, string>>;
  thumbnailContents?: Readonly<Record<string, ReactNode>>;
  viewMode: "list" | "thumbnail";
};

type PendingSlideRailDrag = {
  pointerId: number;
  slideId: string;
  startX: number;
  startY: number;
};

export function SlideRail(props: SlideRailProps) {
  const [openMenuSlideId, setOpenMenuSlideId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<SlideRailDragState | null>(null);
  const dragStateRef = useRef<SlideRailDragState | null>(null);
  const pendingDragRef = useRef<PendingSlideRailDrag | null>(null);
  const selectionButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (!dragState && !pendingDragRef.current) return;

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      pendingDragRef.current = null;
      dragStateRef.current = cancelSlideRailDrag();
      setDragState(null);
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [dragState]);

  function selectAndFocus(slideId: string) {
    props.onSelect(slideId);
    requestAnimationFrame(() => selectionButtonRefs.current.get(slideId)?.focus());
  }

  function handleSelectionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    slideId: string,
  ) {
    if (event.key === "Delete" || event.key === "Backspace") {
      const item = props.items.find((candidate) => candidate.slideId === slideId);
      if (!props.canMutate || !item?.canDelete) return;

      event.preventDefault();
      event.stopPropagation();
      props.onDelete(slideId);
      return;
    }

    const targetSlideId = getSlideRailKeyboardTargetSlideId({
      currentSlideId: slideId,
      items: props.items,
      key: event.key,
    });
    if (!targetSlideId) return;

    event.preventDefault();
    selectAndFocus(targetSlideId);
  }

  function refocusSelectionButton(slideId: string) {
    requestAnimationFrame(() => selectionButtonRefs.current.get(slideId)?.focus());
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>, slideId: string) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setOpenMenuSlideId(null);
    refocusSelectionButton(slideId);
  }

  function handleDragStart(event: PointerEvent<HTMLButtonElement>, slideId: string) {
    if (!props.canMutate || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pendingDragRef.current = {
      pointerId: event.pointerId,
      slideId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function handleSlideContextMenu(
    event: MouseEvent<HTMLButtonElement>,
    slideId: string,
  ) {
    if (!props.canMutate) return;
    event.preventDefault();
    props.onSelect(slideId);
    setOpenMenuSlideId(slideId);
  }

  function handleDragMove(event: PointerEvent<HTMLElement>) {
    let current = dragStateRef.current;
    const pending = pendingDragRef.current;
    if (!current && pending?.pointerId === event.pointerId) {
      const distance = Math.hypot(
        event.clientX - pending.startX,
        event.clientY - pending.startY,
      );
      if (distance < 6) return;
      event.preventDefault();
      current = beginSlideRailDrag(event.pointerId, pending.slideId);
      dragStateRef.current = current;
      pendingDragRef.current = null;
      setDragState(current);
    }
    if (!current || current.pointerId !== event.pointerId) return;

    const hit = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-slide-rail-row-id]");
    const slideId = hit?.dataset.slideRailRowId;
    if (!hit || !slideId) return;

    const rect = hit.getBoundingClientRect();
    const edge = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    const nextState = updateSlideRailDragTarget(current, slideId, edge);
    dragStateRef.current = nextState;
    setDragState(nextState);
  }

  function finishDrag(event: PointerEvent<HTMLElement>) {
    if (pendingDragRef.current?.pointerId === event.pointerId) {
      pendingDragRef.current = null;
      return;
    }
    const current = dragStateRef.current;
    if (!current || current.pointerId !== event.pointerId) return;

    const reordered = resolveSlideRailDrop(
      current,
      props.items.map((item) => item.slideId),
    );
    dragStateRef.current = null;
    setDragState(null);
    if (reordered) props.onReorder(reordered);
  }

  function cancelDrag(event: PointerEvent<HTMLElement>) {
    if (pendingDragRef.current?.pointerId === event.pointerId) {
      pendingDragRef.current = null;
    }
    const current = dragStateRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    dragStateRef.current = cancelSlideRailDrag();
    setDragState(null);
  }

  return (
    <nav
      aria-label="슬라이드 목록"
      className={`slide-rail ${props.collapsed ? "collapsed" : ""}`}
      onPointerCancel={cancelDrag}
      onPointerMove={handleDragMove}
      onPointerUp={finishDrag}
    >
      <div
        aria-label="슬라이드 선택"
        className={`slides-list ${props.viewMode}-view`}
        role="listbox"
      >
        {props.items.map((item) => {
          const isMenuOpen = openMenuSlideId === item.slideId;
          const dropTarget = dragState?.target?.slideId === item.slideId
            ? dragState.target
            : null;
          const menuId = `slide-rail-menu-${item.slideId}`;

          return (
            <div
              className={`slide-rail-row ${item.isSelected ? "active" : ""}`}
              data-slide-rail-row-id={item.slideId}
              key={item.slideId}
              role="presentation"
            >
              {dropTarget?.edge === "before" ? <DropIndicator /> : null}
              <button
                aria-current={item.isSelected ? "true" : undefined}
                aria-label={`${item.index + 1}. ${item.title}`}
                aria-selected={item.isSelected}
                className={`slide-item ${item.isSelected ? "active" : ""} ${props.canMutate ? "is-draggable" : ""} ${dragState?.sourceSlideId === item.slideId ? "is-dragging" : ""}`}
                data-slide-id={item.slideId}
                ref={(node) => setButtonRef(selectionButtonRefs.current, item.slideId, node)}
                role="option"
                tabIndex={item.isSelected ? 0 : -1}
                type="button"
                onClick={() => props.onSelect(item.slideId)}
                onContextMenu={(event) => handleSlideContextMenu(event, item.slideId)}
                onKeyDown={(event) => handleSelectionKeyDown(event, item.slideId)}
                onPointerDown={(event) => handleDragStart(event, item.slideId)}
              >
                {!props.collapsed && props.viewMode === "thumbnail" ? (
                  <span
                    aria-hidden="true"
                    className="slide-thumb orbit-thumb"
                    style={{
                      aspectRatio: props.canvasAspectRatio,
                      background: props.thumbnailBackgrounds?.[item.slideId],
                    }}
                  >
                    <span className="slide-number">{item.index + 1}</span>
                    {props.thumbnailContents?.[item.slideId]}
                  </span>
                ) : (
                  <>
                    <span aria-hidden="true" className="slide-number">{item.index + 1}</span>
                    <span className="slide-title">
                      <span className="slide-title-text">{item.title}</span>
                      {props.showIds ? <IdBadge id={item.slideId} /> : null}
                    </span>
                  </>
                )}
              </button>

              {props.canMutate && !props.collapsed ? (
                <div
                  aria-label={`${item.title} 작업`}
                  className="slide-rail-menu"
                  hidden={!isMenuOpen}
                  id={menuId}
                  role="menu"
                  onKeyDown={(event) => handleMenuKeyDown(event, item.slideId)}
                >
                  <button role="menuitem" type="button" onClick={() => {
                    setOpenMenuSlideId(null);
                    props.onDuplicate(item.slideId);
                  }}>복제</button>
                  <button
                    disabled={!item.canMoveUp}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setOpenMenuSlideId(null);
                      props.onMove(item.slideId, "up");
                      refocusSelectionButton(item.slideId);
                    }}
                  >위로 이동</button>
                  <button
                    disabled={!item.canMoveDown}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setOpenMenuSlideId(null);
                      props.onMove(item.slideId, "down");
                      refocusSelectionButton(item.slideId);
                    }}
                  >아래로 이동</button>
                  <button
                    disabled={!item.canDelete}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setOpenMenuSlideId(null);
                      props.onDelete(item.slideId);
                    }}
                  >삭제</button>
                </div>
              ) : null}
              {dropTarget?.edge === "after" ? <DropIndicator /> : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function DropIndicator() {
  return (
    <span
      aria-hidden="true"
      className="slide-rail-drop-indicator"
      data-slide-rail-drop-indicator="true"
    />
  );
}

function setButtonRef(
  refs: Map<string, HTMLButtonElement>,
  slideId: string,
  node: HTMLButtonElement | null,
) {
  if (node) refs.set(slideId, node);
  else refs.delete(slideId);
}
