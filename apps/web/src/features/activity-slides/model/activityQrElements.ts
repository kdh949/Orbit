import type { Deck } from "@orbit/shared";

import { activityApi } from "../api/activityApi";

export function getActivityQrActivityIds(deck: Deck) {
  return [
    ...new Set(
      deck.slides.flatMap((slide) =>
        slide.elements.flatMap((element) =>
          element.type === "activity-qr" ? [element.props.activityId] : []
        )
      )
    )
  ];
}

/**
 * Creating an activity run is an explicit presentation-start transition, never
 * a rendering concern. It guarantees that the participant route encoded by a
 * reusable QR element can be opened as soon as the presentation starts.
 */
export async function prepareActivityQrRuns(input: {
  audienceAccessEnabled: boolean;
  deck: Deck;
  projectId: string;
  sessionId: string;
}) {
  if (!input.audienceAccessEnabled) {
    return;
  }
  await Promise.all(
    getActivityQrActivityIds(input.deck).map((activityId) =>
      activityApi.ensureRun(input.projectId, input.sessionId, activityId)
    )
  );
}
