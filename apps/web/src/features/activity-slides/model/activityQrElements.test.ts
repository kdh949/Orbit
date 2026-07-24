import { createDemoDeck, createActivitySlide } from "@orbit/editor-core";
import { deckSchema } from "@orbit/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { activityApi } from "../api/activityApi";
import {
  getActivityQrActivityIds,
  prepareActivityQrRuns
} from "./activityQrElements";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("activity QR preparation", () => {
  it("prepares each referenced activity once at presentation start", async () => {
    const baseDeck = createDemoDeck();
    const activitySlide = createActivitySlide(baseDeck, "satisfaction");
    const contentSlide = baseDeck.slides[0];
    const deck = deckSchema.parse({
      ...baseDeck,
      slides: [
        {
          ...contentSlide,
          elements: [
            ...contentSlide.elements,
            qrElement("el_qr_1", activitySlide.activity.activityId),
            qrElement("el_qr_2", activitySlide.activity.activityId)
          ]
        },
        activitySlide
      ]
    });
    const ensureRun = vi.spyOn(activityApi, "ensureRun").mockResolvedValue({
      run: {} as never
    });

    expect(getActivityQrActivityIds(deck)).toEqual([activitySlide.activity.activityId]);
    await prepareActivityQrRuns({
      audienceAccessEnabled: true,
      deck,
      projectId: deck.projectId,
      sessionId: "session_1"
    });

    expect(ensureRun).toHaveBeenCalledTimes(1);
    expect(ensureRun).toHaveBeenCalledWith(
      deck.projectId,
      "session_1",
      activitySlide.activity.activityId
    );
  });

  it("does not create activity runs for a companion-only session", async () => {
    const deck = createDemoDeck();
    const ensureRun = vi.spyOn(activityApi, "ensureRun");

    await prepareActivityQrRuns({
      audienceAccessEnabled: false,
      deck,
      projectId: deck.projectId,
      sessionId: "session_companion_only",
    });

    expect(ensureRun).not.toHaveBeenCalled();
  });
});

function qrElement(elementId: string, activityId: string) {
  return {
    elementId,
    type: "activity-qr" as const,
    x: 100,
    y: 100,
    width: 240,
    height: 240,
    rotation: 0,
    opacity: 1,
    zIndex: 99,
    locked: false,
    visible: true,
    props: { activityId }
  };
}
