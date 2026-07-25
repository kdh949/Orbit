import {
  IconColumnInsertLeft as ColumnInsertLeft,
  IconColumnInsertRight as ColumnInsertRight,
  IconArrowRight as MoveRight,
  IconChartBar as BarChart,
  IconChartLine as LineChart,
  IconChartPie as PieChart,
  IconCircle as Circle,
  IconHexagon as Polygon,
  IconMinus as Minus,
  IconPencil as PenLine,
  IconPhotoPlus as ImagePlus,
  IconScissors as Scissors,
  IconCopy as Copy,
  IconClipboard as Clipboard,
  IconCrop as Crop,
  IconLayersIntersect as Layers,
  IconAlignBoxCenterMiddle as Align,
  IconSparkles as Sparkles,
  IconTextCaption as TextCaption,
  IconChevronRight as ChevronRight,
  IconRowInsertBottom as RowInsertBottom,
  IconRowInsertTop as RowInsertTop,
  IconRectangle as Rectangle,
  IconShape as Shapes,
  IconStar as Star,
  IconTable as Table,
  IconTrash as Trash,
  IconTriangle as Triangle
} from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

import type {
  ElementContextMenuState,
  ShapeMenuPosition,
  TableContextAction
} from "../editorShellUiStore";
import { useEditorShellUiStore } from "../editorShellUiStore";
import type { ChartInsertType } from "./EditorToolbar";

export type ShapeInsertType =
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "triangle"
  | "polygon"
  | "star"
  | "customShape";

export type ImageContextMenuAction =
  | "cut" | "copy" | "paste" | "crop" | "replace"
  | "bring-to-front" | "bring-forward" | "send-backward" | "send-to-back"
  | "align-left" | "align-center-x" | "align-right"
  | "align-top" | "align-center-y" | "align-bottom"
  | "add-animation" | "open-alt-text" | "delete";

