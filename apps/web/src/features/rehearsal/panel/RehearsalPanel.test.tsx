import type { Keyword } from "@orbit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ExtractedSentence, SpeechTrackerSnapshot } from "../speech/speechTrackingEvents";
import type { RehearsalTimingSnapshot, TimingAdviceState } from "./rehearsalTiming";
import {
  RehearsalPanel
} from "./RehearsalPanel";
import { getRehearsalScriptFocusSentenceId } from "./rehearsalScriptPrompter";

describe("RehearsalPanel", () => {
  it("renders rehearsal timers, keyword state, script state, and advice", () => {
    const html = renderPanel({ mode: "rehearsal" });

    expect(html).toContain("04:30");
    expect(html).toContain("00:50 / 00:45");
    expect(html).toContain("OpenAI");
    expect(html).toContain("49%");
    expect(html).toContain("WPM");
  });

  it("marks unmatched keywords as currently unmentioned before slide exit", () => {
    const html = renderPanel({
      snapshot: {
        ...snapshot,
        hitKeywordIds: [],
        provisionalMissingKeywordIds: []
      }
    });

    expect(html).toContain("미언급");
  });

  it("hides rehearsal-only advice in live mode without adding a mode toggle", () => {
    const html = renderPanel({ mode: "live" });

    expect(html).toContain("OpenAI");
    expect(html).not.toContain("WPM");
    expect(html).not.toContain("rehearsal-panel-advice");
  });

  it("does not render transcript text in the default panel DOM", () => {
    const html = renderPanel({
      transcriptText: "This transcript should stay out of the panel DOM."
    });

    expect(html).not.toContain("This transcript should stay out");
    expect(html).not.toContain("transcript");
  });

  it("shows a dismissible one-line reminder for a repeated high-severity cue", () => {
    const html = renderPanel({
      comparisonReminder: {
        key: "run_2:slide_1:cue_1:1",
        label: "고객 가치",
        reason: "두 회차 연속 핵심 의미를 충분히 전달하지 못했습니다.",
        slideId: "slide_1"
      }
    });

    expect(html).toContain("지난 회차 반복");
    expect(html).toContain("고객 가치");
    expect(html).toContain("두 회차 연속 핵심 의미");
    expect(html).toContain("반복 이슈 알림 닫기");
  });

  it("시스템 capability 상태를 패널에 표시하지 않는다", () => {
    const html = renderPanel({
      semanticCapabilityItems: [
        {
          key: "semantic_runtime",
          severity: "error",
          shortLabel: "의미 체크 오프라인",
          detail: "수동 발표는 계속할 수 있습니다.",
          retryable: true,
          affectedCount: 2,
          source: "system-status",
          actionLabel: "재시도",
          recovered: false,
          measurementMode: "none"
        }
      ]
    });

    expect(html).not.toContain("시스템 상태");
    expect(html).not.toContain("의미 체크 오프라인");
    expect(html).not.toContain("AI 코칭");
  });

  it("현재 슬라이드의 승인된 핵심 메시지 전달 상태를 표시한다", () => {
    const html = renderPanel({
      semanticCueItems: [
        {
          cueId: "scue_covered",
          slideId: "slide_1",
          label: "고객 획득 비용의 원인",
          importance: "core",
          status: "covered",
          measurementMode: "basic",
          matchedBy: "lexical"
        },
        {
          cueId: "scue_waiting",
          slideId: "slide_1",
          label: "개선 방안",
          importance: "core",
          status: "waiting",
          measurementMode: "none"
        }
      ]
    });

    expect(html).toContain("핵심 메시지");
    expect(html).toContain("1/2");
    expect(html).toContain("고객 획득 비용의 원인");
    expect(html).toContain("전달됨");
    expect(html).toContain("개선 방안");
    expect(html).toContain("확인 대기");
    expect(html).not.toContain("lexical");
  });

  it("핵심 메시지가 없으면 빈 체크리스트를 렌더링하지 않는다", () => {
    const html = renderPanel({ semanticCueItems: [] });

    expect(html).not.toContain("핵심 메시지");
  });

  it("보조 메시지만 있으면 0/0 핵심 메시지 대신 발표 메시지로 표시한다", () => {
    const html = renderPanel({
      semanticCueItems: [
        {
          cueId: "scue_supporting",
          slideId: "slide_1",
          label: "보조 근거",
          importance: "supporting",
          status: "needs-review",
          measurementMode: "basic"
        }
      ]
    });

    expect(html).toContain("발표 메시지");
    expect(html).toContain("0/1");
    expect(html).toContain("검토 필요");
    expect(html).not.toContain("0/0");
  });

  it("marks the script region as auto-following by default", () => {
    const html = renderPanel();

    expect(html).toContain('data-auto-scroll="true"');
    expect(html).toContain("presenter-script-row--covered");
    expect(html).toContain("presenter-script-row--current");
    expect(html).toContain("presenter-script-row--next");
    expect(html).toContain("체크됨");
  });

  it("does not mark the current sentence checked before the prompter commits", () => {
    const html = renderPanel({
      snapshot: {
        ...snapshot,
        prompterProgress: progress({ currentSentenceId: "sentence_1" })
      }
    });
    const currentRowStart = html.indexOf('aria-current="true"');
    const currentRow = html.slice(
      currentRowStart,
      html.indexOf("</li>", currentRowStart)
    );

    expect(currentRow).toContain("presenter-script-row--current");
    expect(currentRow).toContain("<strong>OpenAI</strong>");
    expect(currentRow).toContain("helps presenters rehearse.");
    expect(currentRow).not.toContain("체크됨");
  });

  it("distinguishes semantic paraphrase coverage in the script rows", () => {
    const html = renderPanel({
      snapshot: {
        ...snapshot,
        coveredSentenceMatchKinds: {
          sentence_1: "paraphrased"
        },
        prompterProgress: progress({ currentSentenceId: "sentence_1" })
      }
    });
    const currentRowStart = html.indexOf('aria-current="true"');
    const currentRow = html.slice(
      currentRowStart,
      html.indexOf("</li>", currentRowStart)
    );

    expect(currentRow).toContain("presenter-script-row--current");
    expect(currentRow).toContain("의미 전달");
  });

  it("highlights direct keywords and aliases inside script sentences", () => {
    const html = renderPanel({
      keywords: [
        {
          keywordId: "kw_ai",
          text: "OpenAI",
          synonyms: ["AI lab"],
          abbreviations: ["OAI"],
          required: true
        }
      ],
      sentences: [
        {
          sentenceId: "sentence_aliases",
          text: "OpenAI, AI lab, and OAI should all be highlighted.",
          index: 0,
          isFinalTrigger: true,
          matchable: true,
          candidates: []
        }
      ]
    });

    expect(html).toContain('<span class="keyword-mark " data-keyword-id="kw_ai">');
    expect(html).toContain("<strong>OpenAI</strong>");
    expect(html).toContain("<strong>AI lab</strong>");
    expect(html).toContain("<strong>OAI</strong>");
    expect(html).not.toContain("<button");
  });

  it("only highlights targeted keyword occurrences inside script sentences", () => {
    const html = renderPanel({
      highlightedKeywordOccurrences: [
        {
          occurrenceId: "kwo_slide_1_kw_keyword_21_28",
          keywordId: "kw_keyword",
          start: 21,
          end: 28
        }
      ],
      keywords: [
        {
          keywordId: "kw_keyword",
          text: "keyword",
          synonyms: [],
          abbreviations: [],
          required: true
        }
      ],
      sentences: [
        {
          sentenceId: "sentence_1",
          text: "keyword first",
          index: 0,
          isFinalTrigger: false,
          matchable: true,
          candidates: []
        },
        {
          sentenceId: "sentence_2",
          text: "final keyword",
          index: 1,
          isFinalTrigger: true,
          matchable: true,
          candidates: []
        }
      ],
      speakerNotes: "keyword first. final keyword."
    });

    expect(html.match(/class="keyword-mark "/g)).toHaveLength(1);
    expect(html).not.toContain("keyword-note-token");
    expect(html.match(/<strong>keyword<\/strong>/g)).toHaveLength(1);
    expect(html).toContain('data-occurrence-id="kwo_slide_1_kw_keyword_21_28"');
  });

  it("selects the prompter progress sentence as the auto-scroll focus", () => {
    expect(
      getRehearsalScriptFocusSentenceId(
        sentences,
        progress({ currentSentenceId: "sentence_3" })
      )
    ).toBe("sentence_3");
    expect(
      getRehearsalScriptFocusSentenceId(
        sentences,
        progress({ currentSentenceId: "sentence_4" })
      )
    ).toBe("sentence_4");
    expect(getRehearsalScriptFocusSentenceId(sentences, undefined)).toBe(
      "sentence_1"
    );
    expect(
      getRehearsalScriptFocusSentenceId(
        sentences,
        progress({
          currentSentenceId: null,
          finalSentenceCommitted: true
        })
      )
    ).toBe("sentence_4");
    expect(getRehearsalScriptFocusSentenceId([], undefined)).toBeNull();
  });

  it("keeps the final committed sentence visually current", () => {
    const html = renderPanel({
      snapshot: {
        ...snapshot,
        coveredSentenceIds: ["sentence_1", "sentence_3", "sentence_4"],
        coveredSentenceMatchKinds: {
          sentence_1: "covered",
          sentence_3: "covered",
          sentence_4: "covered"
        },
        prompterProgress: progress({
          currentSentenceId: null,
          committedSentenceIds: ["sentence_1", "sentence_3", "sentence_4"],
          lastCommittedSentenceId: "sentence_4",
          finalSentenceCommitted: true
        })
      }
    });
    const currentRowStart = html.indexOf('aria-current="true"');
    const currentRow = html.slice(
      currentRowStart,
      html.indexOf("</li>", currentRowStart)
    );

    expect(currentRow).toContain("Final line summarizes the next action.");
    expect(currentRow).toContain("체크됨");
  });
});

