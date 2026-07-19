import { createDemoDeck } from "@orbit/editor-core";
import type { DeckElement } from "@orbit/shared";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  editorShellUiInitialState,
  getTableCellTargetRange,
  useEditorShellUiStore
} from "../../shell/editorShellUiStore";
import {
  clearDisabledTableInteraction,
  TableCellHitTargets
} from "./TableCellHitTargets";

const rectProps: Array<Record<string, any>> = [];

vi.mock("react-konva", () => ({
  Rect: (props: Record<string, any> & { children?: ReactNode }) => {
    rectProps.push(props);
    return (
      <div
        data-column={props["data-table-column-index"]}
        data-height={props.height}
        data-row={props["data-table-row-index"]}
        data-width={props.width}
        data-x={props.x}
        data-y={props.y}
      >
        {props.children}
      </div>
    );
  }
}));

function tableElement(): Extract<DeckElement, { type: "table" }> {
  const cell = (text: string) => ({
    align: "left" as const,
    borderColor: "#CBD5E1",
    borderWidth: 1,
    colSpan: 1,
    fill: "#FFFFFF",
    fontSize: 18,
    fontWeight: "normal" as const,
    rowSpan: 1,
    text,
    verticalAlign: "middle" as const
  });
  return {
    elementId: "el_table_hit",
    height: 100,
    locked: false,
    opacity: 1,
    props: {
      borderColor: "#94A3B8",
      borderWidth: 1,
      columnWidths: [100, 300],
      rowHeights: [100],
      rows: [[cell("A1"), cell("A2")]]
    },
    rotation: 30,
    type: "table",
    visible: true,
    width: 400,
    x: 40,
    y: 60,
    zIndex: 1
  };
}

describe("TableCellHitTargets", () => {
  beforeEach(() => {
    rectProps.length = 0;
    useEditorShellUiStore.setState(editorShellUiInitialState);
  });

  afterEach(() => {
    useEditorShellUiStore.setState(editorShellUiInitialState);
  });

  it("renders hit rects from the same proportional bounds as the renderer", () => {
    const deck = createDemoDeck();
    const element = tableElement();
    const slide = { ...deck.slides[0]!, elements: [element] };

    const html = renderToStaticMarkup(
      <TableCellHitTargets
        deck={deck}
        disabled={false}
        element={element}
        frame={element}
        isSelected
        selectionColor="#0068b7"
        slide={slide}
        stageScale={0.5}
        onOpenContextMenu={vi.fn()}
        onSelect={vi.fn()}
      />
    );

    expect(html).toContain(
      'data-column="0" data-height="100" data-row="0" data-width="100" data-x="0" data-y="0"'
    );
    expect(html).toContain(
      'data-column="1" data-height="100" data-row="0" data-width="300" data-x="100" data-y="0"'
    );
  });

  it("double-click selects one cell and opens its editor without changing table data", () => {
    const deck = createDemoDeck();
    const element = tableElement();
    const slide = { ...deck.slides[0]!, elements: [element] };
    const before = structuredClone(element.props);
    const onSelect = vi.fn();

    renderToStaticMarkup(
      <TableCellHitTargets
        deck={deck}
        disabled={false}
        element={element}
        frame={element}
        isSelected
        selectionColor="#0068b7"
        slide={slide}
        stageScale={1}
        onOpenContextMenu={vi.fn()}
        onSelect={onSelect}
      />
    );
    const secondCell = rectProps.find(
      (props) => props["data-table-column-index"] === 1
    );
    const event = { cancelBubble: false, evt: {} };
    secondCell?.onDblClick(event);

    expect(event.cancelBubble).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(false);
    expect(useEditorShellUiStore.getState().activeTableCell).toMatchObject({
      columnIndex: 1,
      elementId: element.elementId,
      rowIndex: 0
    });
    expect(useEditorShellUiStore.getState().editingElementId).toBe(
      element.elementId
    );
    expect(element.props).toEqual(before);
  });

  it("extends a rectangular cell selection with Shift-click", () => {
    const deck = createDemoDeck();
    const element = tableElement();
    element.props.rowHeights = [50, 50];
    element.props.rows = [
      element.props.rows[0]!,
      structuredClone(element.props.rows[0]!),
    ];
    const slide = { ...deck.slides[0]!, elements: [element] };

    renderToStaticMarkup(
      <TableCellHitTargets
        deck={deck}
        disabled={false}
        element={element}
        frame={element}
        isSelected
        selectionColor="#0068b7"
        slide={slide}
        stageScale={1}
        onOpenContextMenu={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    rectProps
      .find(
        (props) =>
          props["data-table-row-index"] === 0 &&
          props["data-table-column-index"] === 0,
      )
      ?.onClick({ cancelBubble: false, evt: { shiftKey: false } });
    rectProps
      .find(
        (props) =>
          props["data-table-row-index"] === 1 &&
          props["data-table-column-index"] === 1,
      )
      ?.onClick({ cancelBubble: false, evt: { shiftKey: true } });

    const target = useEditorShellUiStore.getState().activeTableCell;
    expect(target).toMatchObject({
      anchorColumnIndex: 0,
      anchorRowIndex: 0,
      columnIndex: 1,
      rowIndex: 1,
    });
    expect(getTableCellTargetRange(target!)).toEqual({
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: 1,
    });
  });

  it("clears active cell and editor state when interaction becomes disabled", () => {
    const setActiveTableCell = vi.fn();
    const setEditingElementId = vi.fn();

    clearDisabledTableInteraction({
      activeTableCell: {
        cellEditDisabledReason: null,
        columnIndex: 1,
        elementId: "el_table_hit",
        rowIndex: 0,
        slideId: "slide_1"
      },
      disabled: true,
      editingElementId: "el_table_hit",
      elementId: "el_table_hit",
      setActiveTableCell,
      setEditingElementId
    });

    expect(setActiveTableCell).toHaveBeenCalledWith(null);
    expect(setEditingElementId).toHaveBeenCalledWith(null);
  });
});
