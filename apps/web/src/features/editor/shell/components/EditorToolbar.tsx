import type { DeckElement } from "@orbit/shared";
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconArrowRight,
  IconBoxMultiple,
  IconBrush as Paintbrush,
  IconChartBar as BarChart3,
  IconBorderStyle2,
  IconChevronDown as ChevronDown,
  IconColorPicker,
  IconFilePlus as FilePlus,
  IconChevronLeft as ChevronLeft,
  IconCrop,
  IconDroplet,
  IconPhotoPlus as ImagePlus,
  IconIcons,
  IconPointer as MousePointer2,
  IconPrinter as Printer,
  IconLayoutDistributeHorizontal,
  IconLayoutDistributeVertical,
  IconLine,
  IconLineDashed,
  IconPercentage,
  IconSearch as Search,
  IconShape as Shapes,
  IconSparkles as Sparkles,
  IconTypography as Type,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import type { InsertTool } from "../editorShellUiStore";
import { ToolbarPopover } from "../../toolbar/ToolbarPopover";
import { EditorCommandScroller } from "./EditorCommandScroller";
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
  isFormatPainterActive: boolean;
  isImageUploadPending: boolean;
  isIconPanelOpen: boolean;
  isPrintPreparing: boolean;
  isShapeMenuOpen: boolean;
  isStageFitToViewport: boolean;
  onAddSlide: () => void;
  onAddText: () => void;
  onChangeSelectedFrame: (patch: { opacity?: number }) => void;
  onChangeSelectedProps: (patch: Record<string, unknown>) => void;
  onDistributeSelectionX: () => void;
  onDistributeSelectionY: () => void;
  onFitStageToViewport: () => void;
  onGroupSelection: () => void;
  onOpenAnimation: () => void;
  onOpenIconLibrary: () => void;
  onOpenImagePicker: () => void;
  onOpenProperties: () => void;
  onPrint: () => void;
  onOpenRightPanel?: () => void;
  onRedo: () => void;
  onSelectTool: () => void;
  onToggleChartMenu: () => void;
  onToggleFormatPainter: () => void;
  onToggleShapeMenu: () => void;
  onUndo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  redoDisabled: boolean;
  selectedElement: DeckElement | null;
  selectedElementAnimationCount: number;
  selectedElementCount: number;
  shapeMenuButtonRef: RefObject<HTMLButtonElement | null>;
  stageScale: number;
  undoDisabled: boolean;
};

export type ChartInsertType = "bar" | "line" | "pie" | "table";

export type EditorToolbarContextKind =
  | "image"
  | "insert"
  | "multi"
  | "other"
  | "shape"
  | "text";

const shapeElementTypes = new Set([
  "rect",
  "ellipse",
  "line",
  "arrow",
  "polygon",
  "star",
  "ring",
  "customShape",
]);

export function resolveEditorToolbarContextKind(
  selectedElement: DeckElement | null,
  selectedElementCount: number,
): EditorToolbarContextKind {
  if (selectedElementCount > 1) return "multi";
  if (!selectedElement) return "insert";
  if (selectedElement.type === "text") return "text";
  if (selectedElement.type === "image" || selectedElement.type === "svg") {
    return "image";
  }
  if (shapeElementTypes.has(selectedElement.type)) return "shape";
  return "other";
}

