import type {
  Deck,
  DeckPatch,
  TableCellProps,
  TableElementProps,
} from "@orbit/shared";

export type TableStructureDisabledReason =
  | "empty-grid"
  | "jagged-grid"
  | "invalid-cell-span"
  | "overlapping-cell-span"
  | "row-track-mismatch"
  | "column-track-mismatch";

export type TableOperationDisabledReason =
  | TableStructureDisabledReason
  | "last-row"
  | "last-column"
  | "row-index-out-of-bounds"
  | "column-index-out-of-bounds"
  | "cell-out-of-bounds"
  | "cell-covered-by-merge"
  | "cell-not-merged"
  | "merge-selection-too-small"
  | "selection-partially-overlaps-merged-cell"
  | "table-element-not-found"
  | "table-element-type-mismatch";

export type TableCellRange = {
  endColumnIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  startRowIndex: number;
};

export type TableOperation =
  | {
      columnIndex: number;
      rowIndex: number;
      text: string;
      type: "update_cell_text";
    }
  | { index: number; type: "insert_row" }
  | { index: number; type: "delete_row" }
  | { index: number; type: "insert_column" }
  | { index: number; type: "delete_column" }
  | (TableCellRange & { type: "merge_cells" })
  | { rowIndex: number; columnIndex: number; type: "unmerge_cell" };

export type TableOperationCapability =
  | { enabled: true }
  | { enabled: false; reason: TableOperationDisabledReason };

export type TableStructureCapability =
  | { enabled: true }
  | { enabled: false; reason: TableStructureDisabledReason };

export type TableOperationPatchResult =
  | {
      nextProps: TableElementProps;
      ok: true;
      patch: DeckPatch;
    }
  | { ok: false; reason: TableOperationDisabledReason };

export function getTableStructureCapability(
  table: TableElementProps,
): TableStructureCapability {
  const analysis = analyzeTableGrid(table);
  if (!analysis.ok) return structureDisabled(analysis.reason);
  const rowCount = table.rows.length;
  const columnCount = table.rows[0]?.length ?? 0;
  if (table.rowHeights && table.rowHeights.length !== rowCount) {
    return structureDisabled("row-track-mismatch");
  }
  if (table.columnWidths && table.columnWidths.length !== columnCount) {
    return structureDisabled("column-track-mismatch");
  }
  return { enabled: true };
}

export function getTableOperationCapability(
  table: TableElementProps,
  operation: TableOperation,
): TableOperationCapability {
  const analysis = analyzeTableGrid(table);
  if (!analysis.ok) return disabled(analysis.reason);

  if (operation.type === "update_cell_text") {
    const row = table.rows[operation.rowIndex];
    if (
      !Number.isInteger(operation.rowIndex) ||
      !Number.isInteger(operation.columnIndex) ||
      operation.rowIndex < 0 ||
      operation.columnIndex < 0 ||
      !row?.[operation.columnIndex]
    ) {
      return disabled("cell-out-of-bounds");
    }
    const owner = analysis.owners[operation.rowIndex]?.[operation.columnIndex];
    if (
      !owner ||
      owner.rowIndex !== operation.rowIndex ||
      owner.columnIndex !== operation.columnIndex
    ) {
      return disabled("cell-covered-by-merge");
    }
    return { enabled: true };
  }

  if (operation.type === "merge_cells") {
    return getMergeCapability(table, analysis, operation);
  }
  if (operation.type === "unmerge_cell") {
    const owner = analysis.owners[operation.rowIndex]?.[operation.columnIndex];
    if (!owner) return disabled("cell-out-of-bounds");
    return owner.rowSpan > 1 || owner.colSpan > 1
      ? { enabled: true }
      : disabled("cell-not-merged");
  }

  const rowCount = table.rows.length;
  const columnCount = table.rows[0]!.length;
  if (operation.type === "insert_row") {
    return isInsertionIndex(operation.index, rowCount)
      ? { enabled: true }
      : disabled("row-index-out-of-bounds");
  }
  if (operation.type === "delete_row") {
    if (!isExistingIndex(operation.index, rowCount)) {
      return disabled("row-index-out-of-bounds");
    }
    if (rowCount === 1) {
      return disabled("last-row");
    }
    return { enabled: true };
  }
  if (operation.type === "insert_column") {
    return isInsertionIndex(operation.index, columnCount)
      ? { enabled: true }
      : disabled("column-index-out-of-bounds");
  }
  if (!isExistingIndex(operation.index, columnCount)) {
    return disabled("column-index-out-of-bounds");
  }
  if (columnCount === 1) {
    return disabled("last-column");
  }
  return { enabled: true };
}

