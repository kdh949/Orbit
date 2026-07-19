import type { Deck, Slide } from "@orbit/shared";
import type Konva from "konva";
import { Rect as KonvaRect } from "react-konva";
import type { ComponentType } from "react";
import { useEffect } from "react";

import { getTableLayout } from "../../../slides/rendering/tableLayout";
import type { TableCellTarget } from "../../shell/editorShellUiStore";
import {
  getTableCellTargetRange, useEditorShellUiStore, } from "../../shell/editorShellUiStore";
import { getTableContextActionStates } from "../../shell/hooks/useEditorCanvasCommands";
import { TableCellEditorOverlay } from "./TableCellEditorOverlay";

type KonvaComponent = ComponentType<any>;
const Rect = KonvaRect as unknown as KonvaComponent;

type TableElement = Extract<Slide["elements"][number], { type: "table" }>;

export function clearDisabledTableInteraction(args: {
  activeTableCell: TableCellTarget | null;
  disabled: boolean;
  editingElementId: string | null;
  elementId: string;
  setActiveTableCell: (value: null) => void;
  setEditingElementId: (value: null) => void;
}) {
  if (!args.disabled) return;
  if (args.activeTableCell?.elementId === args.elementId) {
    args.setActiveTableCell(null);
  }
  if (args.editingElementId === args.elementId) {
    args.setEditingElementId(null);
  }
}

