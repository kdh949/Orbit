import type {
  ApplyDesignAgentProposalResponse,
  Deck,
  DesignImageGenerationResult,
  SemanticCue,
  Slide,
  SpeakerNotesSuggestionMode,
} from "@orbit/shared";
import {
  IconAdjustmentsHorizontal as Properties,
  IconChevronRight as ChevronRight,
  IconIcons,
  IconMessageCircle as MessageCircle,
  IconMicrophone,
  IconMovie as Animation,
  IconPlayerPlay as Play,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type {
  Dispatch,
  PointerEvent,
  ReactNode,
  SetStateAction,
} from "react";

import { SourceLedgerPanel } from "../../ai/quality/SourceLedgerPanel";
import { ValidationPanel } from "../../ai/quality/ValidationPanel";
import type {
  EditorValidationPresentationItem,
  EditorValidationTargetView
} from "../../ai/quality/validationPresentation";
import {
  SemanticCueReviewPanel,
  type SemanticCueExtractionUiState,
} from "../../semantic-cues/SemanticCueReviewPanel";
import { AiChatPanel, type AiChatState } from "./AiChatPanel";
import {
  PptxImportQualityPanel,
  type PptxImportState,
} from "./PptxImportQualityPanel";
import { getDesignPanelLabel } from "../utils/slideEditingPolicy";
import {
  getInitialEditorRightPanelMode,
  type EditorRightPanelMode,
} from "../utils/rightPanelMode";

export type AiPanelView = "chat" | "tools" | "semantic-cues";

type EditorRightPanelProps = {
  assistantOpenRequestId: number;
  aiChatState: AiChatState;
  aiPanelView: AiPanelView;
  animationCount: number;
  animationProperties: ReactNode;
  canPlayAnimations: boolean;
  canRepairValidation: boolean;
  currentSlide: Slide | null;
  deck: Deck;
  designProperties: ReactNode;
  editorValidationItems: readonly EditorValidationPresentationItem[];
  iconLibrary: ReactNode;
  isIconPanelOpen: boolean;
  isOpen: boolean;
  isAnimationPropertiesOpen: boolean;
  isPlayingAnimations: boolean;
  onAiChatStateChange: Dispatch<SetStateAction<AiChatState>>;
  onActivePanelModeChange: (mode: EditorRightPanelMode) => void;
  onFocusValidationTarget: (target: EditorValidationTargetView) => void;
  onHighlightElementIds: (elementIds: string[]) => void;
  onExitRehearsal?: () => void;
  onProposalApplied: (response: ApplyDesignAgentProposalResponse) => void;
  onGeneratedImageInsert: (
    result: DesignImageGenerationResult,
    slideId: string
  ) => boolean;
  onPlayAnimations: () => void;
  onSpeakerNotesAssistantRequest: (mode: SpeakerNotesSuggestionMode) => void;
  onResizeStart: (event: PointerEvent<HTMLButtonElement>) => void;
  onSemanticCueChange: (semanticCues: SemanticCue[]) => void;
  onSemanticCueExtract: (force: boolean) => void;
  onRepairValidationTextOverflow?: (elementIds?: string[]) => void;
  projectId: string;
  propertiesOpenRequestId: number;
  pptxImportState: PptxImportState;
  rehearsalPanel?: ReactNode;
  rehearsalTitle?: string;
  selectedElementIds: string[];
  semanticCueExtractionState: SemanticCueExtractionUiState;
  validationRepairableElementIds: readonly string[];
  validationRepairStatus?: string | null;
  setAiPanelView: Dispatch<SetStateAction<AiPanelView>>;
  setIsIconPanelOpen: (open: boolean) => void;
  setIsAnimationPropertiesOpen: (open: boolean) => void;
  setIsOpen: (open: boolean) => void;
};

export function EditorRightPanel(props: EditorRightPanelProps) {
  const hasElementSelection = props.selectedElementIds.length > 0;
  const designPanelLabel = getDesignPanelLabel(props.currentSlide);
  const isSpecialSlide = designPanelLabel === "장표 설정";
  const [activePanelMode, setActivePanelMode] =
    useState<EditorRightPanelMode>(() =>
      getInitialEditorRightPanelMode({
        isAnimationPropertiesOpen: props.isAnimationPropertiesOpen,
        isIconPanelOpen: props.isIconPanelOpen,
      })
    );

  useEffect(() => {
    props.onActivePanelModeChange(activePanelMode);
  }, [activePanelMode, props.onActivePanelModeChange]);

  useEffect(() => {
    if (props.propertiesOpenRequestId <= 0) return;
    setActivePanelMode("properties");
    props.setIsAnimationPropertiesOpen(false);
    props.setIsIconPanelOpen(false);
    props.setIsOpen(true);
  }, [props.propertiesOpenRequestId]);

  useEffect(() => {
    if (props.assistantOpenRequestId <= 0) return;
    setActivePanelMode("assistant");
    props.setIsAnimationPropertiesOpen(false);
    props.setIsIconPanelOpen(false);
    props.setAiPanelView("chat");
    props.setIsOpen(true);
  }, [props.assistantOpenRequestId]);

  useEffect(() => {
    if (props.isAnimationPropertiesOpen) {
      setActivePanelMode("animation");
    }
  }, [props.isAnimationPropertiesOpen]);

  useEffect(() => {
    if (props.isIconPanelOpen) {
      setActivePanelMode("icons");
      props.setIsOpen(true);
    }
  }, [props.isIconPanelOpen]);

  useEffect(() => {
    if (isSpecialSlide) {
      setActivePanelMode("properties");
      props.setIsAnimationPropertiesOpen(false);
    }
  }, [isSpecialSlide, props.currentSlide?.slideId]);

  function closePanel() {
    props.setIsOpen(false);
    if (activePanelMode === "animation") {
      props.setIsAnimationPropertiesOpen(false);
    }
    if (activePanelMode === "icons") {
      props.setIsIconPanelOpen(false);
    }
  }

  function activatePanelMode(mode: EditorRightPanelMode) {
    setActivePanelMode(mode);
    props.setIsOpen(true);
    props.setIsAnimationPropertiesOpen(mode === "animation");
    props.setIsIconPanelOpen(mode === "icons");
    if (mode === "assistant") {
      props.setAiPanelView("chat");
    }
  }

  const activePanelLabel =
    activePanelMode === "properties"
      ? "속성"
      : activePanelMode === "animation"
        ? "애니메이션"
        : activePanelMode === "icons"
          ? "아이콘"
        : "AI 어시스턴트";

  return (
    <aside
      className={`ai-pane ${props.isOpen ? "" : "collapsed"} ${props.rehearsalPanel ? "rehearsal-mode" : ""}`}
      id="editor-selection-inspector-pane"
    >
      {props.isOpen && props.rehearsalPanel ? (
        <>
          <button
            aria-label="오른쪽 패널 크기 조정"
            className="right-pane-resizer"
            type="button"
            onPointerDown={props.onResizeStart}
          />
          <div className="inspector-header editor-slide-rehearsal-header">
            <div className="inspector-title">
              <IconMicrophone aria-hidden="true" size={15} />
              <strong>{props.rehearsalTitle ?? "슬라이드 리허설"}</strong>
            </div>
            <button
              aria-label="슬라이드 리허설 종료"
              className="collapse-right-pane-button"
              title="슬라이드 리허설 종료"
              type="button"
              onClick={props.onExitRehearsal}
            >
              <IconX aria-hidden="true" size={16} />
            </button>
          </div>
          <div className="editor-slide-rehearsal-panel">
            {props.rehearsalPanel}
          </div>
        </>
      ) : null}
      {!props.rehearsalPanel ? (
        <>
          <button
            aria-label="오른쪽 패널 크기 조정"
            className="right-pane-resizer"
            type="button"
            onPointerDown={props.onResizeStart}
          />
          <div
            aria-hidden={!props.isOpen}
            className="editor-right-panel-content"
            id="editor-right-panel-content"
            inert={props.isOpen ? undefined : true}
          >
            <div className="inspector-header">
              <div className="inspector-title">
                {activePanelMode === "properties" ? (
                  <Properties aria-hidden="true" size={15} />
                ) : null}
                {activePanelMode === "animation" ? (
                  <Animation aria-hidden="true" size={15} />
                ) : null}
                {activePanelMode === "assistant" ? (
                  <MessageCircle aria-hidden="true" size={15} />
                ) : null}
                {activePanelMode === "icons" ? (
                  <IconIcons aria-hidden="true" size={15} />
                ) : null}
                <strong>
                  {activePanelMode === "properties" ? "속성" : null}
                  {activePanelMode === "animation" ? "애니메이션" : null}
                  {activePanelMode === "assistant" ? "AI 어시스턴트" : null}
                  {activePanelMode === "icons" ? "아이콘" : null}
                </strong>
              </div>
              <div className="inspector-actions">
                <div
                  aria-label="오른쪽 패널 탭"
                  className="inspector-mode-switch right-panel-mode-switch"
                  role="tablist"
                >
                  <button
                    aria-label="속성 탭"
                    aria-selected={activePanelMode === "properties"}
                    className={
                      activePanelMode === "properties" ? "active" : undefined
                    }
                    role="tab"
                    title="속성"
                    type="button"
                    onClick={() => activatePanelMode("properties")}
                  >
                    <Properties aria-hidden="true" size={15} />
                  </button>
                  <button
                    aria-label="애니메이션 탭"
                    aria-selected={activePanelMode === "animation"}
                    className={
                      activePanelMode === "animation" ? "active" : undefined
                    }
                    role="tab"
                    title="애니메이션"
                    type="button"
                    onClick={() => activatePanelMode("animation")}
                  >
                    <Animation aria-hidden="true" size={15} />
                    {props.animationCount > 0 ? (
                      <span className="inspector-mode-count">
                        {props.animationCount}
                      </span>
                    ) : null}
                  </button>
                  <button
                    aria-label="AI 어시스턴트 탭"
                    aria-selected={activePanelMode === "assistant"}
                    className={
                      activePanelMode === "assistant" ? "active" : undefined
                    }
                    role="tab"
                    title="AI 어시스턴트"
                    type="button"
                    onClick={() => activatePanelMode("assistant")}
                  >
                    <MessageCircle aria-hidden="true" size={15} />
                  </button>
                </div>
                <button
                  aria-label={`${activePanelLabel} 패널 닫기`}
                  className="collapse-right-pane-button"
                  title={`${activePanelLabel} 패널 닫기`}
                  type="button"
                  onClick={closePanel}
                >
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              </div>
            </div>
            <div
              className={`assistant-panel-slot inspector-panel-slot right-panel-${activePanelMode}`}
            >
              {activePanelMode === "animation" ? (
                <div
                  aria-label="애니메이션 속성"
                  className="assistant-panel-view inspector-animation-properties"
                  id="editor-animation-properties"
                  role="tabpanel"
                >
                  <div className="inspector-animation-actions">
                    <span className="redesign-eyebrow">MOTION</span>
                    <button
                      aria-label={
                        props.isPlayingAnimations
                          ? "애니메이션 재생 중"
                          : "애니메이션 미리보기"
                      }
                      className="inspector-icon-action"
                      disabled={
                        !props.canPlayAnimations || props.isPlayingAnimations
                      }
                      title={props.isPlayingAnimations ? "재생 중" : "미리보기"}
                      type="button"
                      onClick={props.onPlayAnimations}
                    >
                      <Play aria-hidden="true" size={15} />
                    </button>
                  </div>
                  {props.animationProperties}
                </div>
              ) : null}
              {activePanelMode === "properties" ? (
                <div
                  aria-label={
                    hasElementSelection
                      ? "선택 요소"
                      : isSpecialSlide
                        ? designPanelLabel
                        : undefined
                  }
                  aria-labelledby={
                    hasElementSelection || isSpecialSlide
                      ? undefined
                      : "editor-design-heading"
                  }
                  className="assistant-panel-view editor-design-panel"
                  id="editor-design-panel"
                  role="tabpanel"
                >
                  {!isSpecialSlide ? (
                    <span className="redesign-eyebrow">
                      {hasElementSelection
                        ? "ELEMENT PROPERTIES"
                        : "GLOBAL STYLES"}
                    </span>
                  ) : null}
                  {!hasElementSelection && !isSpecialSlide ? (
                    <>
                      <h3 id="editor-design-heading">{designPanelLabel}</h3>
                      <p>슬라이드와 덱의 기본 시각 속성을 조정합니다.</p>
                    </>
                  ) : null}
                  {props.designProperties}
                </div>
              ) : null}
              {activePanelMode === "icons" ? (
                <div
                  aria-label="아이콘 패널"
                  className="assistant-panel-view editor-icon-library-panel"
                  id="editor-icon-library-panel"
                  role="tabpanel"
                >
                  {props.iconLibrary}
                </div>
              ) : null}
              {activePanelMode === "assistant" ? (
                <section
                  aria-label="AI 어시스턴트"
                  className="editor-ai-assistant-panel"
                  id="editor-ai-panel"
                  role="tabpanel"
                >
                  <div className="editor-ai-coach-panel">
                    <div
                      aria-label="AI 채팅"
                      className="assistant-panel-subview"
                      hidden={props.aiPanelView !== "chat"}
                      id="editor-ai-chat-panel"
                      role="tabpanel"
                    >
                      <AiChatPanel
                        projectId={props.projectId}
                        deck={props.deck}
                        currentSlide={props.currentSlide}
                        designEditingEnabled={!isSpecialSlide}
                        selectedElementIds={props.selectedElementIds}
                        chatState={props.aiChatState}
                        onChatStateChange={props.onAiChatStateChange}
                        onProposalApplied={props.onProposalApplied}
                        onGeneratedImageInsert={props.onGeneratedImageInsert}
                        onSpeakerNotesAssistantRequest={
                          props.onSpeakerNotesAssistantRequest
                        }
                      />
                    </div>
                    <div
                      aria-label="검사"
                      className="assistant-panel-subview editor-ai-tools-subview"
                      hidden={props.aiPanelView !== "tools"}
                      id="editor-ai-tools-panel"
                      role="tabpanel"
                    >
                      <PptxImportQualityPanel state={props.pptxImportState} />
                      <ValidationPanel
                        canRepair={props.canRepairValidation}
                        items={props.editorValidationItems}
                        onFocusTarget={props.onFocusValidationTarget}
                        onHighlightElementIds={props.onHighlightElementIds}
                        onRepairTextOverflow={
                          props.onRepairValidationTextOverflow
                        }
                        repairableElementIds={
                          props.validationRepairableElementIds
                        }
                        repairStatus={props.validationRepairStatus}
                      />
                      <SourceLedgerPanel slide={props.currentSlide} />
                      <SemanticCueReviewPanel
                        extractionState={props.semanticCueExtractionState}
                        slide={props.currentSlide}
                        onChange={props.onSemanticCueChange}
                        onExtract={props.onSemanticCueExtract}
                      />
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </aside>
  );
}
