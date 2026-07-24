import { describe, expect, it, vi } from "vitest";

import { PresentationCompanionPublisher } from "./presentation-companion.publisher";

describe("PresentationCompanionPublisher", () => {
  it("emits revoke only to the active generation room and disconnects it", async () => {
    const store = {
      getLatestGeneration: vi.fn().mockResolvedValue(3),
    };
    const target = {
      emit: vi.fn(),
      disconnectSockets: vi.fn().mockResolvedValue(undefined),
    };
    const server = {
      in: vi.fn().mockReturnValue(target),
      to: vi.fn().mockReturnValue(target),
    };
    const publisher = new PresentationCompanionPublisher(store as never);
    publisher.attach(server as never);

    await publisher.revokeCurrent("session_1", "replaced");

    expect(server.to).toHaveBeenCalledWith(
      "presentation:session_1:companion:3",
    );
    expect(target.emit).toHaveBeenCalledWith(
      "presentation:companion:revoked",
      expect.objectContaining({
        payload: { reason: "replaced" },
        userId: "system",
      }),
    );
    expect(target.disconnectSockets).toHaveBeenCalledWith(true);
  });

  it("publishes presence only to the presenter room", () => {
    const target = { emit: vi.fn() };
    const server = {
      to: vi.fn().mockReturnValue(target),
    };
    const publisher = new PresentationCompanionPublisher({
      getLatestGeneration: vi.fn(),
    } as never);
    publisher.attach(server as never);

    publisher.publishPresence("session_1", {
      connected: false,
      pairingGeneration: 2,
      connectedAt: null,
      rttBucket: null,
    });

    expect(server.to).toHaveBeenCalledWith(
      "presentation:session_1:presenter",
    );
    expect(target.emit).toHaveBeenCalledWith(
      "presentation:companion:presence",
      expect.objectContaining({
        payload: expect.objectContaining({ connected: false }),
      }),
    );
  });
});
