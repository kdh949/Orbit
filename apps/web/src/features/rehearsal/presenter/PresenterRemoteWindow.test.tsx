import { createActivitySlide } from "@orbit/editor-core";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { p0AnimationDeck } from "./__fixtures__/animationDeck";
import {
  applyPresenterRemoteMessage,
  getPresenterRemoteCurrentSentenceIndex,
  getPresenterRemoteCommandDispatchDelays,
  getPresenterRemoteKeywordRows,
  getPresenterRemoteNextSentenceIndex,
  getPresenterRemoteTimingState,
  isPresenterRemoteOwnerStale,
  reconcilePresenterRemoteOutputMode,
  scrollPresenterRemoteScriptRowIntoView,
  splitPresenterRemoteNotes,
  PresenterRemoteWindow,
} from "./PresenterRemoteWindow";
import { createPresenterSlideshowState } from "./presenterStateStore";
import { createPresenterStateMessage } from "./presentationChannel";

vi.mock("./SlideshowRenderer", () => ({
  SlideshowRenderer: (props: { slideId: string }) => (
    <div data-slide-id={props.slideId}>Slide preview</div>
  ),
}));

const identity = {
  deckId: p0AnimationDeck.deckId,
  sessionId: "session-presenter-1",
};

describe("PresenterRemoteWindow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders presenter-only notes and remote controls", () => {
    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={p0AnimationDeck}
        identity={identity}
        initialState={createPresenterSlideshowState(p0AnimationDeck)}
      />,
    );

    expect(html).toContain("발표자 제어");
    expect(html).toContain("대본");
    expect(html).toContain("현재 슬라이드");
    expect(html).toContain("다음 슬라이드");
    expect(html).toContain('class="rehearsal-side-timer-card"');
    expect(html).toContain("발표 스톱워치");
    expect(html).toContain("총 발표 시간");
    expect(html).toContain("현재 슬라이드");
    expect(html).toContain("시작");
    expect(html).toContain('aria-label="스톱워치 초기화"');
    expect(html).toContain('aria-label="발표 진행 패널"');
    expect(html).toContain('aria-label="키워드 체크리스트"');
    expect(html).toContain("rehearsal-panel-top-grid");
    expect(html).not.toContain("음성인식 대기");
    expect(html).not.toContain('<header class="presenter-remote-header"');
    expect(html).not.toContain("슬라이드 목표");
    expect(html).not.toContain("현재 큐");
    expect(html).toContain("첫 문장입니다");
    expect(html).toContain("이전");
    expect(html).toContain("다음");
    expect(html).toContain("애플리케이션 공유하기");
    expect(html).toContain("청중 화면 가리기");
    expect(html).toContain("발표 종료");
    expect(html).not.toContain('class="presenter-remote-topbar"');
    expect(html).not.toContain("presenter-remote-header-action");
    expect(html).toContain("audience-output-controls--collapsible");
    expect(html).not.toContain("Partial transcript");
    expect(html).not.toContain("rawAudio");
  });

  it("renders activity controls beside the keyword progress panel", () => {
    const activitySlide = createActivitySlide(p0AnimationDeck, "pre-question");
    const deck = {
      ...p0AnimationDeck,
      slides: [activitySlide],
    };
    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={deck}
        identity={identity}
        initialState={createPresenterSlideshowState(deck)}
      />,
    );

    expect(html).not.toContain("rehearsal-panel-live-slot");
    expect(html).toMatch(
      /class="rehearsal-panel presenter-remote-progress-panel"[^>]*>[\s\S]*?<\/div><\/section><section class="activity-presenter-panel"/,
    );
  });

  it("마지막 슬라이드에서는 다음 슬라이드 번호 대신 없음을 표시한다", () => {
    const lastSlideIndex = p0AnimationDeck.slides.length - 1;
    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={p0AnimationDeck}
        identity={identity}
        initialState={{
          ...createPresenterSlideshowState(p0AnimationDeck),
          slideId: p0AnimationDeck.slides[lastSlideIndex]!.slideId,
          slideIndex: lastSlideIndex,
        }}
      />,
    );

    expect(html).toContain("<span>다음 슬라이드</span><strong>없음</strong>");
    expect(html).not.toContain("다음 슬라이드 없음");
  });

  it("현재 대본 행을 스크롤 영역 중앙으로 이동한다", () => {
    const scrollTo = vi.fn();

    scrollPresenterRemoteScriptRowIntoView(
      {
        getBoundingClientRect: () => ({ height: 300, top: 100 }),
        scrollTo,
        scrollTop: 200,
      },
      {
        getBoundingClientRect: () => ({ height: 40, top: 430 }),
      },
      "smooth",
    );

    expect(scrollTo).toHaveBeenCalledWith({
      behavior: "smooth",
      top: 400,
    });
  });

  it("발표자 대본을 자동 스크롤 영역으로 표시한다", () => {
    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={p0AnimationDeck}
        identity={identity}
        initialState={createPresenterSlideshowState(p0AnimationDeck)}
      />,
    );

    expect(html).toContain('data-auto-scroll="true"');
  });

  it("splits presenter notes into cue rows", () => {
    expect(
      splitPresenterRemoteNotes("첫 문장입니다. 마지막 문장입니다."),
    ).toEqual(["첫 문장입니다", "마지막 문장입니다"]);
  });

  it("derives keyword cue status from the current slide step", () => {
    const slide = {
      ...p0AnimationDeck.slides[0]!,
      keywords: [
        {
          keywordId: "keyword_one",
          text: "첫 키워드",
          synonyms: [],
          abbreviations: [],
          required: true,
        },
        {
          keywordId: "keyword_two",
          text: "두 번째 키워드",
          synonyms: [],
          abbreviations: [],
          required: true,
        },
      ],
    };

    expect(getPresenterRemoteKeywordRows(slide, 1)).toEqual([
      {
        keywordId: "keyword_one",
        status: "done",
        text: "첫 키워드",
      },
      {
        keywordId: "keyword_two",
        status: "active",
        text: "두 번째 키워드",
      },
    ]);
  });

  it("uses presenter timing snapshots for the remote timer", () => {
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      timing: {
        canStartLiveStt: false,
        currentSlideElapsedSeconds: 25,
        currentSlideTargetSeconds: 60,
        displayedSeconds: 275,
        elapsedSeconds: 25,
        isLiveSttActive: true,
        isRunning: true,
        liveStatus: "listening",
        mode: "timer" as const,
        timerDurationSeconds: 300,
      },
    };
    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={p0AnimationDeck}
        identity={identity}
        initialState={state}
      />,
    );

    expect(
      getPresenterRemoteTimingState(
        p0AnimationDeck,
        p0AnimationDeck.slides[0],
        state,
      ),
    ).toMatchObject({
      displayedSeconds: 275,
      isLiveSttActive: true,
      isRunning: true,
    });
    expect(html).toContain("4:35");
    expect(html).not.toContain("슬라이드 경과");
    expect(html).not.toContain("슬라이드 목표");
    expect(html).not.toContain("현재 큐");
    expect(html).not.toContain("발표 시간 상태");
    expect(html).toContain("총 발표 시간");
    expect(html).toContain("현재 0:25");
    expect(html).toContain('aria-label="리허설 일시정지"');
  });

  it("renders paused remote timer controls as resume", () => {
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      timing: {
        canStartLiveStt: false,
        currentSlideElapsedSeconds: 25,
        currentSlideTargetSeconds: 60,
        displayedSeconds: 275,
        elapsedSeconds: 25,
        isLiveSttActive: false,
        isPaused: true,
        isRunning: false,
        liveStatus: "stopped",
        mode: "timer" as const,
        timerDurationSeconds: 300,
      },
    };
    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={p0AnimationDeck}
        identity={identity}
        initialState={state}
      />,
    );

    expect(html).toContain('aria-label="리허설 다시 시작"');
  });

  it("renders semantic debug panel from owner presenter speech state", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) =>
          key === "orbit.semanticSpeech.debugPanel" ? "1" : null,
      },
    });

    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={p0AnimationDeck}
        identity={identity}
        initialState={{
          ...createPresenterSlideshowState(p0AnimationDeck),
          speech: createPresenterSpeechState(),
        }}
      />,
    );

    expect(html).toContain("Semantic STT");
    expect(html).toContain("방금 final STT 문장");
    expect(html).toContain("#1 · 0.910 · 문장 1");
    expect(html).toContain("적용");
  });

  it("입력 순서와 무관하게 가장 높은 severity 한 개와 추가 개수만 표시한다", () => {
    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={p0AnimationDeck}
        identity={identity}
        initialState={{
          ...createPresenterSlideshowState(p0AnimationDeck),
          speech: {
            ...createPresenterSpeechState(),
            semanticCapabilityItems: [
              {
                key: "semantic_runtime" as const,
                severity: "warning" as const,
                shortLabel: "의미 체크 오프라인",
                detail: "수동 발표는 계속할 수 있습니다.",
                retryable: true,
                affectedCount: 2,
                source: "system-status" as const,
                actionLabel: "재시도" as const,
                recovered: false,
                measurementMode: "none" as const
              },
              {
                key: "nli" as const,
                severity: "error" as const,
                shortLabel: "정밀 판정 비활성",
                detail: "기본 의미 체크로 계속합니다.",
                retryable: true,
                affectedCount: 1,
                source: "system-status" as const,
                recovered: false,
                measurementMode: "basic" as const
              }
            ]
          }
        }}
      />
    );

    expect(html).toContain('aria-label="발표자 시스템 상태"');
    expect(html).toContain("presenter-remote-capability-warning");
    expect(html).toContain('aria-label="음성 체크 알림 닫기"');
    expect(html).toContain("정밀 판정 비활성:</strong>");
    expect(html).toContain("+1");
    expect(html).toContain("기본 의미 체크로 계속합니다.");
    expect(html).not.toContain("의미 체크 오프라인");
    expect(html).not.toContain("AI 코칭");
  });

  it("focuses the next uncovered script sentence from owner speech coverage", () => {
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      stepIndex: 0,
      speech: {
        ...createPresenterSpeechState(),
        coveredSentenceIds: ["sentence_1"],
      },
    };
    const sentences = ["첫 문장입니다", "마지막 문장입니다"];
    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={p0AnimationDeck}
        identity={identity}
        initialState={state}
      />,
    );

    expect(getPresenterRemoteCurrentSentenceIndex(sentences, state)).toBe(1);
    expect(html).toContain("rehearsal-teleprompter-line-covered");
    expect(html).toContain("rehearsal-teleprompter-line-current");
  });

  it("keeps remote current and next cues on committed prompter progress", () => {
    const speech = createPresenterSpeechState();
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      speech: {
        ...speech,
        coveredSentenceIds: ["sentence_1"],
        snapshot: {
          ...speech.snapshot,
          prompterProgress: {
            slideId: "slide_p0_1",
            revision: 1,
            phase: "tracking" as const,
            currentSentenceId: "sentence_1",
            candidateSentenceId: null,
            candidateSinceMs: null,
            hasCurrentLexicalEvidence: true,
            committedSentenceIds: [],
            lastCommittedSentenceId: null,
            lastCommitSource: null,
            finalSentenceCommitted: false,
          },
        },
      },
    };
    const sentences = ["첫 문장입니다", "마지막 문장입니다"];
    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={p0AnimationDeck}
        identity={identity}
        initialState={state}
      />,
    );

    expect(getPresenterRemoteCurrentSentenceIndex(sentences, state)).toBe(0);
    expect(getPresenterRemoteNextSentenceIndex(sentences, state, 0)).toBe(1);
    expect(html).not.toContain("rehearsal-teleprompter-line-covered");
  });

  it("shows a leading display-only cue until lexical evidence reaches tracking", () => {
    const speech = createPresenterSpeechState();
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      speech: {
        ...speech,
        snapshot: {
          ...speech.snapshot,
          prompterProgress: {
            slideId: "slide_p0_1",
            revision: 0,
            phase: "tracking" as const,
            currentSentenceId: "sentence_2",
            candidateSentenceId: null,
            candidateSinceMs: null,
            hasCurrentLexicalEvidence: false,
            committedSentenceIds: [],
            lastCommittedSentenceId: null,
            lastCommitSource: null,
            finalSentenceCommitted: false,
          },
        },
      },
    };
    const sentences = ["안녕하세요", "발표를 시작하겠습니다"];

    expect(getPresenterRemoteCurrentSentenceIndex(sentences, state)).toBe(0);
    expect(getPresenterRemoteNextSentenceIndex(sentences, state, 0)).toBe(1);
  });

  it("keeps the final committed cue current without a next cue", () => {
    const speech = createPresenterSpeechState();
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      speech: {
        ...speech,
        coveredSentenceIds: ["sentence_1", "sentence_2"],
        snapshot: {
          ...speech.snapshot,
          prompterProgress: {
            slideId: "slide_p0_1",
            revision: 2,
            phase: "tracking" as const,
            currentSentenceId: null,
            candidateSentenceId: null,
            candidateSinceMs: null,
            hasCurrentLexicalEvidence: false,
            committedSentenceIds: ["sentence_1", "sentence_2"],
            lastCommittedSentenceId: "sentence_2",
            lastCommitSource: "lexical" as const,
            finalSentenceCommitted: true,
          },
        },
      },
    };
    const sentences = ["첫 문장입니다", "마지막 문장입니다"];

    expect(getPresenterRemoteCurrentSentenceIndex(sentences, state)).toBe(1);
    expect(getPresenterRemoteNextSentenceIndex(sentences, state, 1)).toBe(-1);
  });

  it("marks the next remote script sentence after current", () => {
    const state = createPresenterSlideshowState(p0AnimationDeck);
    const sentences = ["첫 문장입니다", "둘째 문장입니다", "마지막 문장입니다"];

    expect(getPresenterRemoteNextSentenceIndex(sentences, state, 0)).toBe(1);
  });

  it("mirrors semantic paraphrase coverage from owner speech state", () => {
    const state = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      speech: {
        ...createPresenterSpeechState(),
        coveredSentenceIds: ["sentence_1"],
        coveredSentenceMatchKinds: {
          sentence_1: "paraphrased" as const,
        },
      },
    };
    const html = renderToStaticMarkup(
      <PresenterRemoteWindow
        deck={p0AnimationDeck}
        identity={identity}
        initialState={state}
      />,
    );

    expect(html).toContain("rehearsal-teleprompter-line-paraphrased");
  });

  it("retries idempotent remote timer pause commands across transient channel races", () => {
    expect(
      getPresenterRemoteCommandDispatchDelays({ action: "timer-pause" }),
    ).toEqual([0, 150, 500]);
    expect(
      getPresenterRemoteCommandDispatchDelays({ action: "timer-reset" }),
    ).toEqual([0, 150, 500]);
    expect(
      getPresenterRemoteCommandDispatchDelays({ action: "timer-start" }),
    ).toEqual([0]);
  });

  it("marks the owner stale only after the five-second heartbeat window", () => {
    expect(isPresenterRemoteOwnerStale(null, 6001)).toBe(false);
    expect(isPresenterRemoteOwnerStale(1000, 6000)).toBe(false);
    expect(isPresenterRemoteOwnerStale(1000, 6001)).toBe(true);
  });

  it("keeps a local audience output command until the owner acknowledges it", () => {
    const current = {
      ...createPresenterSlideshowState(p0AnimationDeck),
      audienceOutputMode: "screen-share" as const,
    };
    const staleOwnerMessage = createPresenterStateMessage({
      identity,
      sentAt: 100,
      state: {
        ...current,
        audienceOutputMode: "slide",
        slideId: "slide_p0_2",
        slideIndex: 1,
      },
      triggerAnimationIds: [],
    });

    const waiting = reconcilePresenterRemoteOutputMode({
      current,
      message: staleOwnerMessage,
      now: 1500,
      pending: { mode: "screen-share", sentAt: 1000 },
    });
    expect(waiting.state).toMatchObject({
      audienceOutputMode: "screen-share",
      slideId: "slide_p0_2",
      slideIndex: 1,
    });
    expect(waiting.pending?.mode).toBe("screen-share");

    const acknowledged = reconcilePresenterRemoteOutputMode({
      current: waiting.state,
      message: createPresenterStateMessage({
        identity,
        sentAt: 1600,
        state: {
          ...waiting.state,
          audienceOutputMode: "screen-share",
        },
        triggerAnimationIds: [],
      }),
      now: 1600,
      pending: waiting.pending,
    });
    expect(acknowledged.pending).toBeNull();
    expect(acknowledged.state.audienceOutputMode).toBe("screen-share");
  });

  it("applies presenter state messages without replacing presenter-only deck data", () => {
    const initialState = createPresenterSlideshowState(p0AnimationDeck);
    const next = applyPresenterRemoteMessage(
      initialState,
      createPresenterStateMessage({
        identity,
        sentAt: 20,
        state: {
          ...initialState,
          slideId: "slide_p0_2",
          slideIndex: 1,
          stepIndex: 0,
        },
        triggerAnimationIds: [],
      }),
    );

    expect(next).toMatchObject({
      slideId: "slide_p0_2",
      slideIndex: 1,
      stepIndex: 0,
    });
  });
});