export function createTableOperationPatch(
  deck: Deck,
  slideId: string,
  elementId: string,
  operation: TableOperation,
): TableOperationPatchResult {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  const element = slide?.elements.find(
    (candidate) => candidate.elementId === elementId,
  );
  if (!element) {
    return failure("table-element-not-found");
  }
  if (element.type !== "table") {
    return failure("table-element-type-mismatch");
  }

  const capability = getTableOperationCapability(element.props, operation);
  if (!capability.enabled) {
    return failure(capability.reason);
  }

  const nextProps = applyTableOperation(
    element.props,
    { height: element.height, width: element.width },
    operation,
  );
  const propsPatch: Record<string, unknown> =
    operation.type === "update_cell_text"
      ? { rows: nextProps.rows }
      : {
          columnWidths: nextProps.columnWidths,
          rowHeights: nextProps.rowHeights,
          rows: nextProps.rows,
        };
  const patch: DeckPatch = {
    baseVersion: deck.version,
    deckId: deck.deckId,
    operations: [
      {
        elementId,
        props: propsPatch,
        slideId,
        type: "update_element_props",
      },
    ],
    source: "user",
  };

  return { nextProps, ok: true, patch };
}

function applyTableOperation(
  table: TableElementProps,
  frame: { height: number; width: number },
  operation: TableOperation,
): TableElementProps {
  const rows = structuredClone(table.rows);
  const analysis = analyzeTableGrid(table);
  if (!analysis.ok) return structuredClone(table);
  if (operation.type === "update_cell_text") {
    rows[operation.rowIndex]![operation.columnIndex] = {
      ...rows[operation.rowIndex]![operation.columnIndex]!,
      text: operation.text,
    };
    return { ...structuredClone(table), rows };
  }

  if (operation.type === "merge_cells") {
    const range = normalizeTableCellRange(operation);
    for (const owner of uniqueRangeOwners(analysis, range)) {
      rows[owner.rowIndex]![owner.columnIndex] = {
        ...rows[owner.rowIndex]![owner.columnIndex]!,
        colSpan: 1,
        rowSpan: 1,
      };
    }
    rows[range.startRowIndex]![range.startColumnIndex] = {
      ...rows[range.startRowIndex]![range.startColumnIndex]!,
      colSpan: range.endColumnIndex - range.startColumnIndex + 1,
      rowSpan: range.endRowIndex - range.startRowIndex + 1,
    };
    return { ...structuredClone(table), rows };
  }
  if (operation.type === "unmerge_cell") {
    const owner = analysis.owners[operation.rowIndex]![operation.columnIndex]!;
    rows[owner.rowIndex]![owner.columnIndex] = {
      ...rows[owner.rowIndex]![owner.columnIndex]!,
      colSpan: 1,
      rowSpan: 1,
    };
    return { ...structuredClone(table), rows };
  }

  const rowCount = rows.length;
  const columnCount = rows[0]!.length;
  let rowHeights = materializeTracks(table.rowHeights, rowCount, frame.height);
  let columnWidths = materializeTracks(
    table.columnWidths,
    columnCount,
    frame.width,
  );

  if (operation.type === "insert_row") {
    for (const owner of analysis.anchors) {
      if (
        owner.rowIndex < operation.index &&
        owner.rowIndex + owner.rowSpan > operation.index
      ) {
        rows[owner.rowIndex]![owner.columnIndex] = {
          ...rows[owner.rowIndex]![owner.columnIndex]!,
          rowSpan: owner.rowSpan + 1,
        };
      }
    }
    const templateIndex = insertionTemplateIndex(operation.index, rowCount);
    const inserted = rows[templateIndex]!.map(resetCellContent);
    rows.splice(operation.index, 0, inserted);
    rowHeights = insertAndRedistributeTrack(rowHeights, operation.index);
  } else if (operation.type === "delete_row") {
    for (const owner of analysis.anchors) {
      if (
        owner.rowIndex < operation.index &&
        owner.rowIndex + owner.rowSpan > operation.index
      ) {
        rows[owner.rowIndex]![owner.columnIndex] = {
          ...rows[owner.rowIndex]![owner.columnIndex]!,
          rowSpan: owner.rowSpan - 1,
        };
      } else if (owner.rowIndex === operation.index && owner.rowSpan > 1) {
        rows[operation.index + 1]![owner.columnIndex] = {
          ...structuredClone(rows[owner.rowIndex]![owner.columnIndex]!),
          rowSpan: owner.rowSpan - 1,
        };
      }
    }
    rows.splice(operation.index, 1);
    rowHeights = deleteAndRedistributeTrack(rowHeights, operation.index);
  } else if (operation.type === "insert_column") {
    for (const owner of analysis.anchors) {
      if (
        owner.columnIndex < operation.index &&
        owner.columnIndex + owner.colSpan > operation.index
      ) {
        rows[owner.rowIndex]![owner.columnIndex] = {
          ...rows[owner.rowIndex]![owner.columnIndex]!,
          colSpan: owner.colSpan + 1,
        };
      }
    }
    const templateIndex = insertionTemplateIndex(operation.index, columnCount);
    for (const row of rows) {
      row.splice(operation.index, 0, resetCellContent(row[templateIndex]!));
    }
    columnWidths = insertAndRedistributeTrack(columnWidths, operation.index);
  } else {
    for (const owner of analysis.anchors) {
      if (
        owner.columnIndex < operation.index &&
        owner.columnIndex + owner.colSpan > operation.index
      ) {
        rows[owner.rowIndex]![owner.columnIndex] = {
          ...rows[owner.rowIndex]![owner.columnIndex]!,
          colSpan: owner.colSpan - 1,
        };
      } else if (owner.columnIndex === operation.index && owner.colSpan > 1) {
        rows[owner.rowIndex]![operation.index + 1] = {
          ...structuredClone(rows[owner.rowIndex]![owner.columnIndex]!),
          colSpan: owner.colSpan - 1,
        };
      }
    }
    for (const row of rows) {
      row.splice(operation.index, 1);
    }
    columnWidths = deleteAndRedistributeTrack(columnWidths, operation.index);
  }

  return {
    ...structuredClone(table),
    columnWidths,
    rowHeights,
    rows,
  };
}

