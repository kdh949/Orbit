import type { DeckElement } from "@orbit/shared";
import {
  IconAlignBoxCenterMiddle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconChartBar,
  IconChevronDown,
  IconCrop,
  IconFocusCentered,
  IconIcons,
  IconLayersIntersect,
  IconPhoto,
  IconPhotoPlus,
  IconPointer,
  IconShape,
  IconSparkles,
  IconTextCaption,
  IconTypography,
} from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import type { InsertTool } from "../editorShellUiStore";
import type { ElementLayerOrderAction } from "../utils/elementLayerOrder";
import { EditorZoomControls } from "./EditorZoomControls";
import "./EditorRibbon.css";

export type EditorRibbonTab =
  | "home"
  | "insert"
  | "design"
  | "animation"
  | "image";

export type EditorRibbonImageAlignment =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom";

type EditorRibbonProps = {
  canZoomIn: boolean;
  canZoomOut: boolean;
  canMutate: boolean;
  canUseCurrentSlide: boolean;
  chartMenuButtonRef: RefObject<HTMLButtonElement | null>;
  compactSelectionTrigger?: ReactNode;
  imageCropDisabledReason?: string | null;
  imageFrameDisabledReason?: string | null;
  imageReplaceDisabledReason?: string | null;
  insertTool: InsertTool;
  isChartMenuOpen: boolean;
  isIconPanelOpen: boolean;
  isImageUploadPending: boolean;
  isShapeMenuOpen: boolean;
  isStageFitToViewport: boolean;
  onAddText: () => void;
  onAlignImage?: (alignment: EditorRibbonImageAlignment) => void;
  onChangeImageLayer?: (action: ElementLayerOrderAction) => void;
  onFitStageToViewport: () => void;
  onOpenAltText?: () => void;
  onOpenAnimationPanel: () => void;
  onOpenIconLibrary: () => void;
  onOpenImagePicker: () => void;
  onOpenRightPanel?: () => void;
  onRedo: () => void;
  onReplaceImage?: () => void;
  onSelectTool: () => void;
  onSetImageFit?: (fit: "contain" | "cover") => void;
  onStartImageCrop: () => void;
  onToggleChartMenu: () => void;
  onToggleShapeMenu: () => void;
  onUndo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  redoDisabled: boolean;
  selectedElementType?: DeckElement["type"] | null;
  selectionKey?: string | null;
  shapeMenuButtonRef: RefObject<HTMLButtonElement | null>;
  stageScale: number;
  undoDisabled: boolean;
};

const generalTabs: Array<{
  id: Exclude<EditorRibbonTab, "image">;
  label: string;
}> = [
  { id: "home", label: "홈" },
  { id: "insert", label: "삽입" },
  { id: "design", label: "디자인" },
  { id: "animation", label: "애니메이션" },
];

export function resolveEditorRibbonTab(args: {
  currentTab: EditorRibbonTab;
  selectedElementType?: DeckElement["type"] | null;
  selectionChanged: boolean;
}): EditorRibbonTab {
  if (!args.selectionChanged) return args.currentTab;
  return args.selectedElementType === "image" ? "image" : "home";
}

