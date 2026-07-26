import { deckSchema, type Deck } from "@orbit/shared/deck";
import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";
import { projectActivityDeckForStaticExport } from "./activity-export-projection";

describe("projectActivityDeckForStaticExport", () => {
  it("replaces live Activity UI with static copy and a session-selection placeholder", async () => {
    const deck = activityDeck();
    const original = structuredClone(deck);
    const query = vi.fn();

    const projected = await projectActivityDeckForStaticExport(
      { query } as unknown as DataSource,
      deck.projectId,
      deck,
    );

    expect(JSON.stringify(projected)).toContain(
      "실시간 참여는 발표 중 제공됩니다.",
    );
    expect(JSON.stringify(projected)).toContain(
      "발표 세션을 선택하면 결과를 포함할 수 있습니다",
    );
    expect(JSON.stringify(projected)).not.toMatch(
      /qr|joinCode|speaker secret/i,
    );
    expect(projected.slides.every((slide) => slide.kind === "content")).toBe(
      true,
    );
    expect(projected.slides.every((slide) => slide.speakerNotes === "")).toBe(
      true,
    );
    expect(deck).toEqual(original);
    expect(query).not.toHaveBeenCalled();
  });

  it("replaces a dynamic activity reference on a content slide for static export", async () => {
    const deck = activityDeck();
    deck.slides.unshift({
      kind: "content",
      slideId: "slide_closing_1",
      order: 1,
      title: "마무리",
      thumbnailUrl: "",
      style: {},
      speakerNotes: "",
      elements: [{
        elementId: "el_activity_reference",
        type: "activity-qr",
        role: "media",
        x: 700,
        y: 300,
        width: 320,
        height: 320,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        visible: true,
        props: { activityId: "activity_1" },
      }],
      keywords: [],
      semanticCues: [],
      animations: [],
      actions: [],
    });

    const projected = await projectActivityDeckForStaticExport(
      { query: vi.fn() } as unknown as DataSource,
      deck.projectId,
      deck,
    );
    const closingSlide = projected.slides.find(
      (slide) => slide.slideId === "slide_closing_1",
    );

    expect(closingSlide?.elements[0]).toMatchObject({
      type: "text",
      props: { text: "참여 QR 코드는 라이브 발표에서 표시됩니다." },
    });
    expect(JSON.stringify(projected)).not.toContain('"activity-qr"');
  });

  it("preserves an editable activity design while replacing every runtime element", async () => {
    const deck = activityDeck();
    const activitySlide = deck.slides.find(
      (slide) => slide.kind === "activity",
    );
    if (!activitySlide || activitySlide.kind !== "activity") {
      throw new Error("activity fixture");
    }
    activitySlide.activityAppearance = { mode: "editable" };
    activitySlide.elements = [
      {
        elementId: "el_background",
        type: "rect",
        role: "decoration",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        rotation: 0,
        opacity: 1,
        zIndex: 0,
        locked: false,
        visible: true,
        props: {
          fill: "#F3F1FF",
          stroke: "transparent",
          strokeWidth: 0,
          borderRadius: 0,
        },
      },
      {
        elementId: "el_title",
        type: "activity-copy",
        role: "title",
        x: 120,
        y: 120,
        width: 900,
        height: 140,
        rotation: 0,
        opacity: 1,
        zIndex: 1,
        locked: false,
        visible: true,
        props: {
          activityId: activitySlide.activity.activityId,
          field: "title",
          fallbackText: "질문",
          textStyle: {
            color: "#171917",
            fontSize: 60,
            fontWeight: "bold",
          },
        },
      },
      {
        elementId: "el_passcode",
        type: "presentation-passcode",
        role: "body",
        x: 120,
        y: 400,
        width: 600,
        height: 180,
        rotation: 0,
        opacity: 1,
        zIndex: 2,
        locked: false,
        visible: true,
        props: {
          label: "입장 코드",
          unavailableText: "발표 시작 후 표시",
          publicAccessText: "비밀번호 없이 바로 참여",
          legacyUnavailableText: "입장 코드를 다시 설정해 주세요",
          labelTextStyle: {},
          codeTextStyle: { color: "#171917", fontSize: 54 },
          fill: "#FFFFFF",
          stroke: "#D0D5DD",
          strokeWidth: 1,
          borderRadius: 18,
        },
      },
    ];

    const projected = await projectActivityDeckForStaticExport(
      { query: vi.fn() } as unknown as DataSource,
      deck.projectId,
      deck,
    );
    const exported = projected.slides.find(
      (slide) => slide.slideId === activitySlide.slideId,
    );
    const serialized = JSON.stringify(exported);

    expect(exported?.elements).toHaveLength(3);
    expect(serialized).toContain("#F3F1FF");
    expect(serialized).toContain(activitySlide.activity.title);
    expect(serialized).toContain("입장 코드는 라이브 발표에서 표시됩니다.");
    expect(serialized).not.toMatch(
      /"activity-copy"|"activity-qr"|"presentation-passcode"/,
    );
  });

  it("exports distinct summary, chart, and approved-text layouts", async () => {
    const deck = activityDeck();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM activity_runs")) {
        return [
          {
            activity_run_id: "activity_run_1",
            activity_id: "activity_1",
            definition_snapshot: activityDefinition(),
            status: "results",
            revision: 3,
            response_count: 2,
            participant_count: 4,
            aggregate_json: null,
            raw_responses_deleted_at: null,
          },
        ];
      }
      if (
        sql.includes("FROM activity_responses") &&
        !sql.includes("INNER JOIN")
      ) {
        return [
          {
            answers_json: [
              { questionId: "question_rating", type: "rating", value: 5 },
              {
                questionId: "question_text",
                type: "free-text",
                text: "RAW_RESPONSE_SENTINEL",
              },
            ],
          },
          {
            answers_json: [
              { questionId: "question_rating", type: "rating", value: 3 },
              {
                questionId: "question_text",
                type: "free-text",
                text: "PENDING_TEXT",
              },
            ],
          },
        ];
      }
      if (sql.includes("FROM activity_text_entries")) {
        return [
          {
            entry_id: "activity_text_entry_1",
            question_id: "question_text",
            text_value: "승인된 의견입니다.",
            answered_at: null,
            updated_at: "2026-07-01T00:00:00.000Z",
            display_name: "PRIVATE_NAME",
          },
        ];
      }
      return [];
    });

    const summary = await projectActivityDeckForStaticExport(
      { query } as unknown as DataSource,
      deck.projectId,
      deck,
      "session_1",
    );
    const summarySerialized = JSON.stringify(summary);

    expect(summarySerialized).toContain("4.0 / 5");
    expect(summarySerialized).not.toContain("승인된 의견입니다.");
    expect(summarySerialized).not.toMatch(
      /RAW_RESPONSE_SENTINEL|PENDING_TEXT|PRIVATE_NAME/,
    );
    const resultSlide = deck.slides.find((slide) => slide.kind === "activity-results");
    if (!resultSlide || resultSlide.kind !== "activity-results") {
      throw new Error("activity result fixture");
    }
    resultSlide.activityResult.layout = "chart";
    const chart = await projectActivityDeckForStaticExport(
      { query } as unknown as DataSource,
      deck.projectId,
      deck,
      "session_1",
    );
    const chartSerialized = JSON.stringify(chart);
    expect(chartSerialized).toContain('"type":"rect"');
    expect(chartSerialized).not.toContain("승인된 의견입니다.");

    resultSlide.activityResult.layout = "approved-text";
    const approvedText = await projectActivityDeckForStaticExport(
      { query } as unknown as DataSource,
      deck.projectId,
      deck,
      "session_1",
    );
    const approvedSerialized = JSON.stringify(approvedText);
    expect(approvedSerialized).toContain("승인된 의견입니다.");
    expect(approvedSerialized).not.toContain("4.0 / 5");
    expect(approvedSerialized).not.toMatch(
      /RAW_RESPONSE_SENTINEL|PENDING_TEXT|PRIVATE_NAME/,
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("sessions.deck_id = $4"),
      ["project-a", "session_1", "activity_1", "deck_activity_1"],
    );
  });

  it("uses the retention snapshot after raw responses have expired", async () => {
    const deck = activityDeck();
    const query = vi.fn(async (sql: string) =>
      sql.includes("FROM activity_runs")
        ? [
            {
              activity_run_id: "activity_run_1",
              activity_id: "activity_1",
              definition_snapshot: activityDefinition(),
              status: "results",
              revision: 4,
              response_count: 7,
              participant_count: 10,
              raw_responses_deleted_at: "2026-07-01T00:00:00.000Z",
              aggregate_json: {
                activityRunId: "activity_run_1",
                activityId: "activity_1",
                status: "results",
                revision: 4,
                responseCount: 7,
                participantCount: 10,
                responseRate: 70,
                aggregates: [
                  {
                    questionId: "question_rating",
                    type: "rating",
                    responseCount: 7,
                    average: 4.5,
                    choices: [],
                  },
                  {
                    questionId: "question_text",
                    type: "free-text",
                    responseCount: 7,
                    average: null,
                    choices: [],
                  },
                ],
                textEntries: [],
              },
            },
          ]
        : [],
    );

    const projected = await projectActivityDeckForStaticExport(
      { query } as unknown as DataSource,
      deck.projectId,
      deck,
      "session_1",
    );

    expect(JSON.stringify(projected)).toContain("7명 응답");
    expect(JSON.stringify(projected)).toContain("4.5 / 5");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("explains expired raw text in an approved-text retention export", async () => {
    const deck = activityDeck();
    const resultSlide = deck.slides.find((slide) => slide.kind === "activity-results");
    if (!resultSlide || resultSlide.kind !== "activity-results") {
      throw new Error("activity result fixture");
    }
    resultSlide.activityResult.layout = "approved-text";
    const query = vi.fn(async (sql: string) =>
      sql.includes("FROM activity_runs")
        ? [{
            activity_run_id: "activity_run_1",
            activity_id: "activity_1",
            definition_snapshot: activityDefinition(),
            status: "results",
            revision: 4,
            response_count: 7,
            participant_count: 10,
            raw_responses_deleted_at: "2026-10-15T00:00:00.000Z",
            aggregate_json: {
              activityRunId: "activity_run_1",
              activityId: "activity_1",
              status: "results",
              revision: 4,
              responseCount: 7,
              participantCount: 10,
              responseRate: 70,
              aggregates: [],
              textEntries: [],
            },
          }]
        : [],
    );

    const projected = await projectActivityDeckForStaticExport(
      { query } as unknown as DataSource,
      deck.projectId,
      deck,
      "session_1",
    );

    expect(JSON.stringify(projected)).toContain("원문 보존 기간이 종료");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("keeps a visible recovery message for a missing source Activity", async () => {
    const deck = activityDeck();
    deck.slides = deck.slides.filter(
      (slide) => slide.kind === "activity-results",
    );

    const projected = await projectActivityDeckForStaticExport(
      { query: vi.fn() } as unknown as DataSource,
      deck.projectId,
      deck,
      "session_1",
    );

    expect(JSON.stringify(projected)).toContain(
      "연결된 참여 장표를 찾을 수 없습니다.",
    );
  });
});

function activityDeck(): Deck {
  return deckSchema.parse({
    deckId: "deck_activity_1",
    projectId: "project-a",
    title: "Activity export",
    version: 1,
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        kind: "activity",
        slideId: "slide_activity_1",
        order: 1,
        title: "참여",
        speakerNotes: "speaker secret",
        activity: activityDefinition(),
      },
      {
        kind: "activity-results",
        slideId: "slide_result_1",
        order: 2,
        title: "결과",
        speakerNotes: "speaker secret",
        activityResult: {
          sourceActivityId: "activity_1",
          display: "live",
          layout: "summary",
        },
      },
    ],
  });
}

function activityDefinition() {
  return {
    activityId: "activity_1",
    template: "satisfaction" as const,
    title: "발표 만족도",
    description: "",
    questions: [
      {
        questionId: "question_rating",
        type: "rating" as const,
        prompt: "발표가 유익했나요?",
        required: true,
        leftLabel: "아니요",
        rightLabel: "그래요",
      },
      {
        questionId: "question_text",
        type: "free-text" as const,
        prompt: "의견을 알려주세요.",
        required: false,
      },
    ],
    allowDisplayName: true,
    hideResultsUntilReveal: true,
  };
}