type TableCellAnchor = {
  columnIndex: number;
  colSpan: number;
  rowIndex: number;
  rowSpan: number;
};

type TableGridAnalysis =
  | {
      anchors: TableCellAnchor[];
      ok: true;
      owners: Array<Array<TableCellAnchor | null>>;
    }
  | { ok: false; reason: TableStructureDisabledReason };

function analyzeTableGrid(table: TableElementProps): TableGridAnalysis {
  const rowCount = table.rows.length;
  const columnCount = table.rows[0]?.length ?? 0;
  if (rowCount === 0 || columnCount === 0) {
    return { ok: false, reason: "empty-grid" };
  }
  if (table.rows.some((row) => row.length !== columnCount)) {
    return { ok: false, reason: "jagged-grid" };
  }

  const owners = Array.from({ length: rowCount }, () =>
    Array<TableCellAnchor | null>(columnCount).fill(null),
  );
  const anchors: TableCellAnchor[] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const cell = table.rows[rowIndex]![columnIndex]!;
      const rowSpan = cell.rowSpan ?? 1;
      const colSpan = cell.colSpan ?? 1;
      if (
        !Number.isInteger(rowSpan) ||
        !Number.isInteger(colSpan) ||
        rowSpan < 1 ||
        colSpan < 1 ||
        rowIndex + rowSpan > rowCount ||
        columnIndex + colSpan > columnCount
      ) {
        return { ok: false, reason: "invalid-cell-span" };
      }
      if (owners[rowIndex]![columnIndex]) {
        if (rowSpan > 1 || colSpan > 1) {
          return { ok: false, reason: "overlapping-cell-span" };
        }
        continue;
      }
      const anchor = { columnIndex, colSpan, rowIndex, rowSpan };
      for (let row = rowIndex; row < rowIndex + rowSpan; row += 1) {
        for (
          let column = columnIndex;
          column < columnIndex + colSpan;
          column += 1
        ) {
          if (owners[row]![column]) {
            return { ok: false, reason: "overlapping-cell-span" };
          }
          owners[row]![column] = anchor;
        }
      }
      anchors.push(anchor);
    }
  }
  return { anchors, ok: true, owners };
}