function renderPanel(
  overrides: {
    mode?: "rehearsal" | "live";
    transcriptText?: string;
    keywords?: Keyword[];
    highlightedKeywordOccurrences?: Array<{
      occurrenceId: string;
      keywordId: string;
      start: number;
      end: number;
    }>;
    speakerNotes?: string;
    sentences?: ExtractedSentence[];
    snapshot?: SpeechTrackerSnapshot;
    semanticCapabilityItems?: import("./semanticCapabilityStatusModel").SemanticCapabilityStatusItem[];
    semanticCueItems?: import("../speech/p3RehearsalSession").P3SemanticCueProgressItem[];
    comparisonReminder?: import("../rehearsalRunComparisonModel").ComparisonReminder;
  } = {}
) {
  void overrides.transcriptText;

  return renderToStaticMarkup(
    <RehearsalPanel
      mode={overrides.mode ?? "rehearsal"}
      timing={timing}
      wordsPerMinute={140}
      adviceState={adviceState}
      highlightedKeywordOccurrences={overrides.highlightedKeywordOccurrences}
      keywords={overrides.keywords ?? keywords}
      sentences={overrides.sentences ?? sentences}
      speakerNotes={overrides.speakerNotes}
      snapshot={overrides.snapshot ?? snapshot}
      semanticCapabilityItems={overrides.semanticCapabilityItems}
      semanticCueItems={overrides.semanticCueItems}
      comparisonReminder={overrides.comparisonReminder}
    />
  );
}

