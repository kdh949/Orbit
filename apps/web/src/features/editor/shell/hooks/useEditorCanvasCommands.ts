import {
  createAddElementPatch,
  createAddSlidePatch,
  createActivityResultsSlide,
  createActivitySlide,
  createElementId,
  createGroupedElementFramePatch,
  createSlideId,
  createTableOperationPatch,
  getGroupChildElements,
  getGroupedSelectionBounds,
  getTableOperationCapability,
  getTableStructureCapability,
  type TableOperation,
  type TableCellRange,
} from "../../../../../../../packages/editor-core/src/index";
import {
  createElementFramePatch,
  normalizeElementFrameDraft,
} from "../../../../../../../packages/editor-core/src/patches/elementFrame";
import type {
  Chart,
  CustomShapeNode,
  ActivityTemplate,
  Deck,
  DeckElement,
  DeckElementRole,
  DeckPatch,
  GroupElementProps,
  ShapeElementProps,
  Slide,
  TableCellProps,
  TableElementProps,
} from "@orbit/shared";
import { useEffect, useRef, type MutableRefObject } from "react";

import { resolveRedesignPalette } from "../../../../styles/redesignPalette";
import { normalizeCustomShapeAbsoluteGeometry } from "../../canvas/custom-shape/geometry";
import {
  createSlideIconDataUrl,
  type SlideIconDefinition
} from "../../icons/slideIconRegistry";
import type { ShapeInsertType } from "../components/EditorContextMenus";
import type { ChartInsertType } from "../components/EditorToolbar";
import type {
  EditorShellUiUpdater,
  ElementContextMenuState,
  InsertTool,
  TableCellTarget,
  TableContextAction,
} from "../editorShellUiStore";
import {
  getTableCellTargetRange, useEditorShellUiStore, } from "../editorShellUiStore";
import {
  getContextMenuPosition,
  getNextElementZIndex,
} from "../utils/editorLayout";
import {
  getElementLayerOrderUpdates,
  type ElementLayerOrderAction,
} from "../utils/elementLayerOrder";
import { canEditSlideCanvas } from "../utils/slideEditingPolicy";
import type { PatchProducer } from "./useEditorPersistenceState";

export type ElementFrameChange = {
  role?: DeckElementRole | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  visible?: boolean;
};

type ClipboardState = {
  elements: DeckElement[];
  pasteCount: number;
  rootElementId: string;
};
type CommitPatch = (
  patch: DeckPatch | PatchProducer,
  baseDeck?: Deck,
) => boolean;

type TableElement = Extract<DeckElement, { type: "table" }>;
type TableActionState =
  | { enabled: true; reason: null }
  | { enabled: false; reason: string };

export type TableContextActionStates = Record<
  TableContextAction | "cellText",
  TableActionState
>;

const tableDisabledReasonLabels = {
  "cell-out-of-bounds": "선택한 셀을 찾을 수 없습니다.",
  "cell-covered-by-merge": "병합된 셀의 대표 셀을 선택해 주세요.",
  "cell-not-merged": "선택한 셀은 병합되어 있지 않습니다.",
  "column-index-out-of-bounds": "선택한 열을 찾을 수 없습니다.",
  "column-track-mismatch": "열 너비 정보가 표 구조와 일치하지 않습니다.",
  "empty-grid": "비어 있는 표는 셀을 편집할 수 없습니다.",
  "jagged-grid": "행마다 셀 수가 다른 표는 안전하게 편집할 수 없습니다.",
  "last-column": "마지막 열은 삭제할 수 없습니다.",
  "last-row": "마지막 행은 삭제할 수 없습니다.",
  "invalid-cell-span": "셀 병합 범위가 표 경계를 벗어났습니다.",
  "merge-selection-too-small": "두 개 이상의 인접 셀을 선택해 주세요.",
  "overlapping-cell-span":
    "서로 겹치는 병합 범위가 있어 표를 편집할 수 없습니다.",
  "row-index-out-of-bounds": "선택한 행을 찾을 수 없습니다.",
  "row-track-mismatch": "행 높이 정보가 표 구조와 일치하지 않습니다.",
  "selection-partially-overlaps-merged-cell":
    "기존 병합 셀 전체를 포함하도록 선택해 주세요.",
  "table-element-not-found": "편집할 표를 찾지 못했습니다.",
  "table-element-type-mismatch": "선택한 요소가 표가 아닙니다."
} as const;

export function getTableContextActionStates(args: {
  deck: Deck;
  element: TableElement;
  selection?: TableCellRange;
}): TableContextActionStates {
  const structure = getTableStructureCapability(args.element.props);
  const structureReason = structure.enabled
    ? null
    : tableDisabledReasonLabels[structure.reason];
  const importedDeck = args.deck.metadata.sourceType === "import";
  const importedElement = args.element.ooxmlOrigin === "imported";
  const missingImportedProvenance =
    importedDeck && args.element.ooxmlOrigin === undefined;

  let cellText: TableActionState;
  if (structureReason) {
    cellText = { enabled: false, reason: structureReason };
  } else if (
    importedDeck &&
    importedElement &&
    args.element.ooxmlEditCapabilities?.tableCellText !== true
  ) {
    cellText = {
      enabled: false,
      reason: "이 표의 셀 위치를 OOXML에 안전하게 연결할 수 없습니다."
    };
  } else if (missingImportedProvenance) {
    cellText = {
      enabled: false,
      reason: "가져온 표의 원본 정보가 없어 셀을 안전하게 편집할 수 없습니다."
    };
  } else {
    cellText = { enabled: true, reason: null };
  }

  let structuralState: TableActionState;
  if (structureReason) {
    structuralState = { enabled: false, reason: structureReason };
  } else if (importedDeck && importedElement) {
    structuralState = {
      enabled: false,
      reason: "가져온 표의 행과 열 구조는 원본 OOXML 보존을 위해 편집할 수 없습니다."
    };
  } else if (missingImportedProvenance) {
    structuralState = {
      enabled: false,
      reason: "가져온 표의 원본 정보가 없어 행과 열을 안전하게 편집할 수 없습니다."
    };
  } else {
    structuralState = { enabled: true, reason: null };
  }

  const deleteRow = structuralState.enabled
    ? tableOperationState(
        getTableOperationCapability(args.element.props, {
          index: 0,
          type: "delete_row"
        })
      )
    : structuralState;
  const deleteColumn = structuralState.enabled
    ? tableOperationState(
        getTableOperationCapability(args.element.props, {
          index: 0,
          type: "delete_column"
        })
      )
    : structuralState;
  const selection = args.selection ?? {
    startRowIndex: 0,
    endRowIndex: 0,
    startColumnIndex: 0,
    endColumnIndex: 0,
  };
  const mergeStructuralState = importedDeck
    ? {
        enabled: false as const,
        reason:
          "가져온 Deck에서는 병합된 authored 표를 원본 OOXML에 안전하게 저장할 수 없습니다.",
      }
    : structuralState;
  const mergeCells = mergeStructuralState.enabled
    ? tableOperationState(
        getTableOperationCapability(args.element.props, {
          ...selection,
          type: "merge_cells",
        }),
      )
    : mergeStructuralState;
  const unmergeCell = mergeStructuralState.enabled
    ? tableOperationState(
        getTableOperationCapability(args.element.props, {
          rowIndex: selection.startRowIndex,
          columnIndex: selection.startColumnIndex,
          type: "unmerge_cell",
        }),
      )
    : mergeStructuralState;

  return {
    cellText,
    deleteColumn,
    deleteRow,
    insertColumnLeft: structuralState,
    insertColumnRight: structuralState,
    insertRowAbove: structuralState,
    insertRowBelow: structuralState,
    mergeCells,
    unmergeCell,
  };
}

