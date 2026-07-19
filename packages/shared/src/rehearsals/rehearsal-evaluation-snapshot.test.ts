import { describe, expect, it } from "vitest";

import { deckSchema } from "../deck/deck.schema";
import { createRehearsalEvaluationSnapshot } from "./rehearsal-evaluation-snapshot";
import { rehearsalEvaluationSnapshotSchema } from "./rehearsal.schema";

describe("createRehearsalEvaluationSnapshot", () => {
  it("captures only reviewed cues without presenter source content", () => {
    const snapshot = createRehearsalEvaluationSnapshot(
      deckSchema.parse(deckFixture()),
      "2026-07-10T08:00:00.000Z"
    );

    expect(snapshot).toMatchObject({
      deckId: "deck_snapshot",
      deckVersion: 4,
      capturedAt: "2026-07-10T08:00:00.000Z"
    });
    expect(snapshot.slides[0]?.estimatedSeconds).toBe(600);
    expect(snapshot.slides[0]?.semanticCues.map((cue) => cue.cueId)).toEqual([
      "scue_approved",
      "scue_excluded"
    ]);
    expect(snapshot.slides[0]?.semanticCues[0]?.freshness).toBe("stale");

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("발표자 전용 원문");
    expect(serialized).not.toContain("슬라이드 요소 원문");
    expect(serialized).not.toContain("speakerNotes");
    expect(serialized).not.toContain("elements");
    expect(snapshot.deckContentHash).toBeNull();
    expect(snapshot.evaluationPlan).toBeNull();
  });

  it("rejects suggested cues in persisted snapshots", () => {
    const snapshot = createRehearsalEvaluationSnapshot(
      deckSchema.parse(deckFixture()),
      "2026-07-10T08:00:00.000Z"
    );

    const result = rehearsalEvaluationSnapshotSchema.safeParse({
      ...snapshot,
      slides: [
        {
          ...snapshot.slides[0],
          semanticCues: [
            {
              ...snapshot.slides[0]?.semanticCues[0],
              reviewStatus: "suggested"
            }
          ]
        }
      ]
    });

    expect(result.success).toBe(false);
  });

  it("uses a stable fallback title when a slide title is blank", () => {
    const fixture = deckFixture();
    fixture.slides[0]!.title = "   ";
    fixture.slides[0]!.speakerNotes = "";

    const snapshot = createRehearsalEvaluationSnapshot(
      deckSchema.parse(fixture),
      "2026-07-10T08:00:00.000Z"
    );

    expect(snapshot.slides[0]?.title).toBe("슬라이드 1");
  });

  it("freezes run-scoped thumbnail URLs without copying Deck thumbnail state", () => {
    const deck = deckSchema.parse(deckFixture());
    deck.slides[0]!.thumbnailUrl = "/stale-deck-thumbnail.png";

    const snapshot = createRehearsalEvaluationSnapshot(
      deck,
      "2026-07-10T08:00:00.000Z",
      {
        slideThumbnailUrls: new Map([
          ["slide_1", "/api/v1/projects/project-a/assets/file-1/content"]
        ])
      }
    );

    expect(snapshot.slides[0]?.thumbnailUrl).toBe(
      "/api/v1/projects/project-a/assets/file-1/content"
    );
    expect(JSON.stringify(snapshot)).not.toContain("stale-deck-thumbnail");
  });

  it("freezes the focus profile revision and items at run creation", () => {
    const snapshot = createRehearsalEvaluationSnapshot(
      deckSchema.parse(deckFixture()),
      "2026-07-10T08:00:00.000Z",
      {
        focusProfileSnapshot: {
          profileRef: { profileId: "focus-profile-1", revision: 2 },
          items: [
            {
              focusItemId: "focus-item-1",
              priority: 1,
              kind: "opening",
              label: "도입부에서 발표 목적 먼저 말하기",
              targetScope: { type: "opening", scopeId: "scope-opening" },
            },
          ],
        },
      },
    );

    expect(snapshot.focusProfileSnapshot?.profileRef.revision).toBe(2);
    expect(snapshot.focusProfileSnapshot?.items[0]?.label).toBe(
      "도입부에서 발표 목적 먼저 말하기",
    );
  });

  it("freezes a deterministic pronunciation lexicon without copying speaker notes", () => {
    const fixture = deckFixture();
    fixture.slides[0]!.speakerNotes =
      "OpenAI API를 활용하지만 발표자 전용 원문은 저장하지 않습니다.";

    const snapshot = createRehearsalEvaluationSnapshot(
      deckSchema.parse(fixture),
      "2026-07-10T08:00:00.000Z",
    );

    expect(snapshot.pronunciationLexicon?.entries).toEqual([
      expect.objectContaining({
        sourceText: "OpenAI",
        canonicalKey: "openai",
        aliases: expect.arrayContaining([
          expect.objectContaining({ text: "오픈에이아이" }),
        ]),
      }),
      expect.objectContaining({
        sourceText: "API",
        canonicalKey: "api",
        aliases: expect.arrayContaining([
          expect.objectContaining({ text: "에이피아이" }),
        ]),
      }),
    ]);
    expect(snapshot.pronunciationLexicon?.sourceHash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(snapshot)).not.toContain(
      "OpenAI API를 활용하지만 발표자 전용 원문은 저장하지 않습니다.",
    );
  });

  it("accepts legacy snapshots without a pronunciation lexicon", () => {
    const snapshot = createRehearsalEvaluationSnapshot(
      deckSchema.parse(deckFixture()),
      "2026-07-10T08:00:00.000Z",
    );
    const { pronunciationLexicon: _pronunciationLexicon, ...legacySnapshot } =
      snapshot;

    const parsed = rehearsalEvaluationSnapshotSchema.parse(legacySnapshot);

    expect(parsed.pronunciationLexicon).toBeUndefined();
  });
});

function deckFixture() {
  return {
    deckId: "deck_snapshot",
    projectId: "project_snapshot",
    title: "Snapshot Deck",
    version: 4,
    targetDurationMinutes: 10,
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9"
    },
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "Opening",
        speakerNotes: "발표자 전용 원문",
        keywords: [
          {
            keywordId: "kw_1",
            text: "ORBIT",
            synonyms: ["발표 도우미"],
            abbreviations: [],
            required: true
          }
        ],
        elements: [
          {
            elementId: "el_1",
            type: "text",
            x: 0,
            y: 0,
            width: 100,
            height: 40,
            props: { text: "슬라이드 요소 원문" }
          }
        ],
        semanticCues: [
          semanticCue("scue_approved", "approved", "stale"),
          semanticCue("scue_excluded", "excluded", "current"),
          semanticCue("scue_suggested", "suggested", "current")
        ]
      }
    ]
  };
}

function semanticCue(
  cueId: string,
  reviewStatus: "suggested" | "approved" | "excluded",
  freshness: "current" | "stale"
) {
  return {
    cueId,
    slideId: "slide_1",
    meaning: `의미 ${cueId}`,
    importance: "core",
    reviewStatus,
    freshness,
    origin: "ai",
    revision: 2,
    required: true,
    priority: 1,
    candidateKeywords: ["ORBIT"],
    aliases: {},
    requiredConcepts: ["발표 도우미"],
    nliHypotheses: ["발표자는 ORBIT이 발표를 돕는다고 설명했다"],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: []
  };
}
