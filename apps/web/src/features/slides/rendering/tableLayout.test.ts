import type { TableElementProps } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import { getTableCellOverlayGeometry, getTableLayout } from "./tableLayout";

const table: TableElementProps = {
  borderColor: "#94A3B8",
  borderWidth: 1,
  columnWidths: [100, 300],
  rowHeights: [40, 60],
  rows: [
    [
      createCell("A1"),
      createCell("A2")
    ],
    [
      createCell("B1", { colSpan: 2 }),
      createCell("B2")
    ]
  ]
};

describe("shared table layout", () => {
  it("distributes tracks and exposes the exact bounds consumed by renderer and hit targets", () => {
    const layout = getTableLayout(table, { height: 200, width: 800 });

    expect(layout.columnWidths).toEqual([200, 600]);
    expect(layout.rowHeights).toEqual([80, 120]);
    expect(layout.cells).toMatchObject([
      { columnIndex: 0, height: 80, rowIndex: 0, width: 200, x: 0, y: 0 },
      { columnIndex: 1, height: 80, rowIndex: 0, width: 600, x: 200, y: 0 },
      { columnIndex: 0, height: 120, rowIndex: 1, width: 800, x: 0, y: 80 },
    ]);
  });

  it("renders only merge anchors for imported row and column spans", () =>
      {
    const layout = getTableLayout(
      {
        ...table,
        rows: [
          [createCell("A1", { colSpan: 2, rowSpan: 2 }), createCell("A2")],
          [createCell("B1"), createCell("B2")],
        ],
      },
      { height: 200, width: 800 },
    );

    expect(layout.cells).toMatchObject([
      { columnIndex: 0, height: 200, rowIndex: 0, width: 800, x: 0, y: 0 }
    ]);
  });

  it("uses deterministic equal tracks when explicit tracks are invalid", () => {
    const layout = getTableLayout(
      { ...table, columnWidths: [0, 0], rowHeights: undefined },
      { height: 120, width: 500 }
    );

    expect(layout.columnWidths).toEqual([250, 250]);
    expect(layout.rowHeights).toEqual([60, 60]);
  });

  it("maps a rotated cell into the zoomed DOM overlay coordinate system", () => {
    const geometry = getTableCellOverlayGeometry({
      cell: { height: 40, width: 120, x: 100, y: 20 },
      element: { rotation: 90, x: 200, y: 100 },
      stageScale: 0.5
    });

    expect(geometry).toEqual({
      height: 20,
      left: 90,
      rotation: 90,
      top: 100,
      width: 60
    });
  });
});

function createCell(
  text: string,
  overrides: Partial<TableElementProps["rows"][number][number]> = {}
) {
  return {
    align: "left" as const,
    borderColor: "#CBD5E1",
    borderWidth: 1,
    colSpan: 1,
    fill: "#FFFFFF",
    fontSize: 18,
    fontWeight: "normal" as const,
    rowSpan: 1,
    text,
    verticalAlign: "middle" as const,
    ...overrides
  };
}
