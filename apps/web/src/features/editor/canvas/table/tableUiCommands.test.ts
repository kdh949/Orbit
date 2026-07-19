import { createDemoDeck } from "@orbit/editor-core";
import type { DeckElement, TableElementProps } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import {
  createTableUiOperationPatch,
  getTableContextActionStates
} from "../../shell/hooks/useEditorCanvasCommands";

function tableElement(
  rows = 2,
  columns = 2
): Extract<DeckElement, { type: "table" }> {
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
  const props: TableElementProps = {
    borderColor: "#94A3B8",
    borderWidth: 1,
    columnWidths: Array.from({ length: columns }, () => 200),
    rowHeights: Array.from({ length: rows }, () => 80),
    rows: Array.from({ length: rows }, (_, rowIndex) =>
      Array.from({ length: columns }, (_, columnIndex) =>
        cell(`${rowIndex}:${columnIndex}`)
      )
    )
  };
  return {
    elementId: "el_table",
    height: 160,
    locked: false,
    opacity: 1,
    props,
    rotation: 0,
    type: "table",
    visible: true,
    width: 400,
    x: 100,
    y: 100,
    zIndex: 1
  };
}

describe("table UI commands", () => {
  it("creates one update_element_props operation for a selected-cell action", () => {
    const deck = createDemoDeck();
    deck.slides[0]!.elements = [tableElement()];

    const result = createTableUiOperationPatch({
      deck,
      elementId: "el_table",
      operation: { index: 1, type: "insert_row" },
      slideId: deck.slides[0]!.slideId
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.patch.operations).toHaveLength(1);
    expect(result.patch.operations[0]).toMatchObject({
      elementId: "el_table",
      type: "update_element_props"
    });
  });

  it("enables merge for a rectangular authored selection and unmerge for its anchor", () => {
    const deck = createDemoDeck();
    const element = tableElement();
    deck.slides[0]!.elements = [element];

    const selected = getTableContextActionStates({
      deck,
      element,
      selection: {
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
    });
    expect(selected.mergeCells).toEqual({ enabled: true, reason: null });
    expect(selected.unmergeCell).toMatchObject({ enabled: false });

    element.props.rows[0]![0] = {
      ...element.props.rows[0]![0]!,
      colSpan: 2,
      rowSpan: 2,
    };
    const merged = getTableContextActionStates({
      deck,
      element,
      selection: {
        startRowIndex: 0,
        endRowIndex: 0,
        startColumnIndex: 0,
        endColumnIndex: 0,
      },
    });
    expect(merged.unmergeCell).toEqual({ enabled: true, reason: null });
  });

  it("disables last-row and last-column deletion with a visible Korean reason", () => {
    const deck = createDemoDeck();
    const element = tableElement(1, 1);
    deck.slides[0]!.elements = [element];

    const states = getTableContextActionStates({ deck, element });

    expect(states.deleteRow).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("마지막 행")
    });
    expect(states.deleteColumn).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("마지막 열")
    });
  });

  it("fails closed for imported structural edits while preserving enabled cell text", () => {
    const deck = createDemoDeck();
    deck.metadata.sourceType = "import";
    const element = {
      ...tableElement(),
      ooxmlEditCapabilities: {
        crop: "none" as const,
        delete: false,
        frame: false,
        imageSource: false,
        richText: "none" as const,
        tableCellText: true
      },
      ooxmlOrigin: "imported" as const
    };
    deck.slides[0]!.elements = [element];

    const states = getTableContextActionStates({ deck, element });

    expect(states.cellText).toEqual({ enabled: true, reason: null });
    expect(states.insertRowAbove).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("가져온 표")
    });
    expect(states.insertColumnLeft).toMatchObject({ enabled: false });
    expect(states.mergeCells).toMatchObject({ enabled: false
  });
    expect(states.unmergeCell).toMatchObject({ enabled: false });
  });

  it("fails closed when imported table provenance is missing", () => {
    const deck = createDemoDeck();
    deck.metadata.sourceType = "import";
    const element = tableElement();
    deck.slides[0]!.elements = [element];

    const states = getTableContextActionStates({ deck, element });

    expect(states.cellText).toMatchObject({ enabled: false });
    expect(states.insertRowAbove).toMatchObject({ enabled: false });
  });

  it("allows authored table structure edits in an imported Deck", () => {
    const deck = createDemoDeck();
    deck.metadata.sourceType = "import";
    const element = { ...tableElement(), ooxmlOrigin: "authored" as const };
    deck.slides[0]!.elements = [element];

    const states = getTableContextActionStates({ deck, element });

    expect(states.cellText).toEqual({ enabled: true, reason: null });
    expect(states.insertRowBelow).toEqual({ enabled: true, reason: null });
    expect(states.mergeCells).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("OOXML"),
  });
});
});
