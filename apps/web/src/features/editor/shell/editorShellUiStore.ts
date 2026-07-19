import { create } from "zustand";

import type { TableCellRange } from "../../../../../../packages/editor-core/src/index";

import { defaultAnimationPaneWidth } from "./components/animation/utils/layout";

export const defaultSlidesPaneWidth = 184;
export const defaultRightPaneWidth = 348;

export type TopMenu = "file" | "editMode" | "presentation";
export type SlidePanelView = "thumbnail" | "list";
export type InsertTool =
  | "select"
  | "text"
  | "rect"
  | "ellipse"
  | "line"
  | "customShape";
export type ShapeMenuPosition = {
  left: number;
  top: number;
};
export type TableContextAction =
  | "insertRowAbove"
  | "insertRowBelow"
  | "insertColumnLeft"
  | "insertColumnRight"
  | "deleteRow"
  | "deleteColumn"
  | "mergeCells"
  | "unmergeCell";
export type TableCellTarget = {
  anchorColumnIndex?: number;
  anchorRowIndex?: number;
  cellEditDisabledReason: string | null;
  columnIndex: number;
  elementId: string;
  rowIndex: number;
  slideId: string;
};
export type TableOperationRequest = {
  columnIndex: number;
  elementId: string;
  rowIndex: number;
  selection?: TableCellRange;
  slideId: string;
} & (
  | { action: TableContextAction }
  | { action: "updateCellText"; text: string }
);
export type ElementContextMenuState =
  | {
      elementId: string;
      left: number;
      slideId: string;
      top: number;
      type: "image";
    }
  | {
      elementId: string;
      left: number;
      slideId: string;
      top: number;
      type: "group";
    }
  | {
      elementIds: string[];
      left: number;
      slideId: string;
      top: number;
      type: "selection";
    }
  | {
      actionDisabledReasons: Partial<Record<TableContextAction, string>>;
      columnIndex: number;
      elementId: string;
      left: number;
      rowIndex: number;
      selection: TableCellRange;
      slideId: string;
      top: number;
      type: "table-cell";
    };

export type EditorShellUiUpdater<T> = T | ((current: T) => T);

type EditorShellUiStateValues = {
  activeTopMenu: TopMenu | null;
  activeTableCell: TableCellTarget | null;
  animationPanelFocusedAnimationId: string | null;
  animationPaneWidth: number;
  customShapeEditElementId: string | null;
  editingElementId: string | null;
  elementContextMenu: ElementContextMenuState | null;
  insertTool: InsertTool;
  isAnimationPanelOpen: boolean;
  isIconPanelOpen: boolean;
  isAudienceLinkModalOpen: boolean;
  isDataViewOpen: boolean;
  isExitConfirmOpen: boolean;
  isPresenceDebugOpen: boolean;
  isRightPanelOpen: boolean;
  isShapeMenuOpen: boolean;
  isSlidesPaneCollapsed: boolean;
  rightPaneWidth: number;
  selectedElementIds: string[];
  selectedKeywordId: string | null;
  selectedKeywordOccurrenceKey: string | null;
  shapeMenuPosition: ShapeMenuPosition | null;
  showIds: boolean;
  slidePanelView: SlidePanelView;
  slidesPaneWidth: number;
  tableOperationRequest: TableOperationRequest | null;
};

export function getTableCellTargetRange(
  target: TableCellTarget,
): TableCellRange {
  const anchorRowIndex = target.anchorRowIndex ?? target.rowIndex;
  const anchorColumnIndex = target.anchorColumnIndex ?? target.columnIndex;
  return {
    startRowIndex: Math.min(anchorRowIndex, target.rowIndex),
    endRowIndex: Math.max(anchorRowIndex, target.rowIndex),
    startColumnIndex: Math.min(anchorColumnIndex, target.columnIndex),
    endColumnIndex: Math.max(anchorColumnIndex, target.columnIndex),
  };
}

