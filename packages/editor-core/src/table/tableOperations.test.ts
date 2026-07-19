import type { Deck, TableCellProps, TableElementProps } from "@orbit/shared";
import { describe, expect, it } from "vitest";
import { createDemoDeck } from "../index";
import { applyDeckPatch } from "../patches/applyPatch";
import {
  createTableOperationPatch,
  getTableOperationCapability,
  getTableStructureCapability,
} from "./tableOperations";

function cell(
  text: string,
  overrides: Partial<TableCellProps> = {},
): TableCellProps {
  return {
    align: "left",
    borderColor: "#CBD5E1",
    borderWidth: 1,
    colSpan: 1,
    fill: "transparent",
    fontSize: 18,
    fontWeight: "normal",
    rowSpan: 1,
    text,
    verticalAlign: "middle",
    ...overrides,
  };
}

function createTableDeck(
  props: TableElementProps = {
    borderColor: "#94A3B8",
    borderWidth: 2,
    columnWidths: [120, 280],
    rowHeights: [40, 60],
    rows: [
      [
        cell("A1", { fill: "#EFF6FF", fontWeight: "bold" }),
        cell("A2", { fill: "#F8FAFC", textColor: "#1D4ED8" }),
      ],
      [
        cell("B1", { borderWidth: 3, fill: "#FEF3C7" }),
        cell("B2", { align: "center", fontSize: 22 }),
      ],
    ],
  },
): Deck {
  const deck = createDemoDeck();
  deck.slides[0]!.elements = [
    {
      elementId: "el_table",
      height: 200,
      locked: false,
      opacity: 1,
      props,
      rotation: 0,
      type: "table",
      visible: true,
      width: 400,
      x: 100,
      y: 100,
      zIndex: 0,
    },
  ];
  return deck;
}

function applySuccessfulTablePatch(
  deck: Deck,
  operation: Parameters<typeof createTableOperationPatch>[3],
) {
  const created = createTableOperationPatch(
    deck,
    "slide_1",
    "el_table",
    operation,
  );
  expect(created.ok).toBe(true);
  if (!created.ok) {
    throw new Error(
      `expected table operation patch, received ${created.reason}`,
    );
  }
  expect(created.patch.operations).toHaveLength(1);
  expect(created.patch.operations[0]).toMatchObject({
    elementId: "el_table",
    slideId: "slide_1",
    type: "update_element_props",
  });

  const applied = applyDeckPatch(deck, created.patch);
  expect(applied.ok).toBe(true);
  if (!applied.ok) {
    throw new Error(applied.error.message);
  }
  const table = applied.deck.slides[0]!.elements[0];
  expect(table?.type).toBe("table");
  if (!table || table.type !== "table") {
    throw new Error("expected patched table element");
  }
  return { created, props: table.props };
}