const timing: RehearsalTimingSnapshot = {
  deckTargetSeconds: 600,
  elapsedSeconds: 330,
  remainingSeconds: 270,
  currentSlideElapsedSeconds: 50,
  currentSlideTargetSeconds: 45,
  currentSlideOvertime: true
};

const adviceState: TimingAdviceState = {
  pace: "too-fast",
  slideOvertime: true
};

const keywords: Keyword[] = [
  {
    keywordId: "kw_ai",
    text: "OpenAI",
    synonyms: [],
    abbreviations: [],
    required: true
  },
  {
    keywordId: "kw_privacy",
    text: "privacy",
    synonyms: [],
    abbreviations: [],
    required: true
  }
];

const sentences: ExtractedSentence[] = [
  {
    sentenceId: "sentence_1",
    text: "OpenAI helps presenters rehearse.",
    index: 0,
    isFinalTrigger: false,
    matchable: true,
    candidates: []
  },
  {
    sentenceId: "sentence_2",
    text: "ok",
    index: 1,
    isFinalTrigger: false,
    matchable: false,
    candidates: []
  },
  {
    sentenceId: "sentence_3",
    text: "privacy is the closing topic.",
    index: 2,
    isFinalTrigger: false,
    matchable: true,
    candidates: []
  },
  {
    sentenceId: "sentence_4",
    text: "Final line summarizes the next action.",
    index: 3,
    isFinalTrigger: true,
    matchable: true,
    candidates: []
  }
];

const snapshot: SpeechTrackerSnapshot = {
  slideId: "slide_1",
  coveredSentenceIds: ["sentence_1"],
  coveredSentenceMatchKinds: {
    sentence_1: "covered"
  },
  matchableSentenceCount: 3,
  sentenceCoverage: 1 / 3,
  wordCoverage: 0.45,
  effectiveCoverage: 0.49,
  finalSentenceSpoken: false,
  hitKeywordIds: ["kw_ai"],
  provisionalMissingKeywordIds: ["kw_privacy"],
  prompterProgress: progress({
    currentSentenceId: "sentence_3",
    committedSentenceIds: ["sentence_1"],
    lastCommittedSentenceId: "sentence_1"
  })
};

function progress(
  overrides: Partial<NonNullable<SpeechTrackerSnapshot["prompterProgress"]>> = {}
): NonNullable<SpeechTrackerSnapshot["prompterProgress"]> {
  return {
    slideId: "slide_1",
    revision: 0,
    phase: "tracking",
    currentSentenceId: "sentence_1",
    candidateSentenceId: null,
    candidateSinceMs: null,
    committedSentenceIds: [],
    lastCommittedSentenceId: null,
    lastCommitSource: null,
    finalSentenceCommitted: false,
    ...overrides
  };
}