export function EditorToolbar(props: EditorToolbarProps) {
  const [isCommandSearchOpen, setIsCommandSearchOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const contextKind = resolveEditorToolbarContextKind(
    props.selectedElement,
    props.selectedElementCount,
  );
  const editDisabledTitle = props.canUseCurrentSlide
    ? undefined
    : "특수 장표는 장표 설정에서 관리합니다.";

  return (
    <div aria-label="편집 명령" className="editor-command-bar" role="toolbar">
      <EditorCommandScroller contextKey={contextKind}>
          {props.canMutate ? (
            <div aria-label="공통 편집 명령" className="editor-command-common" role="group">
            <CommandButton disabled={!props.canUseCurrentSlide} label="새 슬라이드" onClick={props.onAddSlide}><FilePlus size={18} /></CommandButton>
            <CommandButton label="명령 검색" onClick={() => setIsCommandSearchOpen(true)}><Search size={18} /></CommandButton>
            <CommandButton disabled={props.undoDisabled} label="실행 취소" onClick={props.onUndo}><IconArrowLeft size={20} stroke={2} /></CommandButton>
            <CommandButton disabled={props.redoDisabled} label="다시 실행" onClick={props.onRedo}><IconArrowRight size={20} stroke={2} /></CommandButton>
            <CommandButton
              active={props.isFormatPainterActive}
              disabled={!props.selectedElement}
              label="서식 복사"
              onClick={props.onToggleFormatPainter}
            ><Paintbrush size={17} /></CommandButton>
            <CommandButton
              disabled={props.isPrintPreparing}
              label={props.isPrintPreparing ? "인쇄 준비 중" : "인쇄"}
              onClick={props.onPrint}
            ><Printer size={17} /></CommandButton>
            <CommandButton active={props.insertTool === "select"} disabled={!props.canUseCurrentSlide} label="선택 도구" onClick={props.onSelectTool}><MousePointer2 size={14} /></CommandButton>
            </div>
          ) : null}
          {props.canMutate ? <div aria-hidden="true" className="toolbar-divider" /> : null}
          <div className="editor-command-context-slot" data-context-kind={contextKind}>
            {props.compactSelectionTrigger}
            {props.canMutate && contextKind === "insert" ? (
              <div aria-label="삽입 명령" className="editor-command-insert" role="group">
            <CommandButton disabled={!props.canUseCurrentSlide} label="텍스트" onClick={props.onAddText}><Type size={17} /></CommandButton>
            <div className="shape-menu-anchor">
              <button aria-expanded={props.isShapeMenuOpen} aria-haspopup="menu" aria-label="도형" className={`tool-button ${props.isShapeMenuOpen || props.insertTool === "customShape" ? "active" : ""}`} disabled={!props.canUseCurrentSlide} ref={props.shapeMenuButtonRef} title={editDisabledTitle ?? "도형 추가"} type="button" onClick={props.onToggleShapeMenu}>
                <Shapes size={17} /><ChevronDown size={12} />
              </button>
            </div>
            <div className="shape-menu-anchor">
              <button aria-expanded={props.isChartMenuOpen} aria-haspopup="menu" aria-label="차트" className={`tool-button ${props.isChartMenuOpen ? "active" : ""}`} disabled={!props.canUseCurrentSlide} ref={props.chartMenuButtonRef} title={editDisabledTitle ?? "차트 또는 표 추가"} type="button" onClick={props.onToggleChartMenu}>
                <BarChart3 size={17} /><ChevronDown size={12} />
              </button>
            </div>
            <CommandButton active={props.isIconPanelOpen} disabled={!props.canUseCurrentSlide} label="아이콘" onClick={props.onOpenIconLibrary}><IconIcons size={17} /></CommandButton>
            <CommandButton disabled={!props.canUseCurrentSlide || props.isImageUploadPending} label="이미지" onClick={props.onOpenImagePicker}><ImagePlus size={17} /></CommandButton>
              </div>
            ) : null}
            {props.canMutate && contextKind !== "insert" ? (
              <ToolbarSelectionContext contextKind={contextKind} {...props} />
            ) : null}
            <div className="editor-command-context" id="editor-command-context" />
            {props.canMutate && contextKind !== "insert" ? (
              <div aria-label="선택 항목 명령" className="editor-command-selection-actions" role="group">
                <CommandButton label="서식 옵션" onClick={props.onOpenProperties}>
                  <IconAdjustmentsHorizontal aria-hidden="true" size={17} />
                </CommandButton>
                <CommandButton active={props.isAnimationPanelOpen || props.selectedElementAnimationCount > 0} disabled={!props.canUseCurrentSlide} label="애니메이션" onClick={props.onOpenAnimation}><Sparkles size={17} /></CommandButton>
              </div>
            ) : null}
          </div>
      </EditorCommandScroller>
      <div className="editor-command-trailing">
        <EditorZoomControls canZoomIn={props.canZoomIn} canZoomOut={props.canZoomOut} isFitToViewport={props.isStageFitToViewport} onFitToViewport={props.onFitStageToViewport} onZoomIn={props.onZoomIn} onZoomOut={props.onZoomOut} scale={props.stageScale} />
        {props.onOpenRightPanel ? (
          <button aria-label="오른쪽 패널 열기" className="open-right-pane-floating-button" title="오른쪽 패널 열기" type="button" onClick={props.onOpenRightPanel}>
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
        ) : null}
      </div>
      {isCommandSearchOpen ? (
        <EditorCommandSearch
          query={commandQuery}
          setQuery={setCommandQuery}
          onClose={() => { setIsCommandSearchOpen(false); setCommandQuery(""); }}
          commands={[
            { label: "새 슬라이드", run: props.onAddSlide },
            { label: "실행 취소", run: props.onUndo },
            { label: "다시 실행", run: props.onRedo },
            { label: "서식 복사", run: props.onToggleFormatPainter },
            { label: "이미지 삽입", run: props.onOpenImagePicker },
            { label: "아이콘 삽입", run: props.onOpenIconLibrary },
            { label: "서식 옵션", run: props.onOpenProperties },
            { label: "애니메이션", run: props.onOpenAnimation },
            { label: "인쇄", run: props.onPrint },
            { label: "화면에 맞춤", run: props.onFitStageToViewport },
          ]}
        />
      ) : null}
    </div>
  );
}

function CommandButton(props: { active?: boolean; children: ReactNode; disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button aria-label={props.label} aria-pressed={props.active} className={`icon-button ${props.active ? "selected-tool" : ""}`} disabled={props.disabled} title={props.label} type="button" onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function ToolbarSelectionContext(props: EditorToolbarProps & { contextKind: EditorToolbarContextKind }) {
  if (props.contextKind === "multi") {
    return (
      <div aria-label="다중 선택 서식" className="selection-context-toolbar" role="group">
        <span className="selection-context-count">{props.selectedElementCount}개 선택</span>
        <CommandButton label="가로 분배" onClick={props.onDistributeSelectionX}>
          <IconLayoutDistributeHorizontal aria-hidden="true" size={17} />
        </CommandButton>
        <CommandButton label="세로 분배" onClick={props.onDistributeSelectionY}>
          <IconLayoutDistributeVertical aria-hidden="true" size={17} />
        </CommandButton>
        <CommandButton label="그룹" onClick={props.onGroupSelection}>
          <IconBoxMultiple aria-hidden="true" size={17} />
        </CommandButton>
      </div>
    );
  }
  const element = props.selectedElement;
  if (!element || props.contextKind === "text" || props.contextKind === "other") return null;
  const isImage = props.contextKind === "image";
  const isShape = props.contextKind === "shape";
  const elementProps = element.props as Record<string, unknown>;
  const fillColor = toToolbarColor(elementProps.fill, "#ffffff");
  const strokeColor = toToolbarColor(elementProps.stroke, "#111827");
  const isDashed = Array.isArray(elementProps.dash) && elementProps.dash.length > 0;
  return (
    <div aria-label={`${isImage ? "이미지" : "도형"} 서식`} className="selection-context-toolbar" role="group">
      {isShape ? <>
        <ToolbarPopover
          buttonClassName="editor-toolbar-color-trigger"
          buttonContent={<><IconDroplet aria-hidden="true" size={17} /><span aria-hidden="true" className="editor-toolbar-color-swatch" style={{ "--toolbar-swatch-color": fillColor } as CSSProperties} /></>}
          contentLabel="채우기 색 선택"
          label="채우기 색"
        >
          <label className="selection-context-popover-field">채우기 색 <input aria-label="채우기 색 선택" type="color" value={fillColor} onChange={(event) => props.onChangeSelectedProps({ fill: event.target.value })} /></label>
        </ToolbarPopover>
        <ToolbarPopover
          buttonClassName="editor-toolbar-color-trigger"
          buttonContent={<><IconColorPicker aria-hidden="true" size={17} /><span aria-hidden="true" className="editor-toolbar-color-swatch" style={{ "--toolbar-swatch-color": strokeColor } as CSSProperties} /></>}
          contentLabel="선 색 선택"
          label="선 색"
        >
          <label className="selection-context-popover-field">선 색 <input aria-label="선 색 선택" type="color" value={strokeColor} onChange={(event) => props.onChangeSelectedProps({ stroke: event.target.value })} /></label>
        </ToolbarPopover>
        <ToolbarPopover
          buttonContent={<IconBorderStyle2 aria-hidden="true" size={17} />}
          contentLabel="선 두께 입력"
          label="선 두께"
        >
          <label className="selection-context-popover-field">선 두께 <input aria-label="선 두께 입력" min={0} type="number" value={Number(elementProps.strokeWidth ?? 0)} onChange={(event) => props.onChangeSelectedProps({ strokeWidth: Number(event.target.value) })} /></label>
        </ToolbarPopover>
        <ToolbarPopover
          buttonContent={isDashed ? <IconLineDashed aria-hidden="true" size={17} /> : <IconLine aria-hidden="true" size={17} />}
          contentLabel="선 종류 선택"
          contentRole="menu"
          label="선 종류"
        >
          {({ close }) => <>
            <button aria-checked={!isDashed} role="menuitemradio" type="button" onClick={() => { props.onChangeSelectedProps({ dash: [] }); close(); }}><IconLine aria-hidden="true" size={17} />실선</button>
            <button aria-checked={isDashed} role="menuitemradio" type="button" onClick={() => { props.onChangeSelectedProps({ dash: [8, 6] }); close(); }}><IconLineDashed aria-hidden="true" size={17} />점선</button>
          </>}
        </ToolbarPopover>
      </> : null}
      {isImage ? (
        <CommandButton label="자르기·교체" onClick={props.onOpenProperties}>
          <IconCrop aria-hidden="true" size={17} />
        </CommandButton>
      ) : null}
      <ToolbarPopover
        buttonContent={<IconPercentage aria-hidden="true" size={17} />}
        contentLabel="불투명도 입력"
        label="불투명도"
      >
        <label className="selection-context-popover-field">불투명도 <input aria-label="불투명도 입력" max={100} min={0} type="number" value={Math.round(element.opacity * 100)} onChange={(event) => props.onChangeSelectedFrame({ opacity: Math.max(0, Math.min(100, Number(event.target.value))) / 100 })} /></label>
      </ToolbarPopover>
    </div>
  );
}

function EditorCommandSearch(props: { commands: Array<{ label: string; run: () => void }>; onClose: () => void; query: string; setQuery: (value: string) => void }) {
  const commands = useMemo(() => props.commands.filter((command) => command.label.includes(props.query.trim())), [props.commands, props.query]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);
  return (
    <div className="editor-command-search-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section aria-label="명령 검색" aria-modal="true" className="editor-command-search" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <input autoFocus aria-label="명령 검색어" placeholder="명령 검색" value={props.query} onChange={(event) => props.setQuery(event.target.value)} />
        <div role="listbox">
          {commands.map((command) => <button key={command.label} role="option" type="button" onClick={() => { command.run(); props.onClose(); }}>{command.label}</button>)}
          {commands.length === 0 ? <p>일치하는 명령이 없습니다.</p> : null}
        </div>
      </section>
    </div>
  );
}

function toToolbarColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
}