export function TableCellHitTargets(props: {
  deck: Deck;
  disabled: boolean;
  element: TableElement;
  frame: {
    height: number;
    rotation: number;
    width: number;
    x: number;
    y: number;
  };
  isSelected: boolean;
  selectionColor: string;
  slide: Slide;
  stageScale: number;
  onOpenContextMenu: (clientX: number, clientY: number) => void;
  onSelect: (append: boolean) => void;
}) {
  const activeTableCell = useEditorShellUiStore((state) => state.activeTableCell);
  const editingElementId = useEditorShellUiStore(
    (state) => state.editingElementId
  );
  const setActiveTableCell = useEditorShellUiStore(
    (state) => state.setActiveTableCell
  );
  const setEditingElementId = useEditorShellUiStore(
    (state) => state.setEditingElementId
  );
  const setTableOperationRequest = useEditorShellUiStore(
    (state) => state.setTableOperationRequest
  );
  const layout = getTableLayout(props.element.props, props.frame);
  const capability = getTableContextActionStates({
    deck: props.deck,
    element: props.element
  });
  const activeCellLayout =
    activeTableCell?.elementId === props.element.elementId &&
    activeTableCell.slideId === props.slide.slideId
      ? (layout.cells.find(
          (cell) =>
            cell.rowIndex === activeTableCell.rowIndex &&
            cell.columnIndex === activeTableCell.columnIndex
        ) ?? null)
      : null;
  const activeCellRange =
    activeTableCell?.elementId === props.element.elementId &&
    activeTableCell.slideId === props.slide.slideId
      ? getTableCellTargetRange(activeTableCell)
      : null;

  function selectCell(rowIndex: number, columnIndex: number, append = false) {
    if (props.disabled) return;
    const current = useEditorShellUiStore.getState().activeTableCell;
    const extendCurrentRange =
      append &&
      current?.elementId === props.element.elementId &&
      current.slideId === props.slide.slideId;
    setActiveTableCell({
      anchorColumnIndex: extendCurrentRange
        ? (current.anchorColumnIndex ?? current.columnIndex)
        : columnIndex,
      anchorRowIndex: extendCurrentRange
        ? (current.anchorRowIndex ?? current.rowIndex)
        : rowIndex,
      cellEditDisabledReason: capability.cellText.enabled
        ? null
        : capability.cellText.reason,
      columnIndex,
      elementId: props.element.elementId,
      rowIndex,
      slideId: props.slide.slideId
    });
    props.onSelect(false);
  }

  function startEditing(rowIndex: number, columnIndex: number) {
    if (props.disabled) return;
    selectCell(rowIndex, columnIndex);
    if (capability.cellText.enabled) {
      setEditingElementId(props.element.elementId);
    }
  }

  useEffect(() => {
    clearDisabledTableInteraction({
      activeTableCell,
      disabled: props.disabled,
      editingElementId,
      elementId: props.element.elementId,
      setActiveTableCell,
      setEditingElementId
    });
  }, [
    activeTableCell?.elementId,
    editingElementId,
    props.element.elementId,
    props.disabled,
    setActiveTableCell,
    setEditingElementId
  ]);

  useEffect(() => {
    if (
      !props.isSelected ||
      props.disabled ||
      !activeCellLayout ||
      editingElementId === props.element.elementId
    ) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, textarea, select, button, [contenteditable]:not([contenteditable='false'])"
        )
      ) {
        return;
      }
      if (!capability.cellText.enabled) return;
      event.preventDefault();
      setEditingElementId(props.element.elementId);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeCellLayout,
    capability.cellText.enabled,
    editingElementId,
    props.element.elementId,
    props.disabled,
    props.isSelected,
    setEditingElementId
  ]);

  return (
    <>
      {layout.cells.map((cellLayout) => {
        const selected =
          props.isSelected &&
          activeCellRange !== null &&
          cellLayout.rowIndex <= activeCellRange.endRowIndex && cellLayout.rowIndex + Math.max(1, cellLayout.cell.rowSpan) - 1 >=
            activeCellRange.startRowIndex &&
          cellLayout.columnIndex <= activeCellRange.endColumnIndex && cellLayout.columnIndex + Math.max(1, cellLayout.cell.colSpan) - 1 >=
            activeCellRange.startColumnIndex;

        return (
          <Rect
            data-table-column-index={cellLayout.columnIndex}
            data-table-row-index={cellLayout.rowIndex}
            fill="rgba(15, 23, 42, 0.001)"
            height={Math.max(1, cellLayout.height)}
            key={`table-cell-hit-${cellLayout.rowIndex}-${cellLayout.columnIndex}`}
            listening={!props.disabled}
            stroke={selected ? props.selectionColor : "transparent"}
            strokeWidth={selected ? 2 : 0}
            width={Math.max(1, cellLayout.width)}
            x={cellLayout.x}
            y={cellLayout.y}
            onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
              event.cancelBubble = true;
              selectCell(
                cellLayout.rowIndex,
                cellLayout.columnIndex,
                event.evt.shiftKey
              );
            }}
            onContextMenu={(event: Konva.KonvaEventObject<PointerEvent>) => {
              event.cancelBubble = true;
              event.evt.preventDefault();
              const current = useEditorShellUiStore.getState().activeTableCell;
              const currentRange =
                current?.elementId === props.element.elementId &&
                current.slideId === props.slide.slideId
                  ? getTableCellTargetRange(current)
                  : null;
              if (
                !currentRange ||
                cellLayout.rowIndex < currentRange.startRowIndex ||
                cellLayout.rowIndex > currentRange.endRowIndex ||
                cellLayout.columnIndex < currentRange.startColumnIndex ||
                cellLayout.columnIndex > currentRange.endColumnIndex
              ) {
              selectCell(cellLayout.rowIndex, cellLayout.columnIndex);
              }
              props.onOpenContextMenu(event.evt.clientX, event.evt.clientY);
            }}
            onDblClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
              event.cancelBubble = true;
              startEditing(cellLayout.rowIndex, cellLayout.columnIndex);
            }}
            onTap={(event: Konva.KonvaEventObject<TouchEvent>) => {
              event.cancelBubble = true;
              selectCell(cellLayout.rowIndex, cellLayout.columnIndex);
            }}
          />
        );
      })}
      {!props.disabled &&
      editingElementId === props.element.elementId &&
      activeCellLayout ? (
        <TableCellEditorOverlay
          cell={activeCellLayout.cell}
          cellLayout={activeCellLayout}
          columnIndex={activeCellLayout.columnIndex}
          element={{
            elementId: props.element.elementId,
            rotation: props.frame.rotation,
            x: props.frame.x,
            y: props.frame.y
          }}
          rowIndex={activeCellLayout.rowIndex}
          stageScale={props.stageScale}
          onCommit={(text) =>
            setTableOperationRequest({
              action: "updateCellText",
              columnIndex: activeCellLayout.columnIndex,
              elementId: props.element.elementId,
              rowIndex: activeCellLayout.rowIndex,
              slideId: props.slide.slideId,
              text
            })
          }
          onFinish={() => setEditingElementId(null)}
        />
      ) : null}
    </>
  );
}
