import { describe, expect, it, vi } from "vitest";
import {
  attachAudienceStreamToWindow,
  audienceStreamBridgeKey,
  detachAudienceStreamFromWindow,
  observeAudienceStreamInWindow,
  registerAudienceStreamBridge,
} from "./audienceStreamBridge";

const identity = { deckId: "deck_1", sessionId: "session_1" };
const stream = {} as MediaStream;

describe("audienceStreamBridge", () => {
  it("attaches and detaches only for the registered identity", () => {
    const targetWindow = {};
    const onAttach = vi.fn();
    const onDetach = vi.fn();
    const registration = registerAudienceStreamBridge({
      identity,
      onAttach,
      onDetach,
      targetWindow,
    });

    expect(registration.ok).toBe(true);
    expect(
      attachAudienceStreamToWindow({
        identity,
        shareEpochId: "share_1",
        stream,
        targetWindow,
      }),
    ).toEqual({ ok: true });
    expect(onAttach).toHaveBeenCalledWith(stream);
    expect(
      detachAudienceStreamFromWindow({ identity, targetWindow }),
    ).toEqual({ ok: true });
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched deck or session identities", () => {
    const targetWindow = {};
    registerAudienceStreamBridge({
      identity,
      onAttach: vi.fn(),
      onDetach: vi.fn(),
      targetWindow,
    });

    expect(
      attachAudienceStreamToWindow({
        identity: { ...identity, sessionId: "session_other" },
        shareEpochId: "share_1",
        stream,
        targetWindow,
      }),
    ).toEqual({ code: "identity-mismatch", ok: false });
  });

  it("returns typed failures for closed and unprepared windows", () => {
    expect(
      attachAudienceStreamToWindow({
        identity,
        shareEpochId: "share_1",
        stream,
        targetWindow: null,
      }),
    ).toEqual({ code: "window-closed", ok: false });
    expect(
      attachAudienceStreamToWindow({
        identity,
        shareEpochId: "share_1",
        stream,
        targetWindow: { closed: true },
      }),
    ).toEqual({ code: "window-closed", ok: false });
    expect(
      attachAudienceStreamToWindow({
        identity,
        shareEpochId: "share_1",
        stream,
        targetWindow: {},
      }),
    ).toEqual({ code: "bridge-unavailable", ok: false });
  });

  it("removes only its own bridge on receiver cleanup", () => {
    const targetWindow: Record<string, unknown> = {};
    const registration = registerAudienceStreamBridge({
      identity,
      onAttach: vi.fn(),
      onDetach: vi.fn(),
      targetWindow,
    });
    expect(registration.ok).toBe(true);
    const installedBridge = targetWindow[audienceStreamBridgeKey];

    if (registration.ok) registration.unregister();

    expect(installedBridge).toBeDefined();
    expect(targetWindow[audienceStreamBridgeKey]).toBeUndefined();
  });

  it("detaches an attached stream once when the receiver unregisters", () => {
    const targetWindow = {};
    const onDetach = vi.fn();
    const registration = registerAudienceStreamBridge({
      identity,
      onAttach: vi.fn(),
      onDetach,
      targetWindow,
    });
    attachAudienceStreamToWindow({
      identity,
      shareEpochId: "share_1",
      stream,
      targetWindow,
    });

    if (registration.ok) {
      registration.unregister();
      registration.unregister();
    }

    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("notifies same-origin observers with the active share epoch", () => {
    const targetWindow = {};
    const onChange = vi.fn();
    registerAudienceStreamBridge({
      identity,
      onAttach: vi.fn(),
      onDetach: vi.fn(),
      targetWindow,
    });

    const observation = observeAudienceStreamInWindow({
      identity,
      onChange,
      targetWindow,
    });
    expect(observation.ok).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(null);

    attachAudienceStreamToWindow({
      identity,
      shareEpochId: "share_1",
      stream,
      targetWindow,
    });
    expect(onChange).toHaveBeenLastCalledWith({
      shareEpochId: "share_1",
      stream,
    });

    detachAudienceStreamFromWindow({ identity, targetWindow });
    expect(onChange).toHaveBeenLastCalledWith(null);
    if (observation.ok) observation.unsubscribe();
  });

  it("does not overwrite an existing receiver bridge", () => {
    const targetWindow = { [audienceStreamBridgeKey]: { version: 1 } };

    expect(
      registerAudienceStreamBridge({
        identity,
        onAttach: vi.fn(),
        onDetach: vi.fn(),
        targetWindow,
      }),
    ).toEqual({ code: "bridge-conflict", ok: false });
  });
});