describe("table operation capability", () => {
  it("enables structural editing for a rectangular unmerged grid with aligned tracks", () => {
    const table = createTableDeck().slides[0]!.elements[0];
    if (!table || table.type !== "table") {
      throw new Error("expected table element");
    }

    expect(getTableStructureCapability(table.props)).toEqual({ enabled: true });
  });

  it("returns a stable disabled reason for a jagged grid", () => {
    const table = createTableDeck({
      borderColor: "#94A3B8",
      borderWidth: 1,
      rows: [[cell("A1"), cell("A2")], [cell("B1")]],
    }).slides[0]!.elements[0];
    if (!table || table.type !== "table") {
      throw new Error("expected table element");
    }

    expect(getTableStructureCapability(table.props)).toEqual({
      enabled: false,
      reason: "jagged-grid",
    });
  });

  it("accepts a rectangular grid with non-overlapping merged cells", () => {
    const table = createTableDeck({
      borderColor: "#94A3B8",
      borderWidth: 1,
      rows: [[cell("A1", { colSpan: 2 }), cell("A2")]],
    }).slides[0]!.elements[0];
    if (!table || table.type !== "table") {
      throw new Error("expected table element");
    }

    expect(getTableStructureCapability(table.props)).toEqual({ enabled: true });
  });

  it.each([
    ["row track", { rowHeights: [100] }, "row-track-mismatch"],
    ["column track", { columnWidths: [400] }, "column-track-mismatch"],
  ] as Array<
    [
      string,
      Partial<TableElementProps>,
      "row-track-mismatch" | "column-track-mismatch",
    ]
  >)(
    "returns a stable disabled reason for %s mismatch",
    (_, tracks, reason) => {
      const base = createTableDeck().slides[0]!.elements[0];
      if (!base || base.type !== "table") {
        throw new Error("expected table element");
      }
      const table = { ...base.props, ...tracks };

      expect(getTableStructureCapability(table)).toEqual({
        enabled: false,
        reason,
      });
    },
  );

  it("disables deletion of the last row and last column", () => {
    const oneCellTable: TableElementProps = {
      borderColor: "#94A3B8",
      borderWidth: 1,
      columnWidths: [400],
      rowHeights: [200],
      rows: [[cell("only")]],
    };

    expect(
      getTableOperationCapability(oneCellTable, {
        index: 0,
        type: "delete_row",
      }),
    ).toEqual({ enabled: false, reason: "last-row" });
    expect(
      getTableOperationCapability(oneCellTable, {
        index: 0,
        type: "delete_column",
      }),
    ).toEqual({ enabled: false, reason: "last-column" });
  });
});