function createPresenterSpeechState() {
  return {
    coveredSentenceIds: [],
    coveredSentenceMatchKinds: {},
    matchableSentenceCount: 2,
    semanticDebug: {
      status: "ready" as const,
      slideId: "slide_p0_1",
      transcript: "방금 final STT 문장",
      isFinal: true,
      topMatches: [
        {
          rank: 1,
          sentenceId: "sentence_1",
          sentenceIndex: 0,
          text: "첫 문장입니다",
          similarity: 0.91,
          covered: false,
        },
      ],
      decision: {
        accepted: true,
        acceptedMatch: {
          rank: 1,
          sentenceId: "sentence_1",
          sentenceIndex: 0,
          text: "첫 문장입니다",
          similarity: 0.91,
          covered: false,
        },
        ambiguousMargin: 0.04,
        isFinal: true as const,
        lexicalOverlap: 0.2,
        outcome: "paraphrased" as const,
        reason: "accepted-paraphrase" as const,
        scoreThreshold: 0.89,
        slideId: "slide_p0_1",
        topMatches: [],
        transcript: "방금 final STT 문장",
      },
      error: null,
    },
    semanticMatchingEnabled: true,
    snapshot: {
      slideId: "slide_p0_1",
      coveredSentenceIds: [],
      coveredSentenceMatchKinds: {},
      matchableSentenceCount: 2,
      sentenceCoverage: 0,
      wordCoverage: 0,
      effectiveCoverage: 0,
      finalSentenceSpoken: false,
      hitKeywordIds: [],
      provisionalMissingKeywordIds: [],
    },
  };
}