type EditorShellUiStateActions = {
  resetProjectUiState: () => void;
  setActiveTopMenu: (updater: EditorShellUiUpdater<TopMenu | null>) => void;
  setActiveTableCell: (
    updater: EditorShellUiUpdater<TableCellTarget | null>
  ) => void;
  setAnimationPanelFocusedAnimationId: (
    updater: EditorShellUiUpdater<string | null>
  ) => void;
  setAnimationPaneWidth: (updater: EditorShellUiUpdater<number>) => void;
  setCustomShapeEditElementId: (
    updater: EditorShellUiUpdater<string | null>
  ) => void;
  setEditingElementId: (updater: EditorShellUiUpdater<string | null>) => void;
  setElementContextMenu: (
    updater: EditorShellUiUpdater<ElementContextMenuState | null>
  ) => void;
  setInsertTool: (updater: EditorShellUiUpdater<InsertTool>) => void;
  setIsAnimationPanelOpen: (updater: EditorShellUiUpdater<boolean>) => void;
  setIsIconPanelOpen: (updater: EditorShellUiUpdater<boolean>) => void;
  setIsAudienceLinkModalOpen: (updater: EditorShellUiUpdater<boolean>) => void;
  setIsDataViewOpen: (updater: EditorShellUiUpdater<boolean>) => void;
  setIsExitConfirmOpen: (updater: EditorShellUiUpdater<boolean>) => void;
  setIsPresenceDebugOpen: (updater: EditorShellUiUpdater<boolean>) => void;
  setIsRightPanelOpen: (updater: EditorShellUiUpdater<boolean>) => void;
  setIsShapeMenuOpen: (updater: EditorShellUiUpdater<boolean>) => void;
  setIsSlidesPaneCollapsed: (updater: EditorShellUiUpdater<boolean>) => void;
  setRightPaneWidth: (updater: EditorShellUiUpdater<number>) => void;
  setSelectedElementIds: (updater: EditorShellUiUpdater<string[]>) => void;
  setSelectedKeywordId: (updater: EditorShellUiUpdater<string | null>) => void;
  setSelectedKeywordOccurrenceKey: (
    updater: EditorShellUiUpdater<string | null>
  ) => void;
  setShapeMenuPosition: (
    updater: EditorShellUiUpdater<ShapeMenuPosition | null>
  ) => void;
  setShowIds: (updater: EditorShellUiUpdater<boolean>) => void;
  setSlidePanelView: (updater: EditorShellUiUpdater<SlidePanelView>) => void;
  setSlidesPaneWidth: (updater: EditorShellUiUpdater<number>) => void;
  setTableOperationRequest: (
    updater: EditorShellUiUpdater<TableOperationRequest | null>
  ) => void;
};

export type EditorShellUiState = EditorShellUiStateValues & EditorShellUiStateActions;

export const editorShellUiInitialState: EditorShellUiStateValues = {
  activeTopMenu: null,
  activeTableCell: null,
  animationPanelFocusedAnimationId: null,
  animationPaneWidth: defaultAnimationPaneWidth,
  customShapeEditElementId: null,
  editingElementId: null,
  elementContextMenu: null,
  insertTool: "select",
  isAnimationPanelOpen: false,
  isIconPanelOpen: false,
  isAudienceLinkModalOpen: false,
  isDataViewOpen: false,
  isExitConfirmOpen: false,
  isPresenceDebugOpen: false,
  isRightPanelOpen: true,
  isShapeMenuOpen: false,
  isSlidesPaneCollapsed: false,
  rightPaneWidth: defaultRightPaneWidth,
  selectedElementIds: [],
  selectedKeywordId: null,
  selectedKeywordOccurrenceKey: null,
  shapeMenuPosition: null,
  showIds: false,
  slidePanelView: "thumbnail",
  slidesPaneWidth: defaultSlidesPaneWidth,
  tableOperationRequest: null
};