export function createTableUiOperationPatch(args: {
  deck: Deck;
  elementId: string;
  operation: TableOperation;
  slideId: string;
}) {
  return createTableOperationPatch(
    args.deck,
    args.slideId,
    args.elementId,
    args.operation
  );
}

function tableOperationState(
  capability: ReturnType<typeof getTableOperationCapability>
): TableActionState {
  return capability.enabled
    ? { enabled: true, reason: null }
    : {
        enabled: false,
        reason:
          tableDisabledReasonLabels[capability.reason] ??
          "이 표 작업을 안전하게 실행할 수 없습니다."
      };
}

function tableOperationForContextAction(
  action: TableContextAction,
  rowIndex: number,
  columnIndex: number,
  selection?: TableCellRange,
): TableOperation {
  switch (action) {
    case "insertRowAbove":
      return { index: rowIndex, type: "insert_row" };
    case "insertRowBelow":
      return { index: rowIndex + 1, type: "insert_row" };
    case "insertColumnLeft":
      return { index: columnIndex, type: "insert_column" };
    case "insertColumnRight":
      return { index: columnIndex + 1, type: "insert_column" };
    case "deleteRow":
      return { index: rowIndex, type: "delete_row" };
    case "deleteColumn":
      return { index: columnIndex, type: "delete_column" };
    case "mergeCells":
      return {
        ...(selection ?? {
          startRowIndex: rowIndex,
          endRowIndex: rowIndex,
          startColumnIndex: columnIndex,
          endColumnIndex: columnIndex,
  }),
        type: "merge_cells",
};
    case "unmergeCell":
      return { rowIndex, columnIndex, type: "unmerge_cell" };
  }
}

function nextTableCellTarget(
  target: TableCellTarget,
  action: TableContextAction,
  selection?: TableCellRange,
): TableCellTarget {
  if (action === "mergeCells" && selection) {
    return {
      ...target,
      anchorColumnIndex: selection.startColumnIndex,
      anchorRowIndex: selection.startRowIndex,
      columnIndex: selection.startColumnIndex,
      rowIndex: selection.startRowIndex,
    };
  }
  if (action === "insertRowAbove") {
    return { ...target,
      anchorRowIndex: target. rowIndex + 1,
      rowIndex: target.rowIndex + 1, };
  }
  if (action === "insertColumnLeft") {
    return { ...target,
      anchorColumnIndex: target. columnIndex + 1,
      columnIndex: target.columnIndex + 1, };
  }
  if (action === "deleteRow") {
    const rowIndex = Math.max(0, target.rowIndex - 1);
    return { ...target, anchorRowIndex: rowIndex, rowIndex };
  }
  if (action === "deleteColumn") {
    const columnIndex = Math.max(0, target.columnIndex - 1);
    return { ...target, anchorColumnIndex: columnIndex, columnIndex };
  }
  return target;
}

