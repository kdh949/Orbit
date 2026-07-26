import { describe, expect, it, vi } from "vitest";
import {
  ScreenShareCaptureError,
  createDisplayMediaOptions,
  createScreenShareCapturePort,
} from "./screenShareCapture";

describe("screenShareCapture", () => {
  it("requests tab or window capture without audio or monitor surfaces", () => {
    expect(createDisplayMediaOptions("tab-or-window")).toMatchObject({
      audio: false,
      monitorTypeSurfaces: "exclude",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      systemAudio: "exclude",
      video: { displaySurface: "browser" },
    });
  });

  it("requests monitor capture only through the advanced intent", () => {
    expect(createDisplayMediaOptions("monitor")).toMatchObject({
      audio: false,
      monitorTypeSurfaces: "include",
      surfaceSwitching: "exclude",
      video: { displaySurface: "monitor" },
    });
  });

  it("stops a monitor selected through the basic flow", async () => {
    const track = createTrack("monitor");
    const port = createScreenShareCapturePort({
      getDisplayMedia: async () => createStream(track),
    });

    await expect(port.start("tab-or-window")).rejects.toMatchObject({
      code: "monitor-not-allowed",
    });
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("notifies ended once across duplicate stop and track events", async () => {
    const track = createTrack("browser");
    const capture = await createScreenShareCapturePort({
      getDisplayMedia: async () => createStream(track),
    }).start("tab-or-window");
    const listener = vi.fn();
    capture.subscribeEnded(listener);

    capture.stop();
    capture.stop();
    track.dispatchEnded();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("uses Conditional Focus without failing capture when focus is denied", async () => {
    const setFocusBehavior = vi.fn(() => {
      throw new Error("focus denied");
    });
    const capture = await createScreenShareCapturePort({
      createCaptureController: () => ({ setFocusBehavior }),
      getDisplayMedia: async () => createStream(createTrack("window")),
    }).start("tab-or-window");

    expect(() => capture.focusCapturedSurface()).not.toThrow();
    expect(setFocusBehavior).toHaveBeenCalledWith("focus-captured-surface");
  });

  it.each([
    ["NotAllowedError", "cancelled"],
    ["InvalidStateError", "activation-required"],
    ["NotReadableError", "not-readable"],
    ["UnknownError", "capture-failed"],
  ])("maps %s to %s", async (name, code) => {
    const port = createScreenShareCapturePort({
      getDisplayMedia: async () => {
        throw Object.assign(new Error(name), { name });
      },
    });

    await expect(port.start("tab-or-window")).rejects.toMatchObject({ code });
  });

  it("reports unsupported browsers with a user-safe error", async () => {
    const port = createScreenShareCapturePort({});

    expect(port.isSupported()).toBe(false);
    await expect(port.start("tab-or-window")).rejects.toBeInstanceOf(
      ScreenShareCaptureError,
    );
  });
});

function createTrack(displaySurface: "browser" | "window" | "monitor") {
  const listeners = new Set<() => void>();
  return {
    addEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.add(listener);
    }),
    dispatchEnded: () => {
      for (const listener of listeners) listener();
    },
    getSettings: () => ({ displaySurface }),
    removeEventListener: vi.fn((_type: string, listener: () => void) => {
      listeners.delete(listener);
    }),
    stop: vi.fn(),
  };
}

function createStream(track: ReturnType<typeof createTrack>) {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}
