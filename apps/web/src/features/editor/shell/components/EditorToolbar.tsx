import {
  IconArrowLeft,
  IconArrowRight,
  IconChartBar as BarChart3,
  IconChevronDown as ChevronDown,
  IconPhotoPlus as ImagePlus,
  IconIcons,
  IconPointer as MousePointer2,
  IconShape as Shapes,
  IconSparkles as Sparkles,
  IconTypography as Type
} from "@tabler/icons-react";
import type { ReactNode, RefObject } from "react";

import type { InsertTool } from "../editorShellUiStore";
import { EditorZoomControls } from "./EditorZoomControls";

type EditorToolbarProps = {
  canZoomIn: boolean;
  canZoomOut: boolean;
  canMutate: boolean;
  canUseCurrentSlide: boolean;
  compactSelectionTrigger?: ReactNode;
  chartMenuButtonRef: RefObject<HTMLButtonElement | null>;
  insertTool: InsertTool;
  isAnimationPanelOpen: boolean;
  isChartMenuOpen: boolean;
  isImageUploadPending: boolean;
  isIconPanelOpen: boolean;
  isShapeMenuOpen: boolean;
  isStageFitToViewport: boolean;
  onAddText: () => void;
  onOpenAnimation: () => void;
  onOpenImagePicker: () => void;
  onOpenIconLibrary: () => void;
  onRedo: () => void;
  onSelectTool: () => void;
  onToggleShapeMenu: () => void;
  onToggleChartMenu: () => void;
  onUndo: () => void;
  onFitStageToViewport: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToActualSize: () => void;
  redoDisabled: boolean;
  selectedElementAnimationCount: number;
  shapeMenuButtonRef: RefObject<HTMLButtonElement | null>;
  stageScale: number;
  undoDisabled: boolean;
};

export type ChartInsertType = "bar" | "line" | "pie" | "table";

export function EditorToolbar(props: EditorToolbarProps) {
  const editDisabledTitle = props.canUseCurrentSlide
    ? undefined
    : "특수 장표는 장표 설정에서 관리합니다.";

  return (
    <div aria-label="편집 명령" className="editor-command-bar" role="toolbar">
      {props.canMutate ? <div className="editor-toolbar">
        {props.compactSelectionTrigger}
        <div className="tool-group">
          <button aria-label="실행 취소" className="icon-button history-nav-button" disabled={props.undoDisabled} title="Undo" type="button" onClick={props.onUndo}>
            <IconArrowLeft className="history-nav-icon" size={20} stroke={2} />
          </button>
          <button aria-label="다시 실행" className="icon-button history-nav-button" disabled={props.redoDisabled} title="Redo" type="button" onClick={props.onRedo}>
            <IconArrowRight className="history-nav-icon" size={20} stroke={2} />
          </button>
          <button aria-label="선택 도구" className={`icon-button ${props.insertTool === "select" ? "selected-tool" : ""}`} disabled={!props.canUseCurrentSlide} title={editDisabledTitle ?? "Select"} type="button" onClick={props.onSelectTool}>
            <MousePointer2 size={14} />
          </button>
          <div className="toolbar-divider" />
          <button
            aria-label="텍스트"
            className="tool-button"
            disabled={!props.canUseCurrentSlide}
            title={editDisabledTitle ?? "텍스트 추가"}
            type="button"
            onClick={props.onAddText}
          >
            <Type size={17} />
          </button>
          <div className="shape-menu-anchor">
            <button
              aria-expanded={props.isShapeMenuOpen}
              aria-haspopup="menu"
              aria-label="도형"
              className={`tool-button ${props.isShapeMenuOpen || props.insertTool === "customShape" ? "active" : ""}`}
              disabled={!props.canUseCurrentSlide}
              ref={props.shapeMenuButtonRef}
              title={editDisabledTitle ?? "도형 추가"}
              type="button"
              onClick={props.onToggleShapeMenu}
            >
              <Shapes size={17} /><ChevronDown size={12} />
            </button>
          </div>
          <div className="shape-menu-anchor">
            <button
              aria-expanded={props.isChartMenuOpen}
              aria-haspopup="menu"
              aria-label="차트"
              className={`tool-button ${props.isChartMenuOpen ? "active" : ""}`}
              disabled={!props.canUseCurrentSlide}
              ref={props.chartMenuButtonRef}
              title={editDisabledTitle ?? "차트 또는 표 추가"}
              type="button"
              onClick={props.onToggleChartMenu}
            >
              <BarChart3 aria-hidden="true" size={17} />
              <ChevronDown aria-hidden="true" size={12} />
            </button>
          </div>
          <button
            aria-label="아이콘"
            className={`tool-button ${props.isIconPanelOpen ? "active" : ""}`}
            disabled={!props.canUseCurrentSlide}
            title={editDisabledTitle ?? "아이콘 추가"}
            type="button"
            onClick={props.onOpenIconLibrary}
          >
            <IconIcons size={17} />
          </button>
          <button
            aria-label="이미지"
            className="tool-button"
            disabled={!props.canUseCurrentSlide || props.isImageUploadPending}
            title={editDisabledTitle ?? "이미지 추가"}
            type="button"
            onClick={props.onOpenImagePicker}
          >
            <ImagePlus size={17} />
          </button>
          <button
            aria-label="애니메이션"
            className={`tool-button ${props.isAnimationPanelOpen || props.selectedElementAnimationCount > 0 ? "active" : ""}`}
            disabled={!props.canUseCurrentSlide}
            title={editDisabledTitle ?? "애니메이션"}
            type="button"
            onClick={props.onOpenAnimation}
          >
            <Sparkles size={17} />
          </button>
        </div>
      </div> : null}
      <EditorZoomControls
        canZoomIn={props.canZoomIn}
        canZoomOut={props.canZoomOut}
        isFitToViewport={props.isStageFitToViewport}
        onFitToViewport={props.onFitStageToViewport}
        onZoomIn={props.onZoomIn}
        onZoomOut={props.onZoomOut}
        onZoomToActualSize={props.onZoomToActualSize}
        scale={props.stageScale}
      />
    </div>
  );
}