export function useEditorCanvasCommands(args: {
  commitPatch: CommitPatch;
  confirmDiscardSpeakerNotesDraft: () => boolean;
  currentSlide: Slide | null;
  deck: Deck;
  resetSpeakerNotesEditState: (notes: string) => void;
  selectedElement: DeckElement | null;
  selectedElementIds: string[];
  selectedElements: DeckElement[];
  setCurrentSlideIndex: (index: number) => void;
  setCustomShapeEditElementId: (
    updater: EditorShellUiUpdater<string | null>,
  ) => void;
  setEditingElementId: (updater: EditorShellUiUpdater<string | null>) => void;
  setElementContextMenu: (
    updater: EditorShellUiUpdater<ElementContextMenuState | null>,
  ) => void;
  setInsertTool: (updater: EditorShellUiUpdater<InsertTool>) => void;
  setIsShapeMenuOpen: (updater: EditorShellUiUpdater<boolean>) => void;
  setLastPatchLabel: (label: string) => void;
  setSelectedElementIds: (updater: EditorShellUiUpdater<string[]>) => void;
  workingDeckRef: MutableRefObject<Deck>;
}) {
  const copiedElementRef = useRef<ClipboardState | null>(null);
  const tableOperationRequest = useEditorShellUiStore(
    (state) => state.tableOperationRequest
  );

  useEffect(() => {
    if (!tableOperationRequest) return;
    useEditorShellUiStore.getState().setTableOperationRequest(null);

    const activeDeck = args.workingDeckRef.current;
    const slide = activeDeck.slides.find(
      (candidate) => candidate.slideId === tableOperationRequest.slideId
    );
    const element = slide?.elements.find(
      (candidate) => candidate.elementId === tableOperationRequest.elementId
    );
    if (!slide || !element || element.type !== "table") {
      args.setLastPatchLabel("편집할 표를 찾지 못했습니다.");
      return;
    }

    const actionStates = getTableContextActionStates({
      deck: activeDeck,
      element,
      selection: tableOperationRequest.selection,
    });
    const actionState =
      tableOperationRequest.action === "updateCellText"
        ? actionStates.cellText
        : actionStates[tableOperationRequest.action];
    if (!actionState.enabled) {
      args.setLastPatchLabel(actionState.reason);
      return;
    }

    const operation: TableOperation =
      tableOperationRequest.action === "updateCellText"
        ? {
            columnIndex: tableOperationRequest.columnIndex,
            rowIndex: tableOperationRequest.rowIndex,
            text: tableOperationRequest.text,
            type: "update_cell_text"
          }
        : tableOperationForContextAction(
            tableOperationRequest.action,
            tableOperationRequest.rowIndex,
            tableOperationRequest.columnIndex,
            tableOperationRequest.selection,
          );
    const result = createTableUiOperationPatch({
      deck: activeDeck,
      elementId: element.elementId,
      operation,
      slideId: slide.slideId
    });
    if (!result.ok) {
      args.setLastPatchLabel(
        tableDisabledReasonLabels[result.reason] ??
          "표 편집 작업을 적용하지 못했습니다."
      );
      return;
    }
    if (!args.commitPatch(result.patch)) return;

    const currentTarget = useEditorShellUiStore.getState().activeTableCell;
    if (
      tableOperationRequest.action !== "updateCellText" &&
      currentTarget?.slideId === slide.slideId &&
      currentTarget.elementId === element.elementId
    ) {
      useEditorShellUiStore
        .getState()
        .setActiveTableCell(
          nextTableCellTarget(currentTarget, tableOperationRequest.action,
            tableOperationRequest.selection,)
        );
    }
    args.setElementContextMenu(null);
  }, [tableOperationRequest]);

  function addTextElement() {
    if (!canEditSlideCanvas(args.currentSlide)) return;
    const elementId = createElementId(args.deck);
    args.commitPatch((currentDeck) =>
      createAddElementPatch(currentDeck, args.currentSlide!.slideId, {
        elementId,
        type: "text",
        role: "body",
        x: 180,
        y: 180,
        width: 360,
        height: 96,
        rotation: 0,
        opacity: 1,
        zIndex: getNextElementZIndex(args.currentSlide!.elements),
        locked: false,
        visible: true,
        props: {
          text: "새 텍스트",
          fontFamily:
            args.currentSlide!.style.fontFamily ??
            args.deck.theme.typography.bodyFontFamily,
          fontSize: args.deck.theme.typography.bodySize,
          fontWeight: "normal",
          color:
            args.currentSlide!.style.textColor ?? args.deck.theme.textColor,
          align: "left",
          verticalAlign: "top",
          lineHeight: 1.2,
        },
      }),
    );
    args.setSelectedElementIds([elementId]);
    args.setEditingElementId(elementId);
    args.setInsertTool("select");
  }

  function addChartElement(type: ChartInsertType = "bar") {
    if (!canEditSlideCanvas(args.currentSlide)) return;
    const elementId = createElementId(args.deck);
    const redesignPalette = resolveRedesignPalette();
    const primaryColor =
      redesignPalette?.primary ?? args.deck.theme.palette.primary;
    const primaryFixedDimColor =
      redesignPalette?.primaryFixedDim ?? primaryColor;
    const primaryContainerColor =
      redesignPalette?.primaryContainer ?? primaryColor;
    args.commitPatch((currentDeck) => {
      const nextElement: DeckElement = type === "table" ? {
        elementId,
        type: "table",
        role: "table",
        x: 240,
        y: 180,
        width: 520,
        height: 280,
        rotation: 0,
        opacity: 1,
        zIndex: getNextElementZIndex(args.currentSlide!.elements),
        locked: false,
        visible: true,
        props: createDefaultTableProps({
          width: 520,
          height: 280,
          headerFill: primaryContainerColor,
          textColor: args.deck.theme.textColor,
          fontFamily: args.deck.theme.typography.bodyFontFamily,
        }),
      } : {
        elementId,
        type: "chart",
        role: "chart",
        x: 240,
        y: 180,
        width: 520,
        height: 280,
        rotation: 0,
        opacity: 1,
        zIndex: getNextElementZIndex(args.currentSlide!.elements),
        locked: false,
        visible: true,
        props: {
          type,
          title: "새 차트",
          data: [
            { label: "A", value: 48 },
            { label: "B", value: 72 },
            { label: "C", value: 56 },
          ],
          style: {
            colors: [primaryColor, primaryFixedDimColor, primaryContainerColor],
            backgroundColor: "#ffffff",
            textColor: "#111827",
            fontFamily: args.deck.theme.typography.bodyFontFamily,
            titleFontSize: 20,
            axisLabelFontSize: 12,
            legendFontSize: 12,
            dataLabelFontSize: 12,
            showLegend: true,
            legendPosition: "bottom",
            showDataLabels: true,
            showGrid: true,
            xAxisTitle: "",
            yAxisTitle: "",
            unit: "",
          },
        },
      };
      return createAddElementPatch(currentDeck, args.currentSlide!.slideId, nextElement);
    });
    args.setSelectedElementIds([elementId]);
  }

  function convertChartToTable(slideId: string, elementId: string) {
    const sourceElement = args.deck.slides
      .find((candidate) => candidate.slideId === slideId)
      ?.elements.find((candidate) => candidate.elementId === elementId);
    if (!sourceElement || sourceElement.type !== "chart") return;

    args.commitPatch((currentDeck) => {
      const slide = currentDeck.slides.find((candidate) => candidate.slideId === slideId);
      const element = slide?.elements.find((candidate) => candidate.elementId === elementId);
      if (!slide || !element || element.type !== "chart") throw new Error("Chart element not found");
      const chart = element.props as Chart;
      const nextElement: DeckElement = {
        ...element,
        type: "table",
        role: "table",
        props: createTablePropsFromChart(
          chart,
          element.width,
          element.height,
          args.deck.theme.textColor,
          args.deck.theme.typography.bodyFontFamily,
        ),
      };
      return {
        deckId: currentDeck.deckId,
        baseVersion: currentDeck.version,
        source: "user",
        operations: [
          { type: "delete_element", slideId, elementId },
          { type: "add_element", slideId, element: nextElement },
        ],
      };
    });
    args.setEditingElementId(null);
    args.setSelectedElementIds([elementId]);
  }

  function addIconElement(icon: SlideIconDefinition, color: string) {
    if (!canEditSlideCanvas(args.currentSlide)) return;
    const elementId = createElementId(args.deck);
    const width = icon.defaultWidth ?? 96;
    const height = icon.defaultHeight ?? 96;
    const x = Math.max(0, (args.deck.canvas.width - width) / 2);
    const y = Math.max(0, (args.deck.canvas.height - height) / 2);
    args.commitPatch((currentDeck) => createAddElementPatch(currentDeck, args.currentSlide!.slideId, {
      elementId,
      type: "svg",
      role: "decoration",
      x,
      y,
      width,
      height,
      rotation: 0,
      opacity: 1,
      zIndex: getNextElementZIndex(args.currentSlide!.elements),
      locked: false,
      visible: true,
      props: {
        src: createSlideIconDataUrl(icon, color),
        alt: icon.label,
        fit: "stretch",
        focusX: 0.5,
        focusY: 0.5
      }
    }));
    args.setSelectedElementIds([elementId]);
    args.setInsertTool("select");
  }

  function insertShapeElement(shapeType: ShapeInsertType) {
    if (!canEditSlideCanvas(args.currentSlide)) return;
    if (shapeType === "customShape") {
      args.setEditingElementId(null);
      args.setCustomShapeEditElementId(null);
      args.setSelectedElementIds([]);
      args.setInsertTool("customShape");
      args.setIsShapeMenuOpen(false);
      return;
    }
    const elementId = createElementId(args.deck);
    const redesignPalette = resolveRedesignPalette();
    const primaryColor =
      redesignPalette?.primary ?? args.deck.theme.palette.primary;
    const primaryContainerColor =
      redesignPalette?.primaryContainer ?? primaryColor;
    const frames: Record<
      ShapeInsertType,
      { x: number; y: number; width: number; height: number }
    > = {
      rect: { x: 260, y: 220, width: 280, height: 160 },
      ellipse: { x: 260, y: 220, width: 180, height: 180 },
      line: { x: 240, y: 280, width: 320, height: 12 },
      arrow: { x: 240, y: 280, width: 360, height: 28 },
      triangle: { x: 260, y: 220, width: 180, height: 180 },
      polygon: { x: 260, y: 220, width: 180, height: 180 },
      star: { x: 260, y: 220, width: 180, height: 180 },
      customShape: { x: 260, y: 220, width: 220, height: 160 },
    };
    const frame = frames[shapeType];
    const nextElement: DeckElement = {
      elementId,
      type: shapeType === "triangle" ? "polygon" : shapeType,
      role:
        shapeType === "line" || shapeType === "arrow"
          ? "decoration"
          : "highlight",
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      rotation: 0,
      opacity: 1,
      zIndex: getNextElementZIndex(args.currentSlide.elements),
      locked: false,
      visible: true,
      props: {
        fill:
          shapeType === "line" || shapeType === "arrow"
            ? "transparent"
            : primaryContainerColor,
        stroke: primaryColor,
        strokeWidth: 3,
        borderRadius: 18,
        ...(shapeType === "triangle"
          ? { sides: 3 }
          : shapeType === "polygon"
            ? { sides: 6 }
            : {}),
      } as ShapeElementProps,
    };
    args.commitPatch((currentDeck) =>
      createAddElementPatch(
        currentDeck,
        args.currentSlide!.slideId,
        nextElement,
      ),
    );
    args.setSelectedElementIds([elementId]);
    args.setInsertTool("select");
    args.setIsShapeMenuOpen(false);
  }

  function addSlide() {
    if (!args.confirmDiscardSpeakerNotesDraft()) return;
    let nextSlideIndex = args.workingDeckRef.current.slides.length;
    args.resetSpeakerNotesEditState("");
    const committed = args.commitPatch((currentDeck) => {
      const slideId = createSlideId(currentDeck);
      const nextOrder = currentDeck.slides.length + 1;
      nextSlideIndex = currentDeck.slides.length;
      return createAddSlidePatch(currentDeck, {
        kind: "content",
        slideId,
        order: nextOrder,
        title: `Slide ${nextOrder}`,
        thumbnailUrl: "",
        style: {
          layout: "title-content",
          backgroundColor: currentDeck.theme.backgroundColor,
          textColor: currentDeck.theme.textColor,
          accentColor: currentDeck.theme.accentColor,
        },
        speakerNotes: "",
        keywords: [],
        semanticCues: [],
        elements: [
          {
            elementId: createElementId(currentDeck),
            type: "text",
            role: "title",
            x: 120,
            y: 96,
            width: 720,
            height: 96,
            rotation: 0,
            opacity: 1,
            zIndex: 1,
            locked: false,
            visible: true,
            props: {
              text: `Slide ${nextOrder}`,
              fontFamily: currentDeck.theme.typography.headingFontFamily,
              fontSize: currentDeck.theme.typography.titleSize,
              fontWeight: "bold",
              color: currentDeck.theme.textColor,
              align: "left",
              verticalAlign: "top",
              lineHeight: 1.1,
            },
          },
        ],
        animations: [],
        actions: [],
      });
    });
    if (!committed) return;
    args.setCurrentSlideIndex(nextSlideIndex);
    args.setSelectedElementIds([]);
  }

  function deleteSlide(slideIndex: number) {
    const targetSlide = args.workingDeckRef.current.slides[slideIndex];
    if (!targetSlide || args.workingDeckRef.current.slides.length <= 1) return false;
    if (!args.confirmDiscardSpeakerNotesDraft()) return false;

    let nextSlideIndex = Math.max(0, slideIndex - 1);
    let nextSpeakerNotes = "";
    const committed = args.commitPatch((currentDeck) => {
      const targetIndex = currentDeck.slides.findIndex(
        (slide) => slide.slideId === targetSlide.slideId,
      );
      const remainingSlides = currentDeck.slides.filter(
        (slide) => slide.slideId !== targetSlide.slideId,
      );
      nextSlideIndex = Math.min(
        targetIndex >= 0 ? targetIndex : slideIndex,
        remainingSlides.length - 1,
      );
      nextSpeakerNotes = remainingSlides[nextSlideIndex]?.speakerNotes ?? "";

      return {
        deckId: currentDeck.deckId,
        baseVersion: currentDeck.version,
        source: "user",
        operations: [{ type: "delete_slide", slideId: targetSlide.slideId }],
      };
    });
    if (!committed) return false;

    args.resetSpeakerNotesEditState(nextSpeakerNotes);
    args.setCurrentSlideIndex(nextSlideIndex);
    args.setSelectedElementIds([]);
    args.setEditingElementId(null);
    args.setCustomShapeEditElementId(null);
    args.setElementContextMenu(null);
    return true;
  }

  function addActivitySlide(template: ActivityTemplate) {
    if (!args.confirmDiscardSpeakerNotesDraft()) return false;
    if (args.workingDeckRef.current.canvas.preset !== "wide-16-9") return false;

    let nextSlideIndex = args.workingDeckRef.current.slides.length;
    args.resetSpeakerNotesEditState("");
    const committed = args.commitPatch((currentDeck) => {
      const slide = createActivitySlide(currentDeck, template);
      nextSlideIndex = currentDeck.slides.length;
      return createAddSlidePatch(currentDeck, slide);
    });
    if (!committed) return false;

    args.setCurrentSlideIndex(nextSlideIndex);
    args.setSelectedElementIds([]);
    args.setEditingElementId(null);
    args.setCustomShapeEditElementId(null);
    return true;
  }

  function addActivityResultsSlide(sourceActivityId?: string) {
    if (!args.confirmDiscardSpeakerNotesDraft()) return false;
    if (args.workingDeckRef.current.canvas.preset !== "wide-16-9") return false;

    const source = [...args.workingDeckRef.current.slides]
      .reverse()
      .find(
        (slide) =>
          slide.kind === "activity" &&
          (sourceActivityId === undefined ||
            slide.activity.activityId === sourceActivityId)
      );
    if (!source || source.kind !== "activity") return false;

    let nextSlideIndex = args.workingDeckRef.current.slides.length;
    args.resetSpeakerNotesEditState("");
    const committed = args.commitPatch((currentDeck) => {
      const slide = createActivityResultsSlide(
        currentDeck,
        source.activity.activityId
      );
      nextSlideIndex = currentDeck.slides.length;
      return createAddSlidePatch(currentDeck, slide);
    });
    if (!committed) return false;

    args.setCurrentSlideIndex(nextSlideIndex);
    args.setSelectedElementIds([]);
    args.setEditingElementId(null);
    args.setCustomShapeEditElementId(null);
    return true;
  }

  function deleteSelectedElement() {
    if (!canEditSlideCanvas(args.currentSlide) || args.selectedElementIds.length === 0) return;
    args.setElementContextMenu(null);
    const elementsById = new Map(
      args.currentSlide.elements.map((element) => [element.elementId, element])
    );
    const deleteElementIds = new Set<string>();
    const collectDeleteTargets = (elementId: string) => {
      if (deleteElementIds.has(elementId)) return;
      const element = elementsById.get(elementId);
      if (!element) return;
      if (element.type === "group") {
        const groupProps = element.props as GroupElementProps;
        for (const childElementId of groupProps.childElementIds) {
          collectDeleteTargets(childElementId);
        }
      }
      deleteElementIds.add(elementId);
    };
    for (const elementId of args.selectedElementIds) collectDeleteTargets(elementId);
    args.commitPatch((currentDeck) => ({
      deckId: currentDeck.deckId,
      baseVersion: currentDeck.version,
      source: "user",
      operations: [...deleteElementIds].map((elementId) => ({
        type: "delete_element" as const,
        slideId: args.currentSlide!.slideId,
        elementId,
      })),
    }));
    args.setSelectedElementIds([]);
    args.setEditingElementId(null);
    args.setCustomShapeEditElementId(null);
  }

  function getCloneSourceElements(rootElement: DeckElement) {
    if (!canEditSlideCanvas(args.currentSlide) || rootElement.type !== "group") {
      return canEditSlideCanvas(args.currentSlide) ? [rootElement] : [];
    }
    const elementsById = new Map(
      args.currentSlide.elements.map((element) => [element.elementId, element]),
    );
    const collected: DeckElement[] = [];
    const visited = new Set<string>();
    const collect = (element: DeckElement) => {
      if (visited.has(element.elementId)) return;
      visited.add(element.elementId);
      collected.push(element);
      if (element.type !== "group") return;
      const groupProps = element.props as GroupElementProps;
      for (const childElementId of groupProps.childElementIds) {
        const childElement = elementsById.get(childElementId);
        if (childElement) collect(childElement);
      }
    };
    collect(rootElement);
    return collected;
  }

  function cloneElements(
    sourceElements: DeckElement[],
    rootElementId: string,
    offsetMultiplier = 1,
  ) {
    if (!canEditSlideCanvas(args.currentSlide)) return null;
    if (sourceElements.length === 0) return null;
    const existingIds = new Set(
      args.deck.slides.flatMap((slide) =>
        slide.elements.map((element) => element.elementId),
      ),
    );
    const idMap = new Map<string, string>();
    for (const sourceElement of sourceElements) {
      let index = 1;
      while (existingIds.has(`el_${index}`)) index += 1;
      const nextElementId = `el_${index}`;
      existingIds.add(nextElementId);
      idMap.set(sourceElement.elementId, nextElementId);
    }
    const highestZIndex = args.currentSlide.elements.reduce(
      (highest, element) => Math.max(highest, element.zIndex),
      0,
    );
    const lowestSourceZIndex = Math.min(
      ...sourceElements.map((element) => element.zIndex),
    );
    const offset = 24 * offsetMultiplier;
    const clonedElements = sourceElements.map((sourceElement) => {
      const clonedElement = structuredClone(sourceElement);
      clonedElement.elementId = idMap.get(sourceElement.elementId)!;
      clonedElement.x = sourceElement.x + offset;
      clonedElement.y = sourceElement.y + offset;
      clonedElement.zIndex =
        highestZIndex + 1 + sourceElement.zIndex - lowestSourceZIndex;
      if (clonedElement.type === "group") {
        const groupProps = clonedElement.props as GroupElementProps;
        groupProps.childElementIds = groupProps.childElementIds
          .map((childElementId) => idMap.get(childElementId))
          .filter((childElementId): childElementId is string => Boolean(childElementId));
      }
      return clonedElement;
    });
    args.commitPatch((currentDeck) => ({
      deckId: currentDeck.deckId,
      baseVersion: currentDeck.version,
      source: "user",
      operations: clonedElements.map((element) => ({
        type: "add_element" as const,
        slideId: args.currentSlide!.slideId,
        element,
      })),
    }));
    const nextRootElementId = idMap.get(rootElementId) ?? null;
    if (nextRootElementId) args.setSelectedElementIds([nextRootElementId]);
    args.setEditingElementId(null);
    args.setCustomShapeEditElementId(null);
    return nextRootElementId;
  }

  function duplicateSelectedElement() {
    if (!canEditSlideCanvas(args.currentSlide) || !args.selectedElement) return;
    args.setElementContextMenu(null);
    cloneElements(
      getCloneSourceElements(args.selectedElement),
      args.selectedElement.elementId
    );
  }

  function copySelectedElement() {
    if (!canEditSlideCanvas(args.currentSlide) || !args.selectedElement) return;
    args.setElementContextMenu(null);
    copiedElementRef.current = {
      elements: structuredClone(getCloneSourceElements(args.selectedElement)),
      pasteCount: 0,
      rootElementId: args.selectedElement.elementId,
    };
  }

  function pasteCopiedElement() {
    if (!canEditSlideCanvas(args.currentSlide) || !copiedElementRef.current) return;
    args.setElementContextMenu(null);
    const { elements, pasteCount, rootElementId } = copiedElementRef.current;
    const nextPasteCount = pasteCount + 1;
    cloneElements(elements, rootElementId, nextPasteCount);
    copiedElementRef.current = { elements, pasteCount: nextPasteCount, rootElementId };
  }

  function createDrawnElement(
    draft:
      | { type: "text"; x: number; y: number; width: number; height: number }
      | {
          type: "rect" | "ellipse" | "line";
          x: number;
          y: number;
          width: number;
          height: number;
        },
  ) {
    if (!canEditSlideCanvas(args.currentSlide)) return;
    const elementId = createElementId(args.deck);
    const redesignPalette = resolveRedesignPalette();
    const primaryColor =
      redesignPalette?.primary ?? args.deck.theme.palette.primary;
    const primaryContainerColor =
      redesignPalette?.primaryContainer ?? primaryColor;
    if (draft.type === "text") {
      args.commitPatch((currentDeck) =>
        createAddElementPatch(currentDeck, args.currentSlide!.slideId, {
          elementId,
          type: "text",
          role: "body",
          x: draft.x,
          y: draft.y,
          width: draft.width,
          height: draft.height,
          rotation: 0,
          opacity: 1,
          zIndex: getNextElementZIndex(args.currentSlide!.elements),
          locked: false,
          visible: true,
          props: {
            text: "텍스트 입력",
            fontFamily:
              args.currentSlide!.style.fontFamily ??
              args.deck.theme.typography.bodyFontFamily,
            fontSize: args.deck.theme.typography.bodySize,
            fontWeight: "normal",
            color:
              args.currentSlide!.style.textColor ?? args.deck.theme.textColor,
            align: "left",
            verticalAlign: "top",
            lineHeight: 1.2,
          },
        }),
      );
      args.setEditingElementId(elementId);
    } else {
      args.commitPatch((currentDeck) =>
        createAddElementPatch(currentDeck, args.currentSlide!.slideId, {
          elementId,
          type: draft.type,
          role: draft.type === "line" ? "decoration" : "highlight",
          x: draft.x,
          y: draft.y,
          width: Math.max(8, draft.width),
          height: Math.max(8, draft.height),
          rotation: 0,
          opacity: 1,
          zIndex: getNextElementZIndex(args.currentSlide!.elements),
          locked: false,
          visible: true,
          props: {
            fill: draft.type === "line" ? "transparent" : primaryContainerColor,
            stroke: primaryColor,
            strokeWidth: 3,
            borderRadius: 18,
          },
        }),
      );
    }
    args.setSelectedElementIds([elementId]);
    args.setInsertTool("select");
  }

  function createCustomShape(nodes: CustomShapeNode[], closed: boolean) {
    if (!canEditSlideCanvas(args.currentSlide) || nodes.length < 2) {
      args.setInsertTool("select");
      return;
    }
    const elementId = createElementId(args.deck);
    const geometry = normalizeCustomShapeAbsoluteGeometry(nodes, closed);
    args.commitPatch((currentDeck) =>
      createAddElementPatch(currentDeck, args.currentSlide!.slideId, {
        elementId,
        type: "customShape",
        role: "highlight",
        x: geometry.frame.x,
        y: geometry.frame.y,
        width: geometry.frame.width,
        height: geometry.frame.height,
        rotation: 0,
        opacity: 1,
        zIndex: getNextElementZIndex(args.currentSlide!.elements),
        locked: false,
        visible: true,
        props: {
          closed: geometry.props.closed,
          fill: "#f5edff",
          nodes: geometry.props.nodes,
          stroke: "#9333ea",
          strokeWidth: 2,
          viewBoxWidth: geometry.props.viewBoxWidth,
          viewBoxHeight: geometry.props.viewBoxHeight,
          pathData: geometry.props.pathData,
        },
      }),
    );
    args.setSelectedElementIds([elementId]);
    args.setCustomShapeEditElementId(elementId);
    args.setInsertTool("select");
  }

  function commitCustomShapeGeometry(
    slideId: string,
    elementId: string,
    nodes: CustomShapeNode[],
    closed: boolean,
  ) {
    const slide = args.deck.slides.find(
      (candidate) => candidate.slideId === slideId,
    );
    const element = slide?.elements.find(
      (candidate) => candidate.elementId === elementId,
    );
    if (
      !canEditSlideCanvas(slide) ||
      !element ||
      element.type !== "customShape" ||
      nodes.length < 2
    ) {
      return;
    }
    const geometry = normalizeCustomShapeAbsoluteGeometry(nodes, closed);
    args.commitPatch((currentDeck) => ({
      deckId: currentDeck.deckId,
      baseVersion: currentDeck.version,
      source: "user",
      operations: [
        {
          type: "update_element_frame",
          slideId,
          elementId,
          frame: normalizeElementFrameDraft(
            currentDeck.canvas,
            element,
            geometry.frame,
          ),
        },
        {
          type: "update_element_props",
          slideId,
          elementId,
          props: {
            closed: geometry.props.closed,
            nodes: geometry.props.nodes,
            pathData: geometry.props.pathData,
            viewBoxWidth: geometry.props.viewBoxWidth,
            viewBoxHeight: geometry.props.viewBoxHeight,
          },
        },
      ],
    }));
  }

  function changeElementFrame(
    slideId: string,
    elementId: string,
    frame: ElementFrameChange,
  ) {
    const slide = args.deck.slides.find(
      (candidate) => candidate.slideId === slideId,
    );
    const element = slide?.elements.find(
      (candidate) => candidate.elementId === elementId,
    );
    if (!canEditSlideCanvas(slide) || !element) return;
    try {
      args.commitPatch((currentDeck) =>
        element.type === "group"
          ? createGroupedElementFramePatch(
              currentDeck,
              slideId,
              elementId,
              frame,
            )
          : createElementFramePatch(currentDeck, slideId, elementId, frame),
      );
    } catch (error) {
      args.setLastPatchLabel(
        error instanceof Error ? `실패 · ${error.message}` : "실패 · unknown",
      );
    }
  }

  function changeElementLayerOrder(
    slideId: string,
    elementId: string,
    action: ElementLayerOrderAction,
  ) {
    const slide = args.deck.slides.find(
      (candidate) => candidate.slideId === slideId,
    );
    if (!canEditSlideCanvas(slide)) return;
    const updates = getElementLayerOrderUpdates(
      slide.elements,
      elementId,
      action,
    );
    if (updates.length === 0) return;

    args.commitPatch((currentDeck) => {
      const currentSlide = currentDeck.slides.find(
        (candidate) => candidate.slideId === slideId,
      );
      if (!currentSlide) {
        throw new Error(`Slide ${slideId} was not found`);
      }
      return {
        deckId: currentDeck.deckId,
        baseVersion: currentDeck.version,
        source: "user",
        operations: updates.map((update) => {
          const element = currentSlide.elements.find(
            (candidate) => candidate.elementId === update.elementId,
          );
          if (!element) {
            throw new Error(`Element ${update.elementId} was not found`);
          }
          return {
            type: "update_element_frame" as const,
            slideId,
            elementId: update.elementId,
            frame: normalizeElementFrameDraft(currentDeck.canvas, element, {
              zIndex: update.zIndex,
            }),
          };
        }),
      };
    });
  }

  function createGroupFromSelection() {
    if (!canEditSlideCanvas(args.currentSlide) || args.selectedElements.length < 2) return;
    const elementId = createElementId(args.deck);
    const bounds = getGroupedSelectionBounds(args.selectedElements);
    const highestZIndex = args.selectedElements.reduce(
      (highest, element) => Math.max(highest, element.zIndex),
      0,
    );
    args.commitPatch((currentDeck) =>
      createAddElementPatch(currentDeck, args.currentSlide!.slideId, {
        elementId,
        type: "group",
        role: "decoration",
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        rotation: 0,
        opacity: 1,
        zIndex: highestZIndex + 1,
        locked: false,
        visible: true,
        props: {
          childElementIds: args.selectedElements.map(
            (element) => element.elementId,
          ),
        },
      }),
    );
    args.setElementContextMenu(null);
    args.setEditingElementId(null);
    args.setCustomShapeEditElementId(null);
    args.setSelectedElementIds([elementId]);
  }

  function ungroupElement(slideId: string, elementId: string) {
    const slide = args.deck.slides.find(
      (candidate) => candidate.slideId === slideId,
    );
    const groupElement = slide?.elements.find(
      (candidate) => candidate.elementId === elementId,
    );
    if (
      !canEditSlideCanvas(slide) ||
      !groupElement ||
      groupElement.type !== "group"
    ) {
      return;
    }
    const groupProps = groupElement.props as GroupElementProps;
    const childElements = getGroupChildElements(
      slide,
      groupProps.childElementIds,
    );
    args.commitPatch((currentDeck) => ({
      deckId: currentDeck.deckId,
      baseVersion: currentDeck.version,
      source: "user",
      operations: [{ type: "delete_element", slideId, elementId }],
    }));
    args.setElementContextMenu(null);
    args.setEditingElementId(null);
    args.setCustomShapeEditElementId(null);
    args.setSelectedElementIds(
      childElements.map((element) => element.elementId),
    );
  }

  function clearCanvasSelection() {
    args.setElementContextMenu(null);
    args.setSelectedElementIds([]);
    args.setEditingElementId(null);
    args.setCustomShapeEditElementId(null);
  }

  function openElementContextMenu(input: {
    clientX: number;
    clientY: number;
    element: DeckElement;
    slideId: string;
  }) {
    const slide = args.deck.slides.find(
      (candidate) => candidate.slideId === input.slideId,
    );
    if (!canEditSlideCanvas(slide)) return;
    const isSelectedElement = args.selectedElementIds.includes(
      input.element.elementId,
    );
    const isGroupingTarget =
      isSelectedElement && args.selectedElementIds.length > 1;
    const isTableCellTarget = input.element.type === "table";
    if (
      !isGroupingTarget &&
      input.element.type !== "image" &&
      input.element.type !== "group" &&
      !isTableCellTarget
    ) {
      return;
    }
    const { left, top } = getContextMenuPosition({
      clientX: input.clientX,
      clientY: input.clientY,
      height: isTableCellTarget ? 384 : 60,
      width: 196,
    });
    args.setEditingElementId(null);
    if (isGroupingTarget) {
      args.setElementContextMenu({
        elementIds: args.selectedElementIds,
        left,
        slideId: input.slideId,
        top,
        type: "selection",
      });
      return;
    }
    if (input.element.type === "table") {
      const activeTableCell = useEditorShellUiStore.getState().activeTableCell;
      if (
        !activeTableCell ||
        activeTableCell.elementId !== input.element.elementId ||
        activeTableCell.slideId !== input.slideId
      ) {
        return;
      }
      const actionStates = getTableContextActionStates({
        deck: args.workingDeckRef.current,
        element: input.element,
        selection: getTableCellTargetRange(activeTableCell),
      });
      const actionDisabledReasons = Object.fromEntries(
        (
          [
            "insertRowAbove",
            "insertRowBelow",
            "insertColumnLeft",
            "insertColumnRight",
            "deleteRow",
            "deleteColumn",
            "mergeCells",
            "unmergeCell",
          ] as const
        ).flatMap((action) =>
          actionStates[action].enabled
            ? []
            : [[action, actionStates[action].reason] as const]
        )
      );
      args.setSelectedElementIds([input.element.elementId]);
      args.setElementContextMenu({
        actionDisabledReasons,
        columnIndex: activeTableCell.columnIndex,
        elementId: input.element.elementId,
        left,
        rowIndex: activeTableCell.rowIndex,
        selection: getTableCellTargetRange(activeTableCell),
        slideId: input.slideId,
        top,
        type: "table-cell"
      });
      return;
    }
    args.setSelectedElementIds([input.element.elementId]);
    args.setElementContextMenu({
      elementId: input.element.elementId,
      left,
      slideId: input.slideId,
      top,
      type: input.element.type === "group" ? "group" : "image",
    });
  }

  return {
    actions: {
      addChartElement,
      addActivityResultsSlide,
      addIconElement,
      addSlide,
      addActivitySlide,
      addTextElement,
      changeElementFrame,
      changeElementLayerOrder,
      clearCanvasSelection,
      commitCustomShapeGeometry,
      convertChartToTable,
      copySelectedElement,
      createCustomShape,
      createDrawnElement,
      createGroupFromSelection,
      deleteSlide,
      deleteSelectedElement,
      duplicateSelectedElement,
      insertShapeElement,
      openElementContextMenu,
      pasteCopiedElement,
      ungroupElement,
    },
    refs: { copiedElementRef },
  };
}

