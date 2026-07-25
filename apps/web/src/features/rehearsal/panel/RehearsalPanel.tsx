import {
  AlertTriangle,
  Clock3,
  Gauge,
  Timer
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
  type KeywordHighlightKeyword
} from "../../shared/KeywordHighlightedText";

export type RehearsalPanelMode = "rehearsal" | "live";

export type RehearsalPanelKeyword = KeywordHighlightKeyword;

export type RehearsalPanelProps = {
  mode: RehearsalPanelMode;
  timing: RehearsalTimingSnapshot;
  wordsPerMinute: number;
  adviceState: TimingAdviceState;
  keywords: readonly RehearsalPanelKeyword[];
  liveSlot?: ReactNode;
  showAdvicePanel?: boolean;
  showScriptPanel?: boolean;
  sentences: readonly ExtractedSentence[];
  snapshot: SpeechTrackerSnapshot;
};

export function RehearsalPanel(props: RehearsalPanelProps) {
  const hitKeywordIds = new Set(props.snapshot.hitKeywordIds);
  const provisionalMissingKeywordIds = new Set(
    props.snapshot.provisionalMissingKeywordIds
  );
  const coveredSentenceIds = useMemo(
    () => new Set(props.snapshot.coveredSentenceIds),
    [props.snapshot.coveredSentenceIds]
  );
  const sentenceRefs = useRef(new Map<string, HTMLParagraphElement>());
  const [isScriptAutoFollowEnabled, setIsScriptAutoFollowEnabled] = useState(true);
  const focusSentenceId = useMemo(
    () =>
      getRehearsalScriptFocusSentenceId(
        props.sentences,
        props.snapshot.coveredSentenceIds
      ),
    [props.sentences, props.snapshot.coveredSentenceIds]
  );
  const showAdvice = props.mode === "rehearsal" && props.showAdvicePanel !== false;

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

      <div className="rehearsal-panel-top-grid">
        <section className="rehearsal-panel-section" aria-label="키워드 체크리스트">
          <div className="rehearsal-panel-section-heading">
            <span>키워드</span>
            <strong>
              {hitKeywordIds.size}/{props.keywords.length}
            </strong>
          </div>
          {props.keywords.length > 0 ? (
            <ul className="rehearsal-panel-keywords">
              {props.keywords.map((keyword) => {
                const hit = hitKeywordIds.has(keyword.keywordId);
                const provisionalMissing = provisionalMissingKeywordIds.has(
                  keyword.keywordId
                );

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
                    <em>{hit ? "체크" : provisionalMissing ? "미확인" : "대기"}</em>
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
              <strong>{Math.round(props.snapshot.effectiveCoverage * 100)}%</strong>
            </div>
          </div>
          <div
            className="rehearsal-panel-script-body"
            data-auto-scroll={isScriptAutoFollowEnabled ? "true" : "paused"}
            onPointerDown={() => setIsScriptAutoFollowEnabled(false)}
            onWheel={() => setIsScriptAutoFollowEnabled(false)}
          >
            {props.sentences.length > 0 ? (
              props.sentences.map((sentence) => {
                const covered = coveredSentenceIds.has(sentence.sentenceId);
                return (
                  <p
                    className={[
                      "rehearsal-panel-sentence",
                      covered ? "rehearsal-panel-sentence-covered" : "",
                      !sentence.matchable ? "rehearsal-panel-sentence-unmatchable" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-sentence-id={sentence.sentenceId}
                    key={sentence.sentenceId}
                    ref={(node) => {
                      if (node) {
                        sentenceRefs.current.set(sentence.sentenceId, node);
                        return;
                      }

                      sentenceRefs.current.delete(sentence.sentenceId);
                    }}
                  >
                    <span>
                      <KeywordHighlightedText
                        keywords={props.keywords}
                        text={sentence.text}
                      />
                    </span>
                    {covered ? <em>체크됨</em> : null}
                  </p>
                );
              })
            ) : (
              <p className="rehearsal-panel-empty">대본 없음</p>
            )}
          </div>
        </section>
      ) : null}
    </section>
  );
}

export function getRehearsalScriptFocusSentenceId(
  sentences: readonly ExtractedSentence[],
  coveredSentenceIdsInput: ReadonlySet<string> | readonly string[]
) {
  const coveredSentenceIds =
    coveredSentenceIdsInput instanceof Set
      ? coveredSentenceIdsInput
      : new Set(coveredSentenceIdsInput);
  let lastCoveredMatchableIndex = -1;

  sentences.forEach((sentence, index) => {
    if (sentence.matchable && coveredSentenceIds.has(sentence.sentenceId)) {
      lastCoveredMatchableIndex = index;
    }
  });

  const nextMatchableSentence = sentences
    .slice(lastCoveredMatchableIndex + 1)
    .find(
      (sentence) =>
        sentence.matchable && !coveredSentenceIds.has(sentence.sentenceId)
    );

  if (nextMatchableSentence) {
    return nextMatchableSentence.sentenceId;
  }

  if (lastCoveredMatchableIndex >= 0) {
    return sentences[lastCoveredMatchableIndex]?.sentenceId ?? null;
  }

  return (
    sentences.find((sentence) => sentence.matchable)?.sentenceId ??
    sentences[0]?.sentenceId ??
    null
  );
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
