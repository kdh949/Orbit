import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PresentationWorkspace } from "./PresentationWorkspace";

const presentationWorkspaceSourcePath = fileURLToPath(
  new URL("./PresentationWorkspace.tsx", import.meta.url),
);

vi.mock("react-konva", () => {
  const Group = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Stage = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Text = ({ text }: { text?: string }) => <span>{text}</span>;

  return {
    Arrow: () => <span data-konva-arrow="true" />,
    Circle: () => <span data-konva-circle="true" />,
    Group,
    Image: () => <span data-konva-image="true" />,
    Layer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Line: () => <span data-konva-line="true" />,
    Rect: () => <span data-konva-rect="true" />,
    RegularPolygon: () => <span data-konva-polygon="true" />,
    Shape: () => <span data-konva-shape="true" />,
    Star: () => <span data-konva-star="true" />,
    Stage,
    Text,
  };
});

describe("PresentationWorkspace", () => {
  it("renders a presentation shell copied from the rehearsal workspace", () => {
    const html = renderToStaticMarkup(
      <PresentationWorkspace initialDeck={createDemoDeck()} />,
    );

    expect(html).toContain("발표");
    expect(html).toContain("발표 종료");
    expect(html).toContain("다음 슬라이드");
    expect(html).toContain("발표 시간");
    expect(html).toContain("키워드");
    expect(html).toContain("대본");
    expect(html).toContain('aria-label="발표 대본 프롬프터"');
    expect(html).toContain('aria-label="원문 기준 실시간 진행률"');
    expect(html).not.toContain("Live STT");
    expect(html).not.toContain("Report AI");
  });

  it("delegates the presentation view to a dedicated screen component", () => {
    const source = fs.readFileSync(presentationWorkspaceSourcePath, "utf8");

    expect(source).toContain("<PresentationScreen");
    expect(source).not.toContain('<header className="rehearsal-presenter-topbar">');
    expect(source).not.toContain('<section className="rehearsal-presenter-layout">');
  });

  it("keeps the live presentation lifecycle separate from rehearsal persistence", () => {
    const source = fs.readFileSync(presentationWorkspaceSourcePath, "utf8");

    expect(source).toContain("ensurePresenterCompanionSession");
    expect(source).toContain("startPresentationRuntime");
    expect(source).toContain("closePresenterCompanionSession");
    expect(source).toContain("uploadPresentationRecording");
    expect(source).toContain("recordedFileRef.current.size > 0");
    expect(source).toContain('setRuntimePhase("completed")');
    expect(source).toContain("<PresentationCompletionDialog");
    expect(source).toContain('startPresentation("none")');
    expect(source).toContain("runtimeRef.current = null");
    expect(source).toContain('sessionPurpose: "presentation"');
    expect(source).toContain("마이크 없이 시작");
    expect(source).toContain('case "finish":');
    expect(source).toContain("void finishPresentation()");
    expect(source).not.toContain("/rehearsals/runs");
    expect(source).not.toContain("createRehearsalRun");
    expect(source).not.toContain("completeRehearsalAudioUpload");
  });

  it("uses the shared auto-advance controller in live mode only", () => {
    const source = fs.readFileSync(presentationWorkspaceSourcePath, "utf8");

    expect(source).toContain("evaluateAdvanceController");
    expect(source).toContain('mode: "live"');
    expect(source).toContain("live: true");
    expect(source).toContain("rehearsal: false");
  });

  it("resolves exact speaker-note keyword occurrences during live presentation", () => {
    const source = fs.readFileSync(presentationWorkspaceSourcePath, "utf8");

    expect(source).toContain("matchKeywordOccurrenceTriggers");
    expect(source).toContain("resolveKeywordOccurrenceTriggeredActions");
    expect(source).toContain("getKeywordOccurrenceTriggerIdsForSlide");
    expect(source).toContain("resolveManualAnimationPlaybackUpdate");
    expect(source).toContain("applyPlaybackUpdate");
    expect(source).toContain("confirmedOccurrenceIds");
    expect(source).toContain("getSlideTranscriptSpan");
    expect(source).toContain("previousTranscript: transcriptSpan.previousTranscript");
  });

  it("renders the auto-start presenter controls for an Activity slide", () => {
    const deck = createDemoDeck();
    const activitySlide = createActivitySlide(deck, "pre-question");
    const html = renderToStaticMarkup(
      <PresentationWorkspace initialDeck={{ ...deck, slides: [activitySlide] }} />,
    );

    expect(html).toContain('aria-label="참여 장표 운영"');
    expect(html).toContain("응답 열기");
  });
});