function createDefaultTableProps(input: {
  fontFamily: string;
  headerFill: string;
  height: number;
  textColor: string;
  width: number;
}): TableElementProps {
  const values = [
    ["항목", "값"],
    ["A", "48"],
    ["B", "72"],
    ["C", "56"],
  ];
  return createTableProps(values, {
    bodyFill: "#ffffff",
    fontFamily: input.fontFamily,
    headerFill: input.headerFill,
    height: input.height,
    textColor: input.textColor,
    width: input.width,
  });
}

function createTablePropsFromChart(
  chart: Chart,
  width: number,
  height: number,
  fallbackTextColor: string,
  fallbackFontFamily: string,
): TableElementProps {
  const hasSeries = chart.type === "line" && chart.data.some((datum) => Boolean(datum.series));
  const headers = chart.type === "scatter"
    ? ["항목", "X", "Y"]
    : hasSeries
      ? ["항목", "시리즈", "값"]
      : ["항목", "값"];
  const values = [
    headers,
    ...chart.data.map((datum, index) => {
      if ("x" in datum) return [datum.label ?? String(index + 1), String(datum.x), String(datum.y)];
      if (hasSeries) {
        return [
          datum.label,
          "series" in datum ? datum.series ?? "" : "",
          String(datum.value),
        ];
      }
      return [datum.label, String(datum.value)];
    }),
  ];
  return createTableProps(values, {
    bodyFill: chart.style.backgroundColor ?? "#ffffff",
    fontFamily: chart.style.fontFamily ?? fallbackFontFamily,
    headerFill: chart.style.colors[0] ?? "#e0f3ff",
    height,
    textColor: chart.style.textColor ?? fallbackTextColor,
    width,
  });
}