export const useEditorShellUiStore = create<EditorShellUiState>((set) => ({
  ...editorShellUiInitialState,
  resetProjectUiState: () =>
    set({
      activeTopMenu: null,
      activeTableCell: null,
      animationPanelFocusedAnimationId: null,
      customShapeEditElementId: null,
      editingElementId: null,
      elementContextMenu: null,
      insertTool: "select",
      isIconPanelOpen: false,
      isAudienceLinkModalOpen: false,
      isExitConfirmOpen: false,
      isShapeMenuOpen: false,
      selectedElementIds: [],
      selectedKeywordId: null,
      selectedKeywordOccurrenceKey: null,
      shapeMenuPosition: null,
      tableOperationRequest: null
    }),
  setActiveTopMenu: (updater) =>
    set((state) => ({
      activeTopMenu: resolveUpdater(state.activeTopMenu, updater)
    })),
  setActiveTableCell: (updater) =>
    set((state) => ({
      activeTableCell: resolveUpdater(state.activeTableCell, updater)
    })),
  setAnimationPanelFocusedAnimationId: (updater) =>
    set((state) => ({
      animationPanelFocusedAnimationId: resolveUpdater(
        state.animationPanelFocusedAnimationId,
        updater
      )
    })),
  setAnimationPaneWidth: (updater) =>
    set((state) => ({
      animationPaneWidth: resolveUpdater(state.animationPaneWidth, updater)
    })),
  setCustomShapeEditElementId: (updater) =>
    set((state) => ({
      customShapeEditElementId: resolveUpdater(
        state.customShapeEditElementId,
        updater
      )
    })),
  setEditingElementId: (updater) =>
    set((state) => ({
      editingElementId: resolveUpdater(state.editingElementId, updater)
    })),
  setElementContextMenu: (updater) =>
    set((state) => ({
      elementContextMenu: resolveUpdater(state.elementContextMenu, updater)
    })),
  setInsertTool: (updater) =>
    set((state) => ({
      insertTool: resolveUpdater(state.insertTool, updater)
    })),
  setIsAnimationPanelOpen: (updater) =>
    set((state) => ({
      isAnimationPanelOpen: resolveUpdater(state.isAnimationPanelOpen, updater)
    })),
  setIsIconPanelOpen: (updater) =>
    set((state) => ({
      isIconPanelOpen: resolveUpdater(state.isIconPanelOpen, updater)
    })),
  setIsAudienceLinkModalOpen: (updater) =>
    set((state) => ({
      isAudienceLinkModalOpen: resolveUpdater(state.isAudienceLinkModalOpen, updater)
    })),
  setIsDataViewOpen: (updater) =>
    set((state) => ({
      isDataViewOpen: resolveUpdater(state.isDataViewOpen, updater)
    })),
  setIsExitConfirmOpen: (updater) =>
    set((state) => ({
      isExitConfirmOpen: resolveUpdater(state.isExitConfirmOpen, updater)
    })),
  setIsPresenceDebugOpen: (updater) =>
    set((state) => ({
      isPresenceDebugOpen: resolveUpdater(state.isPresenceDebugOpen, updater)
    })),
  setIsRightPanelOpen: (updater) =>
    set((state) => ({
      isRightPanelOpen: resolveUpdater(state.isRightPanelOpen, updater)
    })),
  setIsShapeMenuOpen: (updater) =>
    set((state) => ({
      isShapeMenuOpen: resolveUpdater(state.isShapeMenuOpen, updater)
    })),
  setIsSlidesPaneCollapsed: (updater) =>
    set((state) => ({
      isSlidesPaneCollapsed: resolveUpdater(state.isSlidesPaneCollapsed, updater)
    })),
  setRightPaneWidth: (updater) =>
    set((state) => ({
      rightPaneWidth: resolveUpdater(state.rightPaneWidth, updater)
    })),
  setSelectedElementIds: (updater) =>
    set((state) => {
      const selectedElementIds = resolveUpdater(
        state.selectedElementIds,
        updater
      );
      return {
        activeTableCell:
          state.activeTableCell &&
          selectedElementIds.includes(state.activeTableCell.elementId)
            ? state.activeTableCell
            : null,
        selectedElementIds
      };
    }),
  setSelectedKeywordId: (updater) =>
    set((state) => ({
      selectedKeywordId: resolveUpdater(state.selectedKeywordId, updater)
    })),
  setSelectedKeywordOccurrenceKey: (updater) =>
    set((state) => ({
      selectedKeywordOccurrenceKey: resolveUpdater(
        state.selectedKeywordOccurrenceKey,
        updater
      )
    })),
  setShapeMenuPosition: (updater) =>
    set((state) => ({
      shapeMenuPosition: resolveUpdater(state.shapeMenuPosition, updater)
    })),
  setShowIds: (updater) =>
    set((state) => ({
      showIds: resolveUpdater(state.showIds, updater)
    })),
  setSlidePanelView: (updater) =>
    set((state) => ({
      slidePanelView: resolveUpdater(state.slidePanelView, updater)
    })),
  setSlidesPaneWidth: (updater) =>
    set((state) => ({
      slidesPaneWidth: resolveUpdater(state.slidesPaneWidth, updater)
    })),
  setTableOperationRequest: (updater) =>
    set((state) => ({
      tableOperationRequest: resolveUpdater(state.tableOperationRequest, updater)
    }))
}));

function resolveUpdater<T>(current: T, updater: EditorShellUiUpdater<T>) {
  return typeof updater === "function"
    ? (updater as (current: T) => T)(current)
    : updater;
}
