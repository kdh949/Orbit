import {
  AlertTriangle,
  Clock3,
  Gauge,
  Timer,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import type {
  ExtractedSentence,
  SpeechTrackerSnapshot
} from "../speech/speechTrackingEvents";
import type {
  RehearsalTimingSnapshot,
  TimingAdviceState,
  TimingPaceState
} from "./rehearsalTiming";
import {
  KeywordHighlightedText,
  type KeywordHighlightOccurrence,
  type KeywordHighlightKeyword
} from "../../shared/KeywordHighlightedText";
import { PresenterScriptList, type PresenterScriptListRow } from "../presenter/PresenterScriptList";
import {
  createRehearsalScriptPrompterRows,
  getRehearsalScriptFocusSentenceId
} from "./rehearsalScriptPrompter";
import { SemanticCapabilityStatus } from "./SemanticCapabilityStatus";
import type { SemanticCapabilityStatusItem } from "./semanticCapabilityStatusModel";
import type { ComparisonReminder } from "../rehearsalRunComparisonModel";
import type { P3SemanticCueProgressItem } from "../speech/p3RehearsalSession";
import { SemanticCueChecklist } from "./SemanticCueChecklist";

export type RehearsalPanelMode = "rehearsal" | "live";

export type RehearsalPanelKeyword = KeywordHighlightKeyword;

export type RehearsalPanelProps = {
  mode: RehearsalPanelMode;
  timing: RehearsalTimingSnapshot;
  wordsPerMinute: number;
  adviceState: TimingAdviceState;
  keywords: readonly RehearsalPanelKeyword[];
  highlightedKeywordOccurrences?: readonly KeywordHighlightOccurrence[];
  liveSlot?: ReactNode;
  showAdvicePanel?: boolean;
  showScriptPanel?: boolean;
  scriptAutoFollowKey?: number | string;
  speakerNotes?: string;
  sentences: readonly ExtractedSentence[];
  snapshot: SpeechTrackerSnapshot;
  semanticCapabilityItems?: readonly SemanticCapabilityStatusItem[];
  semanticCueItems?: readonly P3SemanticCueProgressItem[];
  onSemanticCapabilityAction?: (item: SemanticCapabilityStatusItem) => void;
  comparisonReminder?: ComparisonReminder | null;
  onDismissComparisonReminder?: () => void;
};

export type RehearsalPanelTopGridProps = {
  hitKeywordIds: ReadonlySet<string>;
  keywords: readonly RehearsalPanelKeyword[];
  liveSlot?: ReactNode;
  provisionalMissingKeywordIds: ReadonlySet<string>;
};

export function RehearsalPanelTopGrid(
  props: RehearsalPanelTopGridProps
) {
  return (
    <div className="rehearsal-panel-top-grid">
      <section className="rehearsal-panel-section" aria-label="키워드 체크리스트">
        <div className="rehearsal-panel-section-heading">
          <span>키워드</span>
          <strong>
            {props.hitKeywordIds.size}/{props.keywords.length}
          </strong>
        </div>
        {props.keywords.length > 0 ? (
          <ul className="rehearsal-panel-keywords">
            {props.keywords.map((keyword) => {
              const hit = props.hitKeywordIds.has(keyword.keywordId);
              const provisionalMissing =
                props.provisionalMissingKeywordIds.has(keyword.keywordId);

              return (
                <li
                  className={[
                    "rehearsal-panel-keyword",
                    hit ? "rehearsal-panel-keyword-hit" : "",
                    provisionalMissing ? "rehearsal-panel-keyword-missing" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={keyword.keywordId}
                >
                  <em>
                    {hit ? "체크" : provisionalMissing ? "미확인" : "미언급"}
                  </em>
                  <span>{keyword.text}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rehearsal-panel-empty">키워드 없음</p>
        )}
      </section>
      {props.liveSlot ? (
        <div className="rehearsal-panel-live-slot">{props.liveSlot}</div>
      ) : null}
    </div>
  );
}

export function RehearsalPanel(props: RehearsalPanelProps) {
  const hitKeywordIds = new Set(props.snapshot.hitKeywordIds);
  const provisionalMissingKeywordIds = new Set(
    props.snapshot.provisionalMissingKeywordIds
  );
  const coveredSentenceIds = useMemo(
    () => new Set(props.snapshot.coveredSentenceIds),
    [props.snapshot.coveredSentenceIds]
  );
  const sentenceTextOffsets = useMemo(
    () => getSentenceTextOffsets(props.speakerNotes ?? "", props.sentences),
    [props.speakerNotes, props.sentences]
  );
  const sentenceRefs = useRef(new Map<string, HTMLLIElement>());
  const [isScriptAutoFollowEnabled, setIsScriptAutoFollowEnabled] = useState(true);
  const focusSentenceId = useMemo(
    () =>
      getRehearsalScriptFocusSentenceId(
        props.sentences,
        props.snapshot.prompterProgress
      ),
    [props.sentences, props.snapshot.prompterProgress]
  );
  const prompterRows = useMemo(
    () =>
      createRehearsalScriptPrompterRows({
        sentences: props.sentences,
        coveredSentenceIds,
        coveredSentenceMatchKinds: props.snapshot.coveredSentenceMatchKinds,
        prompterProgress: props.snapshot.prompterProgress
      }),
    [
      coveredSentenceIds,
      props.sentences,
      props.snapshot.coveredSentenceMatchKinds,
      props.snapshot.prompterProgress
    ]
  );
  const showAdvice = props.mode === "rehearsal" && props.showAdvicePanel !== false;
  const semanticCoveragePercent = Math.round(
    props.snapshot.effectiveCoverage * 100
  );
  const scriptProgressPercent = Math.round(
    (props.snapshot.scriptProgress?.ratio ?? 0) * 100
  );

  const scrollScriptToFocus = useCallback(
    (behavior: ScrollBehavior) => {
      if (!focusSentenceId) {
        return;
      }

      sentenceRefs.current.get(focusSentenceId)?.scrollIntoView({
        block: "nearest",
        behavior
      });
    },
    [focusSentenceId]
  );

  useEffect(() => {
    setIsScriptAutoFollowEnabled(true);
  }, [props.snapshot.slideId]);

  useEffect(() => {
    if (!isScriptAutoFollowEnabled) {
      return;
    }

    scrollScriptToFocus("smooth");
  }, [
    isScriptAutoFollowEnabled,
    props.snapshot.coveredSentenceIds,
    props.snapshot.slideId,
    props.scriptAutoFollowKey,
    scrollScriptToFocus
  ]);

  return (
    <section className="rehearsal-panel" aria-label="발표 진행 패널">
      <div className="rehearsal-panel-timers">
        <TimerMetric
          icon={<Timer aria-hidden="true" size={16} />}
          label="남은 시간"
          value={formatDuration(props.timing.remainingSeconds)}
          tone={props.timing.remainingSeconds < 0 ? "warning" : "normal"}
        />
        <TimerMetric
          icon={<Clock3 aria-hidden="true" size={16} />}
          label="현재 슬라이드"
          value={`${formatDuration(props.timing.currentSlideElapsedSeconds)} / ${formatDuration(
            props.timing.currentSlideTargetSeconds
          )}`}
          tone={props.timing.currentSlideOvertime ? "warning" : "normal"}
        />
      </div>

      <SemanticCapabilityStatus
        items={props.semanticCapabilityItems ?? []}
        onAction={props.onSemanticCapabilityAction}
      />

      {props.comparisonReminder ? (
        <section
          className="rehearsal-comparison-reminder"
          aria-label="지난 회차 반복 이슈"
          role="status"
        >
          <AlertTriangle size={16} aria-hidden="true" />
          <strong>지난 회차 반복</strong>
          <span>
            {props.comparisonReminder.label}: {props.comparisonReminder.reason}
          </span>
          <button
            type="button"
            aria-label="반복 이슈 알림 닫기"
            onClick={props.onDismissComparisonReminder}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </section>
      ) : null}

      <SemanticCueChecklist items={props.semanticCueItems ?? []} />

      <RehearsalPanelTopGrid
        hitKeywordIds={hitKeywordIds}
        keywords={props.keywords}
        liveSlot={props.liveSlot}
        provisionalMissingKeywordIds={provisionalMissingKeywordIds}
      />

      {showAdvice ? (
        <section className="rehearsal-panel-section" aria-label="실시간 조언">
          <div className="rehearsal-panel-section-heading">
            <span>조언</span>
            <strong>{props.wordsPerMinute} WPM</strong>
          </div>
          <div className="rehearsal-panel-advice">
            <AdviceBadge
              icon={<Gauge aria-hidden="true" size={16} />}
              label="말 속도"
              value={getPaceLabel(props.adviceState.pace)}
              active={props.adviceState.pace !== "normal"}
            />
            <AdviceBadge
              icon={<AlertTriangle aria-hidden="true" size={16} />}
              label="슬라이드 시간 초과"
              value={props.adviceState.slideOvertime ? "초과" : "정상"}
              active={props.adviceState.slideOvertime}
            />
          </div>
        </section>
      ) : null}

      {props.showScriptPanel !== false ? (
        <section className="rehearsal-panel-section rehearsal-panel-script" aria-label="발표 대본">
          <div className="rehearsal-panel-section-heading">
            <span>대본</span>
            <div className="rehearsal-panel-heading-actions">
              {!isScriptAutoFollowEnabled ? (
                <button
                  className="rehearsal-panel-follow-button"
                  type="button"
                  onClick={() => {
                    setIsScriptAutoFollowEnabled(true);
                    scrollScriptToFocus("smooth");
                  }}
                >
                  따라가기
                </button>
              ) : null}
              <strong title="의미 커버리지와 원문 기준 실시간 진행률">
                의미 {semanticCoveragePercent}% · 원문 {scriptProgressPercent}%
              </strong>
            </div>
          </div>
          <div
            className="rehearsal-panel-script-body"
            data-auto-scroll={isScriptAutoFollowEnabled ? "true" : "paused"}
            onPointerDown={() => setIsScriptAutoFollowEnabled(false)}
            onWheel={() => setIsScriptAutoFollowEnabled(false)}
          >
            <PresenterScriptList
              emptyLabel="대본 없음"
              getRowRef={(row) => (node) => {
                if (node) {
                  sentenceRefs.current.set(row.id, node);
                  return;
                }

                sentenceRefs.current.delete(row.id);
              }}
              rows={prompterRows.map((row): PresenterScriptListRow => {
                const { sentence } = row;
                return {
                  content: (
                    <KeywordHighlightedText
                      highlightedOccurrences={props.highlightedKeywordOccurrences}
                      keywords={props.keywords}
                      textOffset={sentenceTextOffsets.get(sentence.sentenceId) ?? 0}
                      text={sentence.text}
                    />
                  ),
                  id: sentence.sentenceId,
                  label:
                    row.isCommitted
                      ? "체크됨"
                      : row.coverageStatus === "paraphrased"
                      ? "의미 전달"
                      : undefined,
                  status: row.status
                };
              })}
            />
          </div>
        </section>
      ) : null}
    </section>
  );
}

export function getSentenceTextOffsets(
  speakerNotes: string,
  sentences: readonly ExtractedSentence[]
) {
  const offsets = new Map<string, number>();
  let cursor = 0;

  for (const sentence of sentences) {
    const start = speakerNotes.indexOf(sentence.text, cursor);

    if (start === -1) {
      continue;
    }

    offsets.set(sentence.sentenceId, start);
    cursor = start + sentence.text.length;
  }

  return offsets;
}

function TimerMetric(props: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "normal" | "warning";
}) {
  return (
    <div
      className={[
        "rehearsal-panel-timer",
        props.tone === "warning" ? "rehearsal-panel-timer-warning" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {props.icon}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function AdviceBadge(props: {
  icon: ReactNode;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div
      className={[
        "rehearsal-panel-advice-badge",
        props.active ? "rehearsal-panel-advice-active" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {props.icon}
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function getPaceLabel(pace: TimingPaceState) {
  switch (pace) {
    case "too-fast":
      return "빠름";
    case "too-slow":
      return "느림";
    case "normal":
      return "적정";
  }
}

function formatDuration(totalSeconds: number) {
  const sign = totalSeconds < 0 ? "-" : "";
  const absoluteSeconds = Math.abs(totalSeconds);
  const minutes = Math.floor(absoluteSeconds / 60);
  const seconds = absoluteSeconds % 60;

  return `${sign}${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}