export function EditorRibbon(props: EditorRibbonProps) {
  const [activeTab, setActiveTab] = useState<EditorRibbonTab>(() =>
    props.selectedElementType === "image" ? "image" : "home",
  );
  const previousSelectionKeyRef = useRef(props.selectionKey);

  useEffect(() => {
    const selectionChanged =
      previousSelectionKeyRef.current !== props.selectionKey;
    if (!selectionChanged) return;
    previousSelectionKeyRef.current = props.selectionKey;
    setActiveTab((currentTab) =>
      resolveEditorRibbonTab({
        currentTab,
        selectedElementType: props.selectedElementType,
        selectionChanged: true,
      }),
    );
  }, [props.selectedElementType, props.selectionKey]);

  const visibleActiveTab =
    activeTab === "image" && props.selectedElementType !== "image"
      ? "home"
      : activeTab;
  const editDisabledTitle = props.canUseCurrentSlide
    ? undefined
    : "특수 장표는 장표 설정에서 관리합니다.";

  return (
    <div className="stage-top-controls">
      {props.canMutate ? (
        <div aria-label="에디터 리본" className="editor-toolbar editor-ribbon">
          <div
            aria-label="리본 탭"
            className="editor-ribbon-tabs"
            role="tablist"
          >
            {generalTabs.map((tab) => (
              <button
                aria-controls={`editor-ribbon-panel-${tab.id}`}
                aria-selected={visibleActiveTab === tab.id}
                className={visibleActiveTab === tab.id ? "active" : ""}
                id={`editor-ribbon-tab-${tab.id}`}
                key={tab.id}
                role="tab"
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            {props.selectedElementType === "image" ? (
              <button
                aria-controls="editor-ribbon-panel-image"
                aria-selected={visibleActiveTab === "image"}
                className={`contextual ${visibleActiveTab === "image" ? "active" : ""}`}
                id="editor-ribbon-tab-image"
                role="tab"
                type="button"
                onClick={() => setActiveTab("image")}
              >
                이미지
              </button>
            ) : null}
          </div>
          <div
            aria-labelledby={`editor-ribbon-tab-${visibleActiveTab}`}
            className="editor-ribbon-controls"
            id={`editor-ribbon-panel-${visibleActiveTab}`}
            role="tabpanel"
          >
            {props.compactSelectionTrigger}
            {visibleActiveTab === "home" ? (
              <>
                <RibbonButton
                  ariaLabel="실행 취소"
                  disabled={props.undoDisabled}
                  icon={<IconArrowBackUp size={17} />}
                  label="실행 취소"
                  onClick={props.onUndo}
                />
                <RibbonButton
                  ariaLabel="다시 실행"
                  disabled={props.redoDisabled}
                  icon={<IconArrowForwardUp size={17} />}
                  label="다시 실행"
                  onClick={props.onRedo}
                />
                <RibbonSeparator />
                <RibbonButton
                  active={props.insertTool === "select"}
                  ariaLabel="선택 도구"
                  disabled={!props.canUseCurrentSlide}
                  icon={<IconPointer size={17} />}
                  label="선택"
                  onClick={props.onSelectTool}
                  title={editDisabledTitle}
                />
                <RibbonButton
                  ariaLabel="텍스트"
                  disabled={!props.canUseCurrentSlide}
                  icon={<IconTypography size={17} />}
                  label="텍스트"
                  onClick={props.onAddText}
                  title={editDisabledTitle}
                />
              </>
            ) : null}
            {visibleActiveTab === "insert" ? (
              <>
                <RibbonButton
                  ariaLabel="텍스트"
                  disabled={!props.canUseCurrentSlide}
                  icon={<IconTypography size={17} />}
                  label="텍스트"
                  onClick={props.onAddText}
                  title={editDisabledTitle}
                />
                <div className="shape-menu-anchor">
                  <RibbonButton
                    ariaExpanded={props.isShapeMenuOpen}
                    ariaHasPopup="menu"
                    ariaLabel="도형"
                    buttonRef={props.shapeMenuButtonRef}
                    disabled={!props.canUseCurrentSlide}
                    icon={<IconShape size={17} />}
                    label="도형"
                    onClick={props.onToggleShapeMenu}
                    suffix={<IconChevronDown size={12} />}
                  />
                </div>
                <div className="shape-menu-anchor">
                  <RibbonButton
                    ariaExpanded={props.isChartMenuOpen}
                    ariaHasPopup="menu"
                    ariaLabel="차트"
                    buttonRef={props.chartMenuButtonRef}
                    disabled={!props.canUseCurrentSlide}
                    icon={<IconChartBar size={17} />}
                    label="표/차트"
                    onClick={props.onToggleChartMenu}
                    suffix={<IconChevronDown size={12} />}
                  />
                </div>
                <RibbonButton
                  active={props.isIconPanelOpen}
                  ariaLabel="아이콘"
                  disabled={!props.canUseCurrentSlide}
                  icon={<IconIcons size={17} />}
                  label="아이콘"
                  onClick={props.onOpenIconLibrary}
                />
                <RibbonButton
                  ariaLabel="이미지"
                  disabled={
                    !props.canUseCurrentSlide || props.isImageUploadPending
                  }
                  icon={<IconPhotoPlus size={17} />}
                  label="이미지"
                  onClick={props.onOpenImagePicker}
                />
              </>
            ) : null}
            {visibleActiveTab === "design" ? (
              <>
                <RibbonButton
                  ariaLabel="디자인 속성"
                  icon={<IconSparkles size={17} />}
                  label="슬라이드 디자인"
                  onClick={props.onOpenRightPanel}
                />
                <RibbonButton
                  ariaLabel="Designer 열기"
                  icon={<IconFocusCentered size={17} />}
                  label="Designer"
                  onClick={props.onOpenRightPanel}
                />
              </>
            ) : null}
            {visibleActiveTab === "animation" ? (
              <>
                <RibbonButton
                  ariaLabel="애니메이션 미리보기"
                  icon={<IconSparkles size={17} />}
                  label="미리보기"
                  onClick={props.onOpenAnimationPanel}
                />
                <RibbonButton
                  ariaLabel="애니메이션 추가"
                  icon={<IconSparkles size={17} />}
                  label="추가·편집"
                  onClick={props.onOpenAnimationPanel}
                />
              </>
            ) : null}
            {visibleActiveTab === "image" ? (
              <>
                <RibbonButton
                  ariaLabel="이미지 자르기"
                  disabled={Boolean(props.imageCropDisabledReason)}
                  icon={<IconCrop size={17} />}
                  label="자르기"
                  onClick={props.onStartImageCrop}
                  title={props.imageCropDisabledReason ?? undefined}
                />
                <RibbonButton
                  ariaLabel="이미지 바꾸기"
                  disabled={
                    Boolean(props.imageReplaceDisabledReason) ||
                    props.isImageUploadPending
                  }
                  icon={<IconPhotoPlus size={17} />}
                  label="바꾸기"
                  onClick={props.onReplaceImage}
                  title={props.imageReplaceDisabledReason ?? undefined}
                />
                <RibbonButton
                  ariaLabel="이미지 맞춤"
                  icon={<IconPhoto size={17} />}
                  label="맞춤"
                  onClick={() => props.onSetImageFit?.("contain")}
                />
                <RibbonButton
                  ariaLabel="이미지 채우기"
                  icon={<IconPhoto size={17} />}
                  label="채우기"
                  onClick={() => props.onSetImageFit?.("cover")}
                />
                <RibbonSeparator />
                <RibbonButton
                  ariaLabel="이미지 가운데 정렬"
                  disabled={Boolean(props.imageFrameDisabledReason)}
                  icon={<IconAlignBoxCenterMiddle size={17} />}
                  label="정렬"
                  onClick={() => props.onAlignImage?.("centerX")}
                  title={props.imageFrameDisabledReason ?? undefined}
                />
                <RibbonButton
                  ariaLabel="이미지 맨 앞으로"
                  disabled={Boolean(props.imageFrameDisabledReason)}
                  icon={<IconLayersIntersect size={17} />}
                  label="레이어"
                  onClick={() => props.onChangeImageLayer?.("bring-to-front")}
                  title={props.imageFrameDisabledReason ?? undefined}
                />
                <RibbonButton
                  ariaLabel="대체 텍스트"
                  icon={<IconTextCaption size={17} />}
                  label="대체 텍스트"
                  onClick={props.onOpenAltText}
                />
                <RibbonButton
                  ariaLabel="이미지 애니메이션"
                  icon={<IconSparkles size={17} />}
                  label="애니메이션"
                  onClick={props.onOpenAnimationPanel}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      <EditorZoomControls
        canZoomIn={props.canZoomIn}
        canZoomOut={props.canZoomOut}
        isFitToViewport={props.isStageFitToViewport}
        onFitToViewport={props.onFitStageToViewport}
        onZoomIn={props.onZoomIn}
        onZoomOut={props.onZoomOut}
        scale={props.stageScale}
      />
    </div>
  );
}

function RibbonButton(props: {
  active?: boolean;
  ariaExpanded?: boolean;
  ariaHasPopup?: "menu";
  ariaLabel: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  suffix?: ReactNode;
  title?: string;
}) {
  return (
    <button
      aria-expanded={props.ariaExpanded}
      aria-haspopup={props.ariaHasPopup}
      aria-label={props.ariaLabel}
      className={`editor-ribbon-control ${props.active ? "active" : ""}`}
      disabled={props.disabled}
      ref={props.buttonRef}
      title={props.title ?? props.label}
      type="button"
      onClick={props.onClick}
    >
      {props.icon}
      {props.suffix}
    </button>
  );
}

function RibbonSeparator() {
  return <span aria-hidden="true" className="editor-ribbon-separator" />;
}
