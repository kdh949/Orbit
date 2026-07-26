import type { LiveSttPort } from "../../../runtime/speech/stt/liveSttPort";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useLiveSttSession } from "./useLiveSttSession";

describe("useLiveSttSession", () => {
  it("reuses an injected port and owns its result subscriptions", async () => {
    const unsubscribeResult = vi.fn();
    const unsubscribeError = vi.fn();
    const port = {
      dispose: vi.fn(),
      engineId: "web-speech",
      onError: vi.fn(() => unsubscribeError),
      onResult: vi.fn(() => unsubscribeResult),
      start: vi.fn(),
      stop: vi.fn(),
      updateBiasPhrases: vi.fn(),
    } as unknown as LiveSttPort;
    let session: ReturnType<typeof useLiveSttSession> | null = null;

    function Harness() {
      session = useLiveSttSession({
        fallbackEngineId: "sherpa",
        initialPort: port,
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    const resolved = await session!.preparePort({
      onError: vi.fn(),
      onResult: vi.fn(),
    });

    expect(resolved).toBe(port);
    expect(port.onResult).toHaveBeenCalledOnce();
    expect(port.onError).toHaveBeenCalledOnce();
    expect(await session!.resolveEffectiveEngine()).toBe("web-speech");

    session!.cleanupSubscriptions();
    expect(unsubscribeResult).toHaveBeenCalledOnce();
    expect(unsubscribeError).toHaveBeenCalledOnce();
  });
});