export function EditorContextMenus(props: {
  chartMenuPosition: ShapeMenuPosition | null;
  elementContextMenu: ElementContextMenuState | null;
  isChartMenuOpen: boolean;
  isImageUploadPending: boolean;
  isShapeMenuOpen: boolean;
  imageActionDisabledReasons?: Partial<Record<ImageContextMenuAction, string>>;
  onCloseChartMenu: () => void;
  onCloseElementContextMenu: () => void;
  onCloseShapeMenu: () => void;
  onCreateGroup: () => void;
  onInsertChart: (type: ChartInsertType) => void;
  onInsertShape: (shape: ShapeInsertType) => void;
  onImageAction?: (
    action: ImageContextMenuAction,
    target: { elementId: string; slideId: string },
  ) => void;
  onReplaceImage: (target: {
    elementId: string;
    slideId: string;
    type: "replace";
  }) => void;
  onUngroup: (slideId: string, elementId: string) => void;
  shapeMenuPosition: ShapeMenuPosition | null;
}) {
  const elementMenuRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!props.elementContextMenu) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") props.onCloseElementContextMenu();
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [props]);

  useEffect(() => {
    if (!props.elementContextMenu || typeof window === "undefined") return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const menu = elementMenuRef.current;
      const firstEnabledItem = menu?.querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)'
      );
      (firstEnabledItem ?? menu)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [props.elementContextMenu]);

  if (typeof document === "undefined") return null;
  const elementContextMenu = props.elementContextMenu;

  function requestTableAction(action: TableContextAction) {
    if (!elementContextMenu || elementContextMenu.type !== "table-cell") return;
    useEditorShellUiStore.getState().setTableOperationRequest({
      action,
      columnIndex: elementContextMenu.columnIndex,
      elementId: elementContextMenu.elementId,
      rowIndex: elementContextMenu.rowIndex,
      selection: elementContextMenu.selection,
      slideId: elementContextMenu.slideId
    });
    props.onCloseElementContextMenu();
  }

  function requestImageAction(action: ImageContextMenuAction) {
    if (!elementContextMenu || elementContextMenu.type !== "image") return;
    if (action === "replace" && !props.onImageAction) {
      props.onReplaceImage({
        elementId: elementContextMenu.elementId,
        slideId: elementContextMenu.slideId,
        type: "replace"
      });
    } else {
      props.onImageAction?.(action, {
        elementId: elementContextMenu.elementId,
        slideId: elementContextMenu.slideId
      });
    }
    props.onCloseElementContextMenu();
  }

  function handleElementMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[aria-haspopup="menu"]'
      );
      const firstChild = trigger?.parentElement?.querySelector<HTMLButtonElement>(
        '.element-context-submenu [role="menuitem"]:not(:disabled)'
      );
      if (firstChild) {
        event.preventDefault();
        firstChild.focus();
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      const submenu = (event.target as HTMLElement).closest<HTMLElement>(
        ".element-context-submenu"
      );
      const trigger = submenu?.parentElement?.querySelector<HTMLButtonElement>(
        ':scope > [aria-haspopup="menu"]'
      );
      if (trigger) {
        event.preventDefault();
        trigger.focus();
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)'
      )
    ).filter((item) => !item.closest(".element-context-submenu"));
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + items.length) % items.length;
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  return (
    <>
      {props.isChartMenuOpen && props.chartMenuPosition
        ? createPortal(
            <div className="shape-menu-overlay" onMouseDown={props.onCloseChartMenu}>
              <div
                className="shape-menu-popover"
                role="menu"
                style={props.chartMenuPosition}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <span className="shape-menu-title">차트 및 표</span>
                <ShapeMenuItem icon={<BarChart />} label="막대" onClick={() => props.onInsertChart("bar")} />
                <ShapeMenuItem icon={<LineChart />} label="선" onClick={() => props.onInsertChart("line")} />
                <ShapeMenuItem icon={<PieChart />} label="원형" onClick={() => props.onInsertChart("pie")} />
                <ShapeMenuItem icon={<Table />} label="표" onClick={() => props.onInsertChart("table")} />
              </div>
            </div>,
            document.body
          )
        : null}

      {props.isShapeMenuOpen && props.shapeMenuPosition
        ? createPortal(
            <div className="shape-menu-overlay" onMouseDown={props.onCloseShapeMenu}>
              <div
                className="shape-menu-popover"
                role="menu"
                style={props.shapeMenuPosition}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <span className="shape-menu-title">기본 도형</span>
                <ShapeMenuItem icon={<Rectangle />} label="사각형" onClick={() => props.onInsertShape("rect")} />
                <ShapeMenuItem icon={<Circle />} label="원" onClick={() => props.onInsertShape("ellipse")} />
                <ShapeMenuItem icon={<Triangle />} label="삼각형" onClick={() => props.onInsertShape("triangle")} />
                <ShapeMenuItem icon={<Polygon />} label="다각형" onClick={() => props.onInsertShape("polygon")} />
                <ShapeMenuItem icon={<Star />} label="별" onClick={() => props.onInsertShape("star")} />
                <ShapeMenuItem icon={<PenLine />} label="커스텀 도형 그리기" onClick={() => props.onInsertShape("customShape")} />
                <ShapeMenuItem icon={<Minus />} label="선" onClick={() => props.onInsertShape("line")} />
                <ShapeMenuItem icon={<MoveRight />} label="화살표" onClick={() => props.onInsertShape("arrow")} />
              </div>
            </div>,
            document.body
          )
        : null}

      {elementContextMenu
        ? createPortal(
            <div className="element-context-menu-overlay" onMouseDown={props.onCloseElementContextMenu}>
              <div
                aria-label={
                  elementContextMenu.type === "table-cell"
                    ? `표 ${elementContextMenu.rowIndex + 1}행 ${elementContextMenu.columnIndex + 1}열 메뉴`
                    : "요소 메뉴"
                }
                className="element-context-menu-popover"
                ref={elementMenuRef}
                role="menu"
                tabIndex={-1}
                style={{
                  left: clampContextCoordinate(
                    elementContextMenu.left,
                    typeof window === "undefined" ? undefined : window.innerWidth,
                    300
                  ),
                  top: clampContextCoordinate(
                    elementContextMenu.top,
                    typeof window === "undefined" ? undefined : window.innerHeight,
                    620
                  )
                }}
                onKeyDown={handleElementMenuKeyDown}
                onMouseDown={(event) => event.stopPropagation()}
              >
                {elementContextMenu.type === "table-cell" ? (
                  <TableContextMenuItems
                    disabledReasons={elementContextMenu.actionDisabledReasons}
                    onAction={requestTableAction}
                  />
                ) : elementContextMenu.type === "image" ? (
                  <ImageContextMenuItems
                    disabledReasons={props.imageActionDisabledReasons ?? {}}
                    imageUploadPending={props.isImageUploadPending}
                    onAction={requestImageAction}
                  />
                ) : elementContextMenu.type === "group" ? (
                  <button
                    className="element-context-menu-item"
                    role="menuitem"
                    type="button"
                    onClick={() =>
                      props.onUngroup(
                        elementContextMenu.slideId,
                        elementContextMenu.elementId
                      )
                    }
                  >
                    <Shapes size={16} /><span>그룹 해제</span>
                  </button>
                ) : (
                  <button className="element-context-menu-item" role="menuitem" type="button" onClick={props.onCreateGroup}>
                    <Shapes size={16} /><span>그룹화</span>
                  </button>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function ImageContextMenuItems(props: {
  disabledReasons: Partial<Record<ImageContextMenuAction, string>>;
  imageUploadPending: boolean;
  onAction: (action: ImageContextMenuAction) => void;
}) {
  return <>
    <ImageContextMenuItem action="cut" icon={<Scissors size={16} />} label="잘라내기" {...props} />
    <ImageContextMenuItem action="copy" icon={<Copy size={16} />} label="복사" {...props} />
    <ImageContextMenuItem action="paste" icon={<Clipboard size={16} />} label="붙여넣기" {...props} />
    <div className="element-context-menu-separator" role="separator" />
    <ImageContextMenuItem action="crop" icon={<Crop size={16} />} label="자르기" {...props} />
    <ImageContextMenuItem action="replace" disabledReason={props.imageUploadPending ? "이미지를 업로드하는 중입니다." : props.disabledReasons.replace} icon={<ImagePlus size={16} />} label={props.imageUploadPending ? "업로드 중..." : "이미지 바꾸기"} onAction={props.onAction} />
    <div className="element-context-menu-separator" role="separator" />
    <ImageContextSubmenu icon={<Layers size={16} />} label="레이어">
      <ImageContextMenuItem action="bring-to-front" icon={<Layers size={16} />} label="맨 앞으로" {...props} />
      <ImageContextMenuItem action="bring-forward" icon={<Layers size={16} />} label="앞으로" {...props} />
      <ImageContextMenuItem action="send-backward" icon={<Layers size={16} />} label="뒤로" {...props} />
      <ImageContextMenuItem action="send-to-back" icon={<Layers size={16} />} label="맨 뒤로" {...props} />
    </ImageContextSubmenu>
    <ImageContextSubmenu icon={<Align size={16} />} label="정렬">
      <ImageContextMenuItem action="align-left" icon={<Align size={16} />} label="왼쪽" {...props} />
      <ImageContextMenuItem action="align-center-x" icon={<Align size={16} />} label="가로 가운데" {...props} />
      <ImageContextMenuItem action="align-right" icon={<Align size={16} />} label="오른쪽" {...props} />
      <ImageContextMenuItem action="align-top" icon={<Align size={16} />} label="위쪽" {...props} />
      <ImageContextMenuItem action="align-center-y" icon={<Align size={16} />} label="세로 가운데" {...props} />
      <ImageContextMenuItem action="align-bottom" icon={<Align size={16} />} label="아래쪽" {...props} />
    </ImageContextSubmenu>
    <div className="element-context-menu-separator" role="separator" />
    <ImageContextMenuItem action="add-animation" icon={<Sparkles size={16} />} label="애니메이션 추가" {...props} />
    <ImageContextMenuItem action="open-alt-text" icon={<TextCaption size={16} />} label="대체 텍스트 열기" {...props} />
    <ImageContextMenuItem action="delete" icon={<Trash size={16} />} label="삭제" {...props} />
  </>;
}

function ImageContextSubmenu(props: { children: ReactNode; icon: ReactNode; label: string }) {
  return <div className="element-context-submenu-root">
    <button aria-haspopup="menu" className="element-context-menu-item" role="menuitem" type="button">
      {props.icon}<span>{props.label}</span><ChevronRight aria-hidden="true" className="element-context-submenu-chevron" size={16} />
    </button>
    <div aria-label={props.label} className="element-context-submenu" role="menu">{props.children}</div>
  </div>;
}

function ImageContextMenuItem(props: {
  action: ImageContextMenuAction;
  disabledReason?: string;
  disabledReasons?: Partial<Record<ImageContextMenuAction, string>>;
  icon: ReactNode;
  label: string;
  onAction: (action: ImageContextMenuAction) => void;
}) {
  const disabledReason = props.disabledReason ?? props.disabledReasons?.[props.action];
  return <button className="element-context-menu-item" disabled={Boolean(disabledReason)} role="menuitem" title={disabledReason} type="button" onClick={() => props.onAction(props.action)}>
    {props.icon}<span>{props.label}</span>
    {disabledReason ? <small>{disabledReason}</small> : null}
  </button>;
}

function clampContextCoordinate(coordinate: number, viewportSize: number | undefined, menuSize: number) {
  if (!viewportSize || !Number.isFinite(viewportSize)) return coordinate;
  return Math.max(8, Math.min(coordinate, viewportSize - menuSize - 8));
}

function TableContextMenuItems(props: {
  disabledReasons: Partial<Record<TableContextAction, string>>;
  onAction: (action: TableContextAction) => void;
}) {
  return (
    <>
      <TableContextMenuItem
        action="mergeCells"
        disabledReason={props.disabledReasons.mergeCells}
        icon={<Table size={16} />}
        label="셀 병합"
        onAction={props.onAction}
      />
      <TableContextMenuItem
        action="unmergeCell"
        disabledReason={props.disabledReasons.unmergeCell}
        icon={<Table size={16} />}
        label="셀 병합 해제"
        onAction={props.onAction}
      />
      <TableContextMenuItem
        action="insertRowAbove"
        disabledReason={props.disabledReasons.insertRowAbove}
        icon={<RowInsertTop size={16} />}
        label="위에 행 추가"
        onAction={props.onAction}
      />
      <TableContextMenuItem
        action="insertRowBelow"
        disabledReason={props.disabledReasons.insertRowBelow}
        icon={<RowInsertBottom size={16} />}
        label="아래에 행 추가"
        onAction={props.onAction}
      />
      <TableContextMenuItem
        action="insertColumnLeft"
        disabledReason={props.disabledReasons.insertColumnLeft}
        icon={<ColumnInsertLeft size={16} />}
        label="왼쪽에 열 추가"
        onAction={props.onAction}
      />
      <TableContextMenuItem
        action="insertColumnRight"
        disabledReason={props.disabledReasons.insertColumnRight}
        icon={<ColumnInsertRight size={16} />}
        label="오른쪽에 열 추가"
        onAction={props.onAction}
      />
      <TableContextMenuItem
        action="deleteRow"
        disabledReason={props.disabledReasons.deleteRow}
        icon={<Trash size={16} />}
        label="현재 행 삭제"
        onAction={props.onAction}
      />
      <TableContextMenuItem
        action="deleteColumn"
        disabledReason={props.disabledReasons.deleteColumn}
        icon={<Trash size={16} />}
        label="현재 열 삭제"
        onAction={props.onAction}
      />
    </>
  );
}

function TableContextMenuItem(props: {
  action: TableContextAction;
  disabledReason?: string;
  icon: ReactNode;
  label: string;
  onAction: (action: TableContextAction) => void;
}) {
  return (
    <button
      className="element-context-menu-item"
      disabled={Boolean(props.disabledReason)}
      role="menuitem"
      title={props.disabledReason}
      type="button"
      onClick={() => props.onAction(props.action)}
    >
      {props.icon}
      <span>{props.label}</span>
      {props.disabledReason ? <small>{props.disabledReason}</small> : null}
    </button>
  );
}

function ShapeMenuItem(props: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="shape-menu-item" role="menuitem" type="button" onClick={props.onClick}>
      <span aria-hidden="true" className="shape-menu-symbol">{props.icon}</span>
      <span>{props.label}</span>
    </button>
  );
}
