import { describe, expect, it } from "vitest";
import type { Slide } from "../deck/deck.schema";

import {
  autoCreateSlideQuestionGuidesRequestSchema,
  autoCreateSlideQuestionGuidesResponseSchema,
  slideQuestionGuideDeckContextSlideSchema,
  slideQuestionGuideJobPayloadSchema,
  slideQuestionGuideJobResultSchema,
  slideQuestionGuideSchema,
  slideQuestionGuideSourceSnapshotSchema,
  slideQuestionGuideTextHashInput,
} from "./slide-question-guide.schema";

describe("slide question guide privacy contract", () => {
  it("validates the auto batch contract and bounded per-slide failures", () => {
    expect(autoCreateSlideQuestionGuidesRequestSchema.safeParse({
      clientRequestId: "auto-request-1",
      deckId: "deck-1",
      expectedDeckVersion: 3,
      questionCount: 3,
    }).success).toBe(true);
    expect(autoCreateSlideQuestionGuidesResponseSchema.safeParse({
      deckId: "deck-1",
      deckVersion: 3,
      slides: [
        {
          status: "accepted",
          slideId: "slide-1",
          guideId: "guide-1",
          job: {
            jobId: "job-1",
            projectId: "project-1",
            type: "slide-question-guide-generation",
            status: "queued",
            progress: 0,
            message: "queued",
            result: null,
            error: null,
            createdAt: "2026-07-19T00:00:00.000Z",
            updatedAt: "2026-07-19T00:00:00.000Z",
          },
        },
        { status: "failed", slideId: "slide-2", errorCode: "ENQUEUE_FAILED" },
      ],
    }).success).toBe(true);
  });

  it("accepts frozen and legacy source snapshots", () => {
    const legacy = {
      slideId: "slide-1",
      deckVersion: 3,
      contentHash: "a".repeat(64),
      title: "시장 진입 전략",
      content: "교육 시장을 우선 검증합니다.",
    };
    expect(slideQuestionGuideSourceSnapshotSchema.safeParse(legacy).success).toBe(true);
    expect(slideQuestionGuideSourceSnapshotSchema.safeParse({
      ...legacy,
      deckSnapshotId: "snapshot_1",
      contentHashVersion: "slide-text-v1",
    }).success).toBe(true);
  });

  it("keeps visual-only edits fresh and invalidates text edits", () => {
    const slide = {
      title: "시장 진입 전략",
      speakerNotes: "교육 시장을 우선 검증합니다.",
      style: { backgroundColor: "#ffffff" },
      elements: [{ props: { text: "첫 고객군", color: "#111111" } }],
    } as Slide;
    const visualEdit = {
      ...slide,
      style: { backgroundColor: "#000000" },
      elements: [{ props: { text: "첫 고객군", color: "#ffffff" } }],
    } as Slide;
    const textEdit = { ...slide, title: "수정된 시장 진입 전략" } as Slide;

    expect(slideQuestionGuideTextHashInput(visualEdit)).toEqual(
      slideQuestionGuideTextHashInput(slide),
    );
    expect(slideQuestionGuideTextHashInput(textEdit)).not.toEqual(
      slideQuestionGuideTextHashInput(slide),
    );
  });

  it("keeps job payload and result identifier-only", () => {
    expect(slideQuestionGuideJobPayloadSchema.safeParse({
      jobId: "job-1",
      projectId: "project-1",
      guideId: "guide-1",
      questionText: "Job에 들어가면 안 되는 질문",
    }).success).toBe(false);

    expect(slideQuestionGuideJobResultSchema.safeParse({
      guideId: "guide-1",
      projectId: "project-1",
      deckId: "deck-1",
      deckVersion: 1,
      slideId: "slide-1",
      itemCount: 3,
      generatedAt: "2026-07-17T00:00:00.000Z",
      suggestedAnswer: "Job에 들어가면 안 되는 답변",
    }).success).toBe(false);
  });

  it("bounds transient full-deck context without widening the Job contract", () => {
    expect(slideQuestionGuideDeckContextSlideSchema.safeParse({
      slideId: "slide-1",
      order: 1,
      deckVersion: 3,
      contentHash: "a".repeat(64),
      title: "시장 진입 전략",
      content: "교육 시장을 우선 검증합니다.",
      speakerNotes: "첫 고객군과 검증 순서를 설명합니다.",
    }).success).toBe(true);

    expect(slideQuestionGuideDeckContextSlideSchema.safeParse({
      slideId: "slide-1",
      order: 1,
      deckVersion: 3,
      contentHash: "a".repeat(64),
      title: "시장 진입 전략",
      content: "교육 시장을 우선 검증합니다.",
      speakerNotes: "x".repeat(6_001),
    }).success).toBe(false);
  });

  it("requires exactly three canonical questions", () => {
    expect(slideQuestionGuideSchema.safeParse({
      schemaVersion: 1,
      guideId: "guide-1",
      projectId: "project-1",
      deckId: "deck-1",
      deckVersion: 1,
      slideId: "slide-1",
      slideContentHash: "a".repeat(64),
      items: [],
      generatedAt: "2026-07-17T00:00:00.000Z",
      promptVersion: "slide-question-guide-v1",
      model: "fixture",
    }).success).toBe(false);
  });

  it("supports legacy v1 guides and v2 official web citations without widening Jobs", () => {
    const webRef = {
      kind: "web",
      sourceId: "web:official-1",
      url: "https://example.edu/program",
      title: "공식 교육과정 안내",
      authority: "official",
      contentHash: "b".repeat(64),
      retrievedAt: "2026-07-17T00:00:00.000Z",
    };
    const item = {
      questionId: "question-1",
      questionType: "evidence",
      questionText: "공식 교육과정의 핵심 특징은 무엇인가요?",
      supportState: "grounded",
      keyConcepts: [{ label: "교육과정", sourceRefs: [webRef] }],
      suggestedAnswer: {
        summary: "공식 안내에서 확인된 범위만 답변합니다.",
        structure: ["핵심 특징", "적용 범위"],
        caveats: [],
      },
      remediation: null,
      sourceRefs: [webRef],
    };
    const base = {
      guideId: "guide-1",
      projectId: "project-1",
      deckId: "deck-1",
      deckVersion: 1,
      slideId: "slide-1",
      slideContentHash: "a".repeat(64),
      generatedAt: "2026-07-17T00:00:00.000Z",
      promptVersion: "slide-question-guide-v2",
      model: "fixture",
    };

    expect(slideQuestionGuideSchema.safeParse({
      schemaVersion: 2,
      ...base,
      research: {
        status: "succeeded",
        attempts: 1,
        officialSourceCount: 1,
        issueCodes: [],
        researchedAt: "2026-07-17T00:00:00.000Z",
      },
      items: [item, { ...item, questionId: "question-2" }, { ...item, questionId: "question-3" }],
    }).success).toBe(true);

    expect(slideQuestionGuideSchema.safeParse({
      schemaVersion: 1,
      ...base,
      items: [item, { ...item, questionId: "question-2" }, { ...item, questionId: "question-3" }],
    }).success).toBe(false);
  });
});
