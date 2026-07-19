import type { TableCellProps, TableElementProps } from "@orbit/shared";

export type TableCellLayout = {
  cell: TableCellProps;
  columnIndex: number;
  height: number;
  rowIndex: number;
  width: number;
  x: number;
  y: number;
};

export type TableLayout = {
  cells: TableCellLayout[];
  columnWidths: number[];
  rowHeights: number[];
};

export function getTableLayout(
  table: TableElementProps,
  frame: { height: number; width: number }
): TableLayout {
  const rows = table.rows ?? [];
  const rowCount = Math.max(1, rows.length);
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const columnWidths = distributeTableTrackSizes(
    table.columnWidths,
    columnCount,
    frame.width
  );
  const rowHeights = distributeTableTrackSizes(
    table.rowHeights,
    rowCount,
    frame.height
  );
  const rowOffsets = cumulativeOffsets(rowHeights);
  const columnOffsets = cumulativeOffsets(columnWidths);

  const occupied = Array.from( { length: rowCount }, () =>
    Array<boolean>(columnCount).fill(false),
  );
  const
    cells: TableCellLayout[] = []; rows.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
      if (occupied[rowIndex]?.[
        columnIndex]) return;
      const rowSpan = Math.min(
        rowCount - rowIndex, Math.max(1, cell.rowSpan ?? 1),);
      const colSpan = Math.min(
        columnCount -
          columnIndex,
          Math.max(1, cell.colSpan ?? 1)
        );
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
          occupied[rowIndex + rowOffset]![columnIndex + columnOffset] = true;
        }
      }
      cells.push({
        cell,
        columnIndex,
        height: sumRange(rowHeights, rowIndex, rowSpan),
        rowIndex,
        width: sumRange(columnWidths, columnIndex, colSpan),
        x: columnOffsets[columnIndex] ?? 0,
        y: rowOffsets[rowIndex] ?? 0
      });
    });
  }
    );

  return {
    cells,
    columnWidths,
    rowHeights
  };
}

export function distributeTableTrackSizes(
  explicitSizes: number[] | undefined,
  count: number,
  total: number
) {
  if (
    explicitSizes?.length === count &&
    explicitSizes.every((size) => Number.isFinite(size) && size > 0)
  ) {
    const explicitTotal = explicitSizes.reduce((sum, size) => sum + size, 0);
    return explicitSizes.map((size) => (size / explicitTotal) * total);
  }

  return Array.from({ length: count }, () => total / count);
}

export function getTableCellOverlayGeometry(args: {
  cell: Pick<TableCellLayout, "height" | "width" | "x" | "y">;
  element: { rotation: number; x: number; y: number };
  stageScale: number;
}) {
  const radians = (args.element.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const canvasLeft = args.element.x + args.cell.x * cosine - args.cell.y * sine;
  const canvasTop = args.element.y + args.cell.x * sine + args.cell.y * cosine;

  return {
    height: cleanGeometryNumber(args.cell.height * args.stageScale),
    left: cleanGeometryNumber(canvasLeft * args.stageScale),
    rotation: args.element.rotation,
    top: cleanGeometryNumber(canvasTop * args.stageScale),
    width: cleanGeometryNumber(args.cell.width * args.stageScale)
  };
}

function cumulativeOffsets(sizes: number[]) {
  let offset = 0;
  return sizes.map((size) => {
    const current = offset;
    offset += size;
    return current;
  });
}

function sumRange(values: number[], start: number, count: number) {
  return values
    .slice(start, Math.min(values.length, start + count))
    .reduce((sum, value) => sum + value, 0);
}

function cleanGeometryNumber(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
