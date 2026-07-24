import { describe, expect, it } from "vitest";

import {
  createPresentationCompanionEvent,
  presentationCompanionAuthorityRoomId,
  presentationCompanionRoomId
} from "./index";

describe("presentation companion realtime helpers", () => {
  it("creates isolated authority and generation rooms", () => {
    expect(
      presentationCompanionAuthorityRoomId("session_1", "epoch_1")
    ).toBe("presentation:session_1:companion-authority:epoch_1");
    expect(presentationCompanionRoomId("session_1", 2)).toBe(
      "presentation:session_1:companion:2"
    );
    expect(() =>
      presentationCompanionAuthorityRoomId(
        "session_1:audience",
        "epoch_1"
      )
    ).toThrow("room segment");
    expect(() => presentationCompanionRoomId("session_1", 0)).toThrow(
      "positive integer"
    );
  });

  it("creates a schema-validated companion envelope", () => {
    const event = createPresentationCompanionEvent({
      type: "presentation:companion:revoked",
      roomId: presentationCompanionRoomId("session_1", 1),
      sessionId: "session_1",
      userId: "system",
      payload: { reason: "replaced" }
    });
    expect(event).toMatchObject({
      type: "presentation:companion:revoked",
      sessionId: "session_1",
      payload: { reason: "replaced" }
    });
    expect(() =>
      createPresentationCompanionEvent({
        type: "presentation:companion:revoked",
        roomId: presentationCompanionRoomId("session_1", 1),
        sessionId: "session_1",
        userId: "system",
        payload: {
          reason: "replaced",
          credential: "PRIVATE_TOKEN"
        }
      })
    ).toThrow();
  });
});