export function normalizeTableCellRange(range: TableCellRange): TableCellRange {
  return {
    startRowIndex: Math.min(range.startRowIndex, range.endRowIndex),
    endRowIndex: Math.max(range.startRowIndex, range.endRowIndex),
    startColumnIndex: Math.min(range.startColumnIndex, range.endColumnIndex),
    endColumnIndex: Math.max(range.startColumnIndex, range.endColumnIndex),
  };
}

function uniqueRangeOwners(
  analysis: Extract<TableGridAnalysis, { ok: true }>,
  range: TableCellRange,
) {
  const owners = new Map<string, TableCellAnchor>();
  for (let row = range.startRowIndex; row <= range.endRowIndex; row += 1) {
    for (
      let column = range.startColumnIndex;
      column <= range.endColumnIndex;
      column += 1
    ) {
      const owner = analysis.owners[row]?.[column];
      if (owner) owners.set(`${owner.rowIndex}:${owner.columnIndex}`, owner);
    }
  }
  return [...owners.values()];
}

function getMergeCapability(
  table: TableElementProps,
  analysis: Extract<TableGridAnalysis, { ok: true }>,
  operation: Extract<TableOperation, { type: "merge_cells" }>,
): TableOperationCapability {
  const range = normalizeTableCellRange(operation);
  if (
    ![
      range.startRowIndex,
      range.endRowIndex,
      range.startColumnIndex,
      range.endColumnIndex,
    ].every(Number.isInteger) ||
    range.startRowIndex < 0 ||
    range.startColumnIndex < 0 ||
    range.endRowIndex >= table.rows.length ||
    range.endColumnIndex >= table.rows[0]!.length
  ) {
    return disabled("cell-out-of-bounds");
  }
  if (
    range.startRowIndex === range.endRowIndex &&
    range.startColumnIndex === range.endColumnIndex
  ) {
    return disabled("merge-selection-too-small");
  }
  for (const owner of uniqueRangeOwners(analysis, range)) {
    if (
      owner.rowIndex < range.startRowIndex ||
      owner.columnIndex < range.startColumnIndex ||
      owner.rowIndex + owner.rowSpan - 1 > range.endRowIndex ||
      owner.columnIndex + owner.colSpan - 1 > range.endColumnIndex
    ) {
      return disabled("selection-partially-overlaps-merged-cell");
    }
  }
  return { enabled: true };
}

function resetCellContent(template: TableCellProps): TableCellProps {
  return {
    ...structuredClone(template),
    colSpan: 1,
    rowSpan: 1,
    text: "",
  };
}

function materializeTracks(
  tracks: number[] | undefined,
  count: number,
  frameSize: number,
) {
  if (tracks) {
    return [...tracks];
  }
  const size = frameSize / count;
  return Array.from({ length: count }, () => size);
}

function insertAndRedistributeTrack(tracks: number[], index: number) {
  const total = sumTracks(tracks);
  const templateIndex = insertionTemplateIndex(index, tracks.length);
  const next = [...tracks];
  next.splice(index, 0, tracks[templateIndex]!);
  return redistributeTracks(next, total);
}

function deleteAndRedistributeTrack(tracks: number[], index: number) {
  const total = sumTracks(tracks);
  const next = [...tracks];
  next.splice(index, 1);
  return redistributeTracks(next, total);
}

function redistributeTracks(tracks: number[], total: number) {
  const currentTotal = sumTracks(tracks);
  const scale = total / currentTotal;
  const redistributed = tracks.map((track) => track * scale);
  const redistributedTotal = sumTracks(redistributed);
  redistributed[redistributed.length - 1] =
    redistributed[redistributed.length - 1]! + (total - redistributedTotal);
  return redistributed;
}

function insertionTemplateIndex(index: number, count: number) {
  return index === 0 ? 0 : Math.min(index - 1, count - 1);
}

function isInsertionIndex(index: number, count: number) {
  return Number.isInteger(index) && index >= 0 && index <= count;
}

function isExistingIndex(index: number, count: number) {
  return Number.isInteger(index) && index >= 0 && index < count;
}

function sumTracks(tracks: number[]) {
  return tracks.reduce((sum, track) => sum + track, 0);
}

function disabled(
  reason: TableOperationDisabledReason,
): TableOperationCapability {
  return { enabled: false, reason };
}

function structureDisabled(
  reason: TableStructureDisabledReason,
): TableStructureCapability {
  return { enabled: false, reason };
}

function failure(
  reason: TableOperationDisabledReason,
): TableOperationPatchResult {
  return { ok: false, reason };
}
