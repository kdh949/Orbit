import type { Deck } from "@orbit/shared";
import {
  IconChevronDown as ChevronDown,
  IconChevronUp as ChevronUp,
  IconGripHorizontal as GripHorizontal,
  IconMaximize as Maximize,
  IconMinimize as Minimize,
} from "@tabler/icons-react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject
} from "react";
import { useEffect, useState } from "react";
import type { AutoSlideQuestionGuideStatus } from "../../practice/useAutoSlideQuestionGuides";

import { SpeakerNotesQnaTab } from "./SpeakerNotesQnaTab";
import { SpeakerNotesReportTab } from "./SpeakerNotesReportTab";
import {
  SpeakerNotesScriptTab,
  type SpeakerNotesScriptTabProps,
} from "./SpeakerNotesScriptTab";

export type SpeakerNotesTab = "script" | "qna" | "report";

const speakerNotesTabs: Array<{ id: SpeakerNotesTab; label: string }> = [
  { id: "script", label: "대본" },
  { id: "qna", label: "QnA" },
  { id: "report", label: "리포트" }
];

export function SpeakerNotesPanel(props: SpeakerNotesScriptTabProps & {
  canGenerateQuestionGuides: boolean;
  contentRef: RefObject<HTMLDivElement | null>;
  deck: Deck;
  flushPendingSaves: () => Promise<void>;
  height: number;
  isExpanded: boolean;
  isMaximized: boolean;
  isResizing: boolean;
  maxHeight: number;
  minHeight: number;
  onTabSelected: (tab: SpeakerNotesTab) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToggleMaximized: () => void;
  onTogglePanel: () => void;
  projectId: string;
  questionGuideAutoStatus: AutoSlideQuestionGuideStatus;
  questionGuideRefreshToken: number;
  reportRefreshToken: number;
  requestedTab: SpeakerNotesTab | null;
}) {
  const [activeTab, setActiveTab] = useState<SpeakerNotesTab>("script");
  const notesPreview = (props.currentSlide?.speakerNotes ?? "").trim();

  useEffect(() => {
    if (props.requestedTab) setActiveTab(props.requestedTab);
  }, [props.requestedTab, props.reportRefreshToken]);

  function selectTab(tab: SpeakerNotesTab) {
    setActiveTab(tab);
    props.onTabSelected(tab);
  }

  return (
    <section
      aria-labelledby="speaker-notes-title"
      className={`script-panel stage-speaker-notes-panel ${
        props.isExpanded ? "expanded" : "collapsed"
      } ${props.isMaximized ? "maximized" : ""
      } ${props.isEditing ? "editing" : ""} ${
        props.isResizing ? "is-resizing" : ""
      }`}
      style={
        {
          "--speaker-notes-panel-height": `${props.height}px`
        } as CSSProperties
      }
    >
      {props.isExpanded ? (
        <button
          aria-disabled={props.isEditing}
          aria-label="발표 메모 높이 조절"
          aria-orientation="horizontal"
          aria-valuemax={props.maxHeight}
          aria-valuemin={props.minHeight}
          aria-valuenow={props.height}
          className="speaker-notes-resize-handle"
          role="separator"
          tabIndex={props.isEditing ? -1 : 0}
          type="button"
          onKeyDown={props.onResizeKeyDown}
          onPointerDown={props.onResizeStart}
        >
          <GripHorizontal aria-hidden="true" size={18} stroke={1.7} />
        </button>
      ) : null}
      <div className="script-panel-header">
        <span className="visually-hidden" id="speaker-notes-title">발표 메모</span>
        {props.isExpanded ? (
          <>
            <div aria-label="발표 준비 자료" className="speaker-notes-tabs" role="tablist">
              {speakerNotesTabs.map((tab) => (
                <button
                  aria-controls={`speaker-notes-${tab.id}-panel`}
                  aria-selected={activeTab === tab.id}
                  className={activeTab === tab.id ? "active" : ""}
                  disabled={props.isEditing && tab.id !== "script"}
                  id={`speaker-notes-${tab.id}-tab`}
                  key={tab.id}
                  role="tab"
                  type="button"
                  onClick={() => selectTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="speaker-notes-header-actions">
              <button
                aria-controls="speaker-notes-content"
                aria-label={
                  props.isMaximized
                    ? "발표 메모 기본 크기로 축소"
                    : "발표 메모를 슬라이드 편집 영역까지 확대"
                }
                aria-pressed={props.isMaximized}
                className="speaker-notes-maximize-button"
                disabled={props.isEditing}
                title={
                  props.isMaximized
                    ? "기본 크기로 축소"
                    : "슬라이드 편집 영역까지 확대"
                }
                type="button"
                onClick={props.onToggleMaximized}
              >
                {props.isMaximized ? (
                  <Minimize aria-hidden="true" size={16} />
                ) : (
                  <Maximize aria-hidden="true" size={16} />
                )}
              </button>
              <button
                aria-controls="speaker-notes-content"
                aria-expanded="true"
                aria-label="발표 메모 접기"
                className="speaker-notes-collapse-button"
                disabled={props.isEditing}
                title="발표 메모 접기"
                type="button"
                onClick={props.onTogglePanel}
              >
                <ChevronDown aria-hidden="true" size={16} />
              </button>
            </div>
          </>
        ) : (
          <button
            aria-controls="speaker-notes-content"
            aria-expanded="false"
            aria-label="발표 메모 펼치기"
            className="script-panel-heading speaker-notes-toggle"
            type="button"
            onClick={props.onTogglePanel}
          >
            <strong className="speaker-notes-collapsed-label">대본</strong>
            <span className="speaker-notes-collapsed-preview">
              {notesPreview || "대본을 추가하려면 클릭하세요."}
            </span>
            <ChevronUp
              aria-hidden="true"
              className="speaker-notes-toggle-chevron"
              size={16}
            />
          </button>
        )}
      </div>
      <div id="speaker-notes-content" hidden={!props.isExpanded} ref={props.contentRef}>
        {activeTab === "script" ? (
          <SpeakerNotesScriptTab {...props} />
        ) : null}
        {activeTab === "qna" ? (
          <SpeakerNotesQnaTab
            canGenerate={props.canGenerateQuestionGuides}
            deck={props.deck}
            flushPendingSaves={props.flushPendingSaves}
            projectId={props.projectId}
            questionGuideAutoStatus={props.questionGuideAutoStatus}
            questionGuideRefreshToken={props.questionGuideRefreshToken}
            slide={props.currentSlide}
          />
        ) : null}
        {activeTab === "report" ? (
          <SpeakerNotesReportTab
            deck={props.deck}
            projectId={props.projectId}
            refreshToken={props.reportRefreshToken}
            slide={props.currentSlide}
          />
        ) : null}
      </div>
    </section>
  );
}
