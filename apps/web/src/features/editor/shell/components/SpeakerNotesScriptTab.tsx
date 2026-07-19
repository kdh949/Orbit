import type { Keyword, Slide } from "@orbit/shared";
import {
  IconCheck as Check,
  IconWand as Wand,
  IconX as X,
} from "@tabler/icons-react";

import type { getSpeakerNotesLengthGuidance } from "../speakerNotesAssistant";
import type {
  KeywordActionMode,
  KeywordSelectionContext,
  KeywordUsageSummary
} from "./KeywordInspector";
import {
  KeywordHighlightedNotes,
  KeywordList,
} from "./KeywordInspector";
// import { SpeakerNotesLengthMeter } from "./SpeakerNotesAssistantDialog";

export type SpeakerNotesScriptTabProps = {
  currentSlide: Slide | null;
  draft: string;
  guidance: ReturnType<typeof getSpeakerNotesLengthGuidance>;
  isEditing: boolean;
  onCancelEdit: () => void;
  onClearKeyword: () => void;
  onDeleteKeyword: () => void;
  onDraftChange: (draft: string) => void;
  onOpenAssistant: () => void;
  onSaveEdit: () => void;
  onSelectKeyword: (keywordId: string, occurrenceKey?: string | null) => void;
  onSelectKeywordText: (
    value: string,
    start: number
  ) => KeywordSelectionContext | null;
  onSelectKeywordActionMode: (
    mode: KeywordActionMode,
    selection?: KeywordSelectionContext | null
  ) => void;
  onStartEdit: () => void;
  selectedKeyword: Keyword | null;
  selectedKeywordId: string | null;
  selectedKeywordOccurrenceKey: string | null;
  selectedKeywordRequiredActive: boolean;
  selectedKeywordUsage: KeywordUsageSummary | null;
  showIds: boolean;
  usageByKeywordId: Record<string, KeywordUsageSummary>;
};

export function SpeakerNotesScriptTab(props: SpeakerNotesScriptTabProps) {
  const notesPreview = (props.currentSlide?.speakerNotes ?? "").trim();

  return (
    <div
      aria-labelledby="speaker-notes-script-tab"
      id="speaker-notes-script-panel"
      role="tabpanel"
    >
      {props.isEditing ? (
        <div className="script-panel-body">
          <div
            className="script-notes-editor-shell"
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                event.currentTarget.contains(event.relatedTarget as Node)
              ) {
                return;
              }
              props.onSaveEdit();
            }}
          >
            <div className="script-notes-surface-actions">
              <button aria-label="메모 편집 취소" className="script-panel-action" title="취소" type="button" onClick={props.onCancelEdit}>
                <X aria-hidden="true" size={15} />
              </button>
              <button aria-label="메모 저장" className="script-panel-action primary" title="저장" type="button" onClick={props.onSaveEdit}>
                <Check aria-hidden="true" size={15} />
              </button>
            </div>
            <textarea
              aria-label="발표 메모 수정"
              autoFocus
              className="script-notes-editor"
              placeholder={"슬라이드에서 말할 내용을 입력하세요.\n문단을 나누면 발표할 때도 그대로 표시됩니다."}
              value={props.draft}
              onChange={(event) => props.onDraftChange(event.target.value)}
            />
            {/* <SpeakerNotesLengthMeter guidance={props.guidance} /> */}
          </div>
        </div>
      ) : (
        <div className="script-panel-body">
          <div
            aria-label="대본. 더블클릭하거나 Enter 키를 눌러 편집"
            className="script-notes-surface"
            role="group"
            tabIndex={0}
            onDoubleClick={props.onStartEdit}
            onKeyDown={(event) => {
              if (event.currentTarget === event.target && event.key === "Enter") {
                props.onStartEdit();
              }
            }}
          >
            <div className="script-notes-surface-actions">
              <button
                aria-label={notesPreview ? "AI로 메모 다듬기" : "AI 메모 초안 만들기"}
                className="script-panel-action assistant"
                title={notesPreview ? "AI로 다듬기" : "AI 초안 만들기"}
                type="button"
                onClick={props.onOpenAssistant}
              >
                <Wand aria-hidden="true" size={15} />
              </button>
            </div>
            <KeywordHighlightedNotes
              keywords={props.currentSlide?.keywords ?? []}
              notes={props.currentSlide?.speakerNotes ?? ""}
              selectedKeywordId={props.selectedKeywordId}
              selectedKeywordOccurrenceKey={props.selectedKeywordOccurrenceKey}
              showIds={props.showIds}
              slideId={props.currentSlide?.slideId ?? ""}
              usageByKeywordId={props.usageByKeywordId}
              onSelectKeyword={props.onSelectKeyword}
              onSelectKeywordActionMode={props.onSelectKeywordActionMode}
              onSelectKeywordText={props.onSelectKeywordText}
            />
            {/* <SpeakerNotesLengthMeter guidance={props.guidance} /> */}
          </div>
          <section aria-labelledby="speaker-notes-keywords-title" className="script-keyword-section">
            <div className="script-keyword-heading"><strong id="speaker-notes-keywords-title">발표 체크포인트</strong></div>
            <KeywordList
              keywords={props.currentSlide?.keywords ?? []}
              selectedKeywordId={props.selectedKeywordId}
              showIds={props.showIds}
              usageByKeywordId={props.usageByKeywordId}
              onSelectKeyword={props.onSelectKeyword}
            />
          </section>
        </div>
      )}
    </div>
  );
}
