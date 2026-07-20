import { createDemoDeck } from "@orbit/editor-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EditorSlideRehearsalState } from "../hooks/useEditorSlideRehearsal";
import { createEditorSlideRehearsalSpeechTracker } from "../hooks/useEditorSlideRehearsal";
import {
  createEditorSlideRehearsalScriptProgress,
  createManualScriptProgress,
  EditorSlideRehearsalBottomPanel,
  EditorSlideRehearsalLeftPanel,
  EditorSlideRehearsalRightPanel,
  formatRehearsalTime,
  getEditorSlideRehearsalWheelAction
} from "./EditorSlideRehearsal";

const listeningState: EditorSlideRehearsalState = {
  activeSlideId: "slide_1",
  audioLevelPercent: 48,
  elapsedSeconds: 65,
  engineId: "web-speech",
  errorMessage: null,
  finalTranscript: "발표를 시작합니다",
  hitKeywordIds: ["kw_1"],
  interimTranscript: "현재 슬라이드는",
  speechTrackerSnapshot: null,
  status: "listening"
};

describe("EditorSlideRehearsal", () => {
  it("하단에 서버 연습 녹음 상태와 연습 종료 동작을 표시한다", () => {
    const slide = createDemoDeck().slides[0]!;
    const html = renderToStaticMarkup(
      <EditorSlideRehearsalBottomPanel
        elapsedMs={65_000}
        message=""
        onNextSentence={vi.fn(() => null)}
        onPreviousSentence={vi.fn(() => null)}
        onSkipSentence={vi.fn(() => null)}
        onStart={vi.fn()}
        onStop={vi.fn()}
        practiceState="recording"
        slidePracticeEnabled={true}
        slide={slide}
        state={{ ...listeningState, activeSlideId: slide.slideId }}
      />
    );

    expect(html).toContain("음성 인식");
    expect(html).toContain("녹음 중");
    expect(html).toContain("01:05");
    expect(html).toContain('aria-label="슬라이드 연습 종료"');
    expect(html).toContain("연습 종료");
    expect(html).toContain('aria-label="발표 대본 프롬프터"');
    expect(html).toContain("rehearsal-teleprompter-current");
    expect(html).toContain('data-auto-scroll="true"');
    expect(html).toContain('data-wheel-navigation="sentence"');
    expect(html).toContain('aria-label="자동 따라가기 끄기"');
    expect(html).toContain('aria-label="이전 대본 문장"');
    expect(html).toContain('aria-label="다음 대본 문장"');
  });

  it("중지된 연습을 다시 시작하는 동작을 표시한다", () => {
    const slide = createDemoDeck().slides[0]!;
    const html = renderToStaticMarkup(
      <EditorSlideRehearsalBottomPanel
        elapsedMs={65_000}
        message="서버 분석을 완료했습니다."
        onNextSentence={vi.fn(() => null)}
        onPreviousSentence={vi.fn(() => null)}
        onSkipSentence={vi.fn(() => null)}
        onStart={vi.fn()}
        onStop={vi.fn()}
        practiceState="completed"
        slidePracticeEnabled={true}
        slide={slide}
        state={{
          ...listeningState,
          activeSlideId: slide.slideId,
          status: "stopped"
        }}
      />
    );

    expect(html).toContain('aria-label="슬라이드 연습 시작"');
    expect(html).toContain("연습 시작");
  });

  it("서버 분석 중에는 시작 버튼을 잠그고 진행 메시지를 표시한다", () => {
    const slide = createDemoDeck().slides[0]!;
    const html = renderToStaticMarkup(
      <EditorSlideRehearsalBottomPanel
        elapsedMs={12_000}
        message="녹음을 업로드하고 서버에서 분석하고 있습니다."
        onNextSentence={vi.fn(() => null)}
        onPreviousSentence={vi.fn(() => null)}
        onSkipSentence={vi.fn(() => null)}
        onStart={vi.fn()}
        onStop={vi.fn()}
        practiceState="stopping"
        slidePracticeEnabled={true}
        slide={slide}
        state={{ ...listeningState, activeSlideId: slide.slideId }}
      />
    );

    expect(html).toContain("분석 중");
    expect(html).toContain("서버에서 분석하고 있습니다");
    expect(html).toContain('aria-label="슬라이드 연습 시작"');
    expect(html).toContain("disabled");
  });

  it("녹음 업로드 연결 실패를 음성 인식 오류와 구분한다", () => {
    const slide = createDemoDeck().slides[0]!;
    const html = renderToStaticMarkup(
      <EditorSlideRehearsalBottomPanel
        elapsedMs={12_000}
        message="연습 녹음 업로드 서버에 연결하지 못했습니다."
        onNextSentence={vi.fn(() => null)}
        onPreviousSentence={vi.fn(() => null)}
        onSkipSentence={vi.fn(() => null)}
        onStart={vi.fn()}
        onStop={vi.fn()}
        practiceState="error"
        slidePracticeEnabled={true}
        slide={slide}
        state={{ ...listeningState, activeSlideId: slide.slideId }}
      />
    );

    expect(html).toContain("녹음 업로드 실패");
    expect(html).toContain("연습 녹음 업로드 서버에 연결하지 못했습니다.");
    expect(html).not.toContain("Failed to fetch");
  });

  it("기능이 꺼진 환경에서는 시작 버튼과 원인을 함께 표시한다", () => {
    const slide = createDemoDeck().slides[0]!;
    const html = renderToStaticMarkup(
      <EditorSlideRehearsalBottomPanel
        elapsedMs={0}
        message="부분 슬라이드 연습 기능이 현재 환경에서 꺼져 있습니다."
        onNextSentence={vi.fn(() => null)}
        onPreviousSentence={vi.fn(() => null)}
        onSkipSentence={vi.fn(() => null)}
        onStart={vi.fn()}
        onStop={vi.fn()}
        practiceState="idle"
        slidePracticeEnabled={false}
        slide={slide}
        state={{ ...listeningState, activeSlideId: slide.slideId }}
      />
    );

    expect(html).toContain("연습 기능 꺼짐");
    expect(html).toContain("기능이 꺼져 있습니다");
    expect(html).toContain('aria-label="슬라이드 연습 시작"');
    expect(html).toContain("disabled");
  });

  it("자동 모드의 휠 아래는 skip하고 자동 모드를 유지한다", () => {
    expect(getEditorSlideRehearsalWheelAction("auto", "next")).toBe(
      "skip-next"
    );
    expect(getEditorSlideRehearsalWheelAction("auto", "previous")).toBe(
      "auto-previous"
    );
    expect(getEditorSlideRehearsalWheelAction("manual", "next")).toBe(
      "manual-next"
    );
  });

  it("오른쪽 패널에 현재 슬라이드와 체크포인트를 표시한다", () => {
    const slide = createDemoDeck().slides[0]!;
    const html = renderToStaticMarkup(
      <EditorSlideRehearsalRightPanel
        slide={slide}
        state={{
          ...listeningState,
          activeSlideId: slide.slideId,
          hitKeywordIds: slide.keywords[0] ? [slide.keywords[0].keywordId] : []
        }}
      />
    );

    expect(html).not.toContain("CURRENT SLIDE");
    expect(html).not.toContain("현재 슬라이드만 반복해서 연습합니다.");
    expect(html).toContain(slide.title);
    expect(html).toContain("발표 체크포인트");
    expect(html).not.toContain(">필수</small>");
    expect(html).not.toContain("연습 시간");
    expect(html).not.toContain("음성 엔진");
    expect(html).not.toContain("Web Speech");
  });

  it("에디터 왼쪽 패널에 리허설 안내를 표시한다", () => {
    const slide = createDemoDeck().slides[0]!;
    const html = renderToStaticMarkup(
      <EditorSlideRehearsalLeftPanel
        onResizeStart={vi.fn()}
        slide={slide}
        state={{ ...listeningState, activeSlideId: slide.slideId }}
      />
    );

    expect(html).toContain("editor-slide-rehearsal-left-pane");
    expect(html).toContain("슬라이드 리허설");
    expect(html).toContain("발표 체크포인트");
    expect(html).toContain('aria-label="리허설 패널 크기 조정"');
  });

  it("경과 시간을 분:초 형식으로 만든다", () => {
    expect(formatRehearsalTime(0)).toBe("00:00");
    expect(formatRehearsalTime(125)).toBe("02:05");
  });

  it("조각난 음성을 final 경계에서 확정해 다음 대본 문장으로 진행한다", () => {
    const slide = createDemoDeck().slides[0]!;
    slide.speakerNotes =
      "첫 번째 핵심 내용을 차분하게 설명합니다. 두 번째 비교 결과를 이어서 설명합니다.";
    const tracker = createEditorSlideRehearsalSpeechTracker(slide);

    tracker.acceptResult({
      isFinal: false,
      text: "첫 번째 핵심 내용을",
      timestampMs: [0, 400]
    });
    tracker.acceptResult({
      isFinal: false,
      text: "차분하게 설명합니다",
      timestampMs: [400, 800]
    });

    expect(tracker.snapshot().prompterProgress).toMatchObject({
      committedSentenceIds: [],
      currentSentenceId: "sentence_1"
    });

    tracker.acceptResult({
      isFinal: true,
      text: "차분하게 설명합니다",
      timestampMs: [800, 1_000]
    });

    const progress = createEditorSlideRehearsalScriptProgress({
      slide,
      speechTrackerSnapshot: tracker.snapshot()
    });

    expect(progress.progressPercent).toBe(50);
    expect(progress.rows.map((row) => row.status)).toEqual([
      "covered",
      "current"
    ]);
    expect(progress.focusSentenceId).toBe("sentence_2");
  });

  it("수동 이동은 완료 문장 수에 맞춰 대본 상태와 진행률을 만든다", () => {
    const progress = createManualScriptProgress(
      [
        {
          id: "sentence_1",
          isFocusTarget: true,
          status: "current",
          text: "첫 번째 문장"
        },
        {
          id: "sentence_2",
          isFocusTarget: false,
          status: "next",
          text: "두 번째 문장"
        },
        {
          id: "sentence_3",
          isFocusTarget: false,
          status: "pending",
          text: "세 번째 문장"
        }
      ],
      1
    );

    expect(progress.progressPercent).toBe(33);
    expect(progress.focusSentenceId).toBe("sentence_2");
    expect(progress.rows.map((row) => row.status)).toEqual([
      "covered",
      "current",
      "next"
    ]);
  });

  it("수동 이동이 마지막 문장을 지나면 100%로 제한한다", () => {
    const progress = createManualScriptProgress(
      [
        {
          id: "sentence_1",
          isFocusTarget: true,
          status: "current",
          text: "첫 번째 문장"
        },
        {
          id: "sentence_2",
          isFocusTarget: false,
          status: "next",
          text: "두 번째 문장"
        }
      ],
      99
    );

    expect(progress.progressPercent).toBe(100);
    expect(progress.focusSentenceId).toBeNull();
    expect(progress.rows.every((row) => row.status === "covered")).toBe(true);
  });
});