describe("createTableOperationPatch", () => {
  it("merges and unmerges a rectangular range without losing covered cell data", () => {
    const deck = createTableDeck();
    const before = structuredClone(
      (
        deck.slides[0]!.elements[0] as Extract<
          Deck["slides"][number]["elements"][number],
          { type: "table" }
        >
      ).props,
    );

    const { props: merged } = applySuccessfulTablePatch(deck, {
      startRowIndex: 0,
      startColumnIndex: 0,
      endRowIndex: 1,
      endColumnIndex: 1,
      type: "merge_cells",
    });
    expect(merged.rows[0]![0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(merged.rows[0]![1]).toEqual(before.rows[0]![1]);
    expect(merged.rows[1]![0]).toEqual(before.rows[1]![0]);
    expect(merged.rows[1]![1]).toEqual(before.rows[1]![1]);

    const mergedDeck = structuredClone(deck);
    const mergedElement = mergedDeck.slides[0]!.elements[0];
    if (!mergedElement || mergedElement.type !== "table") {
      throw new Error("expected merged table element");
    }
    mergedElement.props = merged;
    const { props: unmerged } = applySuccessfulTablePatch(mergedDeck, {
      rowIndex: 0,
      columnIndex: 0,
      type: "unmerge_cell",
    });
    expect(unmerged).toEqual(before);
  });

  it("rejects a merge range that only partially contains an existing merge", () => {
    const deck = createTableDeck({
      borderColor: "#94A3B8",
      borderWidth: 1,
      rows: [
        [cell("A1", { colSpan: 2 }), cell("A2"), cell("A3")],
        [cell("B1"), cell("B2"), cell("B3")],
      ],
    });

    expect(
      createTableOperationPatch(deck, "slide_1", "el_table", {
        startRowIndex: 0,
        startColumnIndex: 1,
        endRowIndex: 1,
        endColumnIndex: 2,
        type: "merge_cells",
      }),
    ).toEqual({
      ok: false,
      reason: "selection-partially-overlaps-merged-cell",
    });
  });

  it("keeps row and column spans valid across insertion and deletion", () => {
    const deck = createTableDeck({
      borderColor: "#94A3B8",
      borderWidth: 1,
      columnWidths: [100, 100, 100],
      rowHeights: [100, 100, 100],
      rows: [
        [cell("A1", { colSpan: 2, rowSpan: 2 }), cell("A2"), cell("A3")],
        [cell("B1"), cell("B2"), cell("B3")],
        [cell("C1"), cell("C2"), cell("C3")],
      ],
    });

    const insertedRow = applySuccessfulTablePatch(deck, {
      index: 1,
      type: "insert_row",
    }).props;
    expect(insertedRow.rows[0]![0]).toMatchObject({ rowSpan: 3, colSpan: 2 });

    const rowDeck = structuredClone(deck);
    const rowElement = rowDeck.slides[0]!.elements[0];
    if (!rowElement || rowElement.type !== "table") throw new Error("table");
    rowElement.props = insertedRow;
    const deletedRow = applySuccessfulTablePatch(rowDeck, {
      index: 0,
      type: "delete_row",
    }).props;
    expect(deletedRow.rows[0]![0]).toMatchObject({
      text: "A1",
      rowSpan: 2,
      colSpan: 2,
    });

    const insertedColumn = applySuccessfulTablePatch(deck, {
      index: 1,
      type: "insert_column",
    }).props;
    expect(insertedColumn.rows[0]![0]).toMatchObject({
      rowSpan: 2,
      colSpan: 3,
    });

    const columnDeck = structuredClone(deck);
    const columnElement = columnDeck.slides[0]!.elements[0];
    if (!columnElement || columnElement.type !== "table")
      throw new Error("table");
    columnElement.props = insertedColumn;
    const deletedColumn = applySuccessfulTablePatch(columnDeck, {
      index: 0,
      type: "delete_column",
    }).props;
    expect(deletedColumn.rows[0]![0]).toMatchObject({
      text: "A1",
      rowSpan: 2,
      colSpan: 2,
    });
  });

  it("updates one cell text without changing neighboring cells, styles, or tracks", () => {
    const deck = createTableDeck();
    const before = structuredClone(
      (
        deck.slides[0]!.elements[0] as Extract<
          Deck["slides"][number]["elements"][number],
          { type: "table" }
        >
      ).props,
    );

    const { props: patched } = applySuccessfulTablePatch(deck, {
      columnIndex: 1,
      rowIndex: 0,
      text: "Updated",
      type: "update_cell_text",
    });

    expect(patched.rows[0]![1]).toEqual({
      ...before.rows[0]![1],
      text: "Updated",
    });
    expect(patched.rows[0]![0]).toEqual(before.rows[0]![0]);
    expect(patched.rows[1]).toEqual(before.rows[1]);
    expect(patched.rowHeights).toEqual(before.rowHeights);
    expect(patched.columnWidths).toEqual(before.columnWidths);
    expect(
      (
        deck.slides[0]!.elements[0] as Extract<
          Deck["slides"][number]["elements"][number],
          { type: "table" }
        >
      ).props,
    ).toEqual(before);
  });

  it("inserts a row from the previous adjacent style and resets text and spans", () => {
    const deck = createTableDeck();
    const { created, props: patched } = applySuccessfulTablePatch(deck, {
      index: 1,
      type: "insert_row",
    });

    expect(patched.rows).toHaveLength(3);
    expect(patched.rows[1]).toEqual([
      {
        ...patched.rows[0]![0],
        colSpan: 1,
        rowSpan: 1,
        text: "",
      },
      {
        ...patched.rows[0]![1],
        colSpan: 1,
        rowSpan: 1,
        text: "",
      },
    ]);
    expect(patched.rowHeights).toHaveLength(3);
    expect(
      patched.rowHeights?.reduce((sum, size) => sum + size, 0),
    ).toBeCloseTo(100);
    expect(patched.columnWidths).toEqual([120, 280]);
    expect(
      createTableOperationPatch(deck, "slide_1", "el_table", {
        index: 1,
        type: "insert_row",
      }),
    ).toEqual(created);
  });

  it("deletes a row and redistributes its track without changing total height", () => {
    const deck = createTableDeck({
      borderColor: "#94A3B8",
      borderWidth: 1,
      columnWidths: [120, 280],
      rowHeights: [20, 30, 50],
      rows: [
        [cell("A1"), cell("A2")],
        [cell("B1"), cell("B2")],
        [cell("C1"), cell("C2")],
      ],
    });

    const { props: patched } = applySuccessfulTablePatch(deck, {
      index: 1,
      type: "delete_row",
    });

    expect(patched.rows.map((row) => row.map((item) => item.text))).toEqual([
      ["A1", "A2"],
      ["C1", "C2"],
    ]);
    expect(patched.rowHeights).toHaveLength(2);
    expect(
      patched.rowHeights?.reduce((sum, size) => sum + size, 0),
    ).toBeCloseTo(100);
    expect(patched.rowHeights?.[0]).toBeCloseTo(20 / 0.7);
    expect(patched.rowHeights?.[1]).toBeCloseTo(50 / 0.7);
  });

  it("inserts a column from each previous adjacent cell style and resets content", () => {
    const deck = createTableDeck();
    const { props: patched } = applySuccessfulTablePatch(deck, {
      index: 1,
      type: "insert_column",
    });

    expect(patched.rows.every((row) => row.length === 3)).toBe(true);
    expect(patched.rows[0]![1]).toEqual({
      ...patched.rows[0]![0],
      colSpan: 1,
      rowSpan: 1,
      text: "",
    });
    expect(patched.rows[1]![1]).toEqual({
      ...patched.rows[1]![0],
      colSpan: 1,
      rowSpan: 1,
      text: "",
    });
    expect(patched.columnWidths).toHaveLength(3);
    expect(
      patched.columnWidths?.reduce((sum, size) => sum + size, 0),
    ).toBeCloseTo(400);
    expect(patched.rowHeights).toEqual([40, 60]);
  });

  it("deletes a column and redistributes its track without changing total width", () => {
    const deck = createTableDeck({
      borderColor: "#94A3B8",
      borderWidth: 1,
      columnWidths: [100, 200, 300],
      rowHeights: [200],
      rows: [[cell("A"), cell("B"), cell("C")]],
    });

    const { props: patched } = applySuccessfulTablePatch(deck, {
      index: 1,
      type: "delete_column",
    });

    expect(patched.rows[0]?.map((item) => item.text)).toEqual(["A", "C"]);
    expect(patched.columnWidths?.[0]).toBeCloseTo(150);
    expect(patched.columnWidths?.[1]).toBeCloseTo(450);
    expect(
      patched.columnWidths?.reduce((sum, size) => sum + size, 0),
    ).toBeCloseTo(600);
  });

  it("materializes deterministic tracks from the element frame when tracks are absent", () => {
    const deck = createTableDeck({
      borderColor: "#94A3B8",
      borderWidth: 1,
      rows: [
        [cell("A1"), cell("A2")],
        [cell("B1"), cell("B2")],
      ],
    });

    const { props: patched } = applySuccessfulTablePatch(deck, {
      index: 2,
      type: "insert_row",
    });

    expect(patched.rowHeights).toHaveLength(3);
    expect(
      patched.rowHeights?.reduce((sum, size) => sum + size, 0),
    ).toBeCloseTo(200);
    expect(patched.columnWidths).toEqual([200, 200]);
  });

  it("returns disabled reasons instead of throwing for unsupported and invalid targets", () => {
    const jagged = createTableDeck({
      borderColor: "#94A3B8",
      borderWidth: 1,
      rows: [[cell("A1"), cell("A2")], [cell("B1")]],
    });

    expect(
      createTableOperationPatch(jagged, "slide_1", "el_table", {
        index: 1,
        type: "insert_row",
      }),
    ).toEqual({ ok: false, reason: "jagged-grid" });
    expect(
      createTableOperationPatch(createTableDeck(), "slide_1", "el_table", {
        columnIndex: 99,
        rowIndex: 0,
        text: "missing",
        type: "update_cell_text",
      }),
    ).toEqual({ ok: false, reason: "cell-out-of-bounds" });
    expect(
      createTableOperationPatch(createTableDeck(), "slide_1", "el_missing", {
        columnIndex: 0,
        rowIndex: 0,
        text: "missing",
        type: "update_cell_text",
      }),
    ).toEqual({ ok: false, reason: "table-element-not-found" });
  });
});
