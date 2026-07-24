import { describe, expect, it } from "vitest";

import {
  companionDeckSnapshotSchema,
  presentationCompanionActivityProjectionSchema,
  presentationCompanionBootstrapSchema,
  presentationCompanionPairingResponseSchema,
} from "./presenter-companion.schema";

const safeSnapshot = {
  deckId: "deck_companion_1",
  projectId: "project_companion_1",
  version: 3,
  canvas: {
    preset: "wide-16-9" as const,
    width: 1920 as const,
    height: 1080 as const,
    aspectRatio: "16:9" as const,
  },
  theme: {},
  slides: [
    {
      slideId: "slide_companion_1",
      kind: "content" as const,
      order: 1,
      style: {},
      elements: [
        {
          elementId: "el_companion_1",
          type: "image" as const,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          props: {
            src: "/api/v1/presentation-companion/session_1/assets/file_1/content",
          },
        },
      ],
      animations: [],
      triggerAnimationIds: [],
    },
  ],
};

describe("companionDeckSnapshotSchema", () => {
  it("accepts only audience rendering fields", () => {
    const snapshot = companionDeckSnapshotSchema.parse(safeSnapshot);

    expect(snapshot).toMatchObject({
      deckId: "deck_companion_1",
      projectId: "project_companion_1",
      version: 3,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /speakerNotes|keywords|semanticCues|actions|aiNotes|metadata/,
    );
  });

  it.each([
    ["speakerNotes", "PRIVATE_SPEAKER_NOTES"],
    ["keywords", ["PRIVATE_KEYWORD"]],
    ["semanticCues", ["PRIVATE_SEMANTIC_CUE"]],
    ["actions", ["PRIVATE_ACTION"]],
    ["aiNotes", { emphasisPoints: ["PRIVATE_AI_NOTE"] }],
  ])("rejects the private slide field %s", (field, value) => {
    expect(
      companionDeckSnapshotSchema.safeParse({
        ...safeSnapshot,
        slides: [{ ...safeSnapshot.slides[0], [field]: value }],
      }).success,
    ).toBe(false);
  });

  it("rejects Deck metadata and generation provenance", () => {
    expect(
      companionDeckSnapshotSchema.safeParse({
        ...safeSnapshot,
        metadata: {
          createdFrom: { topic: "PRIVATE_GENERATION_PROMPT" },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects trigger animation ids outside the projected animations", () => {
    expect(
      companionDeckSnapshotSchema.safeParse({
        ...safeSnapshot,
        slides: [
          {
            ...safeSnapshot.slides[0],
            triggerAnimationIds: ["anim_private_missing"],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("presentation companion HTTP schemas", () => {
  it("accepts only an HTTPS pairing URL without a separate raw code field", () => {
    expect(
      presentationCompanionPairingResponseSchema.parse({
        pairingUrl:
          "https://present.orbit.example/companion/pair/single-use-code",
        expiresAt: "2026-07-23T00:02:00.000Z",
      }),
    ).not.toHaveProperty("code");
    expect(
      presentationCompanionPairingResponseSchema.safeParse({
        pairingUrl: "http://localhost:5173/companion/pair/private-code",
        expiresAt: "2026-07-23T00:02:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects private presenter fields in a bootstrap response", () => {
    const bootstrap = {
      sessionId: "session_1",
      sessionPurpose: "presentation" as const,
      expiresAt: "2026-07-23T04:00:00.000Z",
      scopes: ["view-audience-output", "write-annotation"] as const,
      deck: safeSnapshot,
    };
    expect(
      presentationCompanionBootstrapSchema.parse(bootstrap),
    ).toMatchObject(bootstrap);
    expect(
      presentationCompanionBootstrapSchema.safeParse({
        ...bootstrap,
        transcript: "PRIVATE_TRANSCRIPT_MARKER",
      }).success,
    ).toBe(false);
  });

  it("accepts only public activity runtime state", () => {
    expect(
      presentationCompanionActivityProjectionSchema.parse({
        activityId: "activity_1",
        audienceUrl: "/audience/session_1/a/activity_1",
        run: { status: "open" },
        publicResult: null,
      }),
    ).toEqual({
      activityId: "activity_1",
      audienceUrl: "/audience/session_1/a/activity_1",
      run: { status: "open" },
      publicResult: null,
    });
    expect(
      presentationCompanionActivityProjectionSchema.safeParse({
        activityId: "activity_1",
        audienceUrl: null,
        run: null,
        publicResult: null,
        presenterResult: "PRIVATE_RESULT",
      }).success,
    ).toBe(false);
  });
});