function createTableProps(
  values: string[][],
  style: {
    bodyFill: string;
    fontFamily: string;
    headerFill: string;
    height: number;
    textColor: string;
    width: number;
  },
): TableElementProps {
  const columnCount = Math.max(1, ...values.map((row) => row.length));
  const rowCount = Math.max(1, values.length);
  return {
    borderColor: "#CBD5E1",
    borderWidth: 1,
    columnWidths: Array.from({ length: columnCount }, () => style.width / columnCount),
    rowHeights: Array.from({ length: rowCount }, () => style.height / rowCount),
    rows: values.map((row, rowIndex) =>
      Array.from({ length: columnCount }, (_, columnIndex) =>
        createTableCell(row[columnIndex] ?? "", {
          fill: rowIndex === 0 ? style.headerFill : style.bodyFill,
          fontFamily: style.fontFamily,
          fontWeight: rowIndex === 0 ? "bold" : "normal",
          textColor: style.textColor,
        }),
      ),
    ),
  };
}

function createTableCell(
  text: string,
  style: {
    fill: string;
    fontFamily: string;
    fontWeight: TableCellProps["fontWeight"];
    textColor: string;
  },
): TableCellProps {
  return {
    align: "center",
    borderColor: "#CBD5E1",
    borderWidth: 1,
    colSpan: 1,
    fill: style.fill,
    fontFamily: style.fontFamily,
    fontSize: 18,
    fontWeight: style.fontWeight,
    rowSpan: 1,
    text,
    textColor: style.textColor,
    verticalAlign: "middle",
  };
}
