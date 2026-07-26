import type { ReactNode } from "react";
import { forwardRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLiveAudioLevelLabel,
  getLiveAudioLevelPercent,
  getLiveSttDebugDecodingMethod,
  shouldShowLiveSttDebugPcmDownload,
} from "./stt/liveSttUiModel";
import {
  getRehearsalMicrophoneAudioConstraints,
  readRehearsalMicrophoneDeviceId,
  rehearsalMicrophoneAudioConstraints,
  rehearsalRawMicrophoneAudioConstraints,
  requestRehearsalMicrophoneStream,
  writeRehearsalMicrophoneDeviceId,
} from "../presenter-shell/microphoneSettings";

vi.mock("react-konva", () => {
  const Group = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Stage = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Text = ({ text }: { text?: string }) => <span>{text}</span>;

  return {
    Arrow: () => <span data-konva-arrow="true" />,
    Circle: () => <span data-konva-circle="true" />,
    Group,
    Image: () => <span data-konva-image="true" />,
    Layer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Line: () => <span data-konva-line="true" />,
    Rect: () => <span data-konva-rect="true" />,
    RegularPolygon: () => <span data-konva-polygon="true" />,
    Shape: () => <span data-konva-shape="true" />,
    Star: () => <span data-konva-star="true" />,
    Stage,
    Text,
  };
});

describe("RehearsalWorkspace Live STT", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requests microphone audio with live STT input quality constraints", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);

    const result = await requestRehearsalMicrophoneStream({
      getUserMedia,
    } as unknown as Pick<MediaDevices, "getUserMedia">);

    expect(result).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: rehearsalMicrophoneAudioConstraints,
    });
  });

  it("reuses the microphone selected during preflight", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    writeRehearsalMicrophoneDeviceId("mic-external", storage);
    expect(readRehearsalMicrophoneDeviceId(storage)).toBe("mic-external");
  });

  it("requests raw microphone audio constraints when Live STT raw mic debug is enabled", async () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) =>
          key === "orbit.liveStt.debugRawMic" ? "1" : null,
        ),
      },
    });
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);

    const result = await requestRehearsalMicrophoneStream({
      getUserMedia,
    } as unknown as Pick<MediaDevices, "getUserMedia">);

    expect(result).toBe(stream);
    expect(getRehearsalMicrophoneAudioConstraints()).toBe(
      rehearsalRawMicrophoneAudioConstraints,
    );
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: rehearsalRawMicrophoneAudioConstraints,
    });
  });

  it("falls back to default microphone constraints when localStorage is blocked", async () => {
    const blockedWindow = {};
    Object.defineProperty(blockedWindow, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    vi.stubGlobal("window", blockedWindow);
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);

    await expect(
      requestRehearsalMicrophoneStream({
        getUserMedia,
      } as unknown as Pick<MediaDevices, "getUserMedia">),
    ).resolves.toBe(stream);

    expect(getRehearsalMicrophoneAudioConstraints()).toBe(
      rehearsalMicrophoneAudioConstraints,
    );
    expect(getLiveSttDebugDecodingMethod()).toBeNull();
    expect(
      shouldShowLiveSttDebugPcmDownload(
        {
          blob: new Blob([]),
          filename: "orbit-live-stt-model-input.wav",
          sampleRate: 16000,
          durationMs: 1000,
          peak: 0.5,
          rms: 0.2,
        },
        undefined,
      ),
    ).toBe(false);
  });

  it("parses Live STT debug decoding method overrides defensively", () => {
    expect(
      getLiveSttDebugDecodingMethod({
        getItem: vi.fn(() => "modified_beam_search"),
      }),
    ).toBe("modified_beam_search");
    expect(
      getLiveSttDebugDecodingMethod({
        getItem: vi.fn(() => "beam_search"),
      }),
    ).toBeNull();
    expect(
      getLiveSttDebugDecodingMethod({
        getItem: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
      }),
    ).toBeNull();
  });

  it("shows the model input WAV download only when PCM debug has a recording", () => {
    const recording = {
      blob: new Blob([]),
      filename: "orbit-live-stt-model-input.wav",
      sampleRate: 16000,
      durationMs: 1000,
      peak: 0.5,
      rms: 0.2,
    };

    expect(
      shouldShowLiveSttDebugPcmDownload(recording, {
        getItem: vi.fn((key: string) =>
          key === "orbit.liveStt.debugPcmDump" ? "1" : null,
        ),
      }),
    ).toBe(true);
    expect(
      shouldShowLiveSttDebugPcmDownload(null, {
        getItem: vi.fn(() => "1"),
      }),
    ).toBe(false);
    expect(
      shouldShowLiveSttDebugPcmDownload(recording, {
        getItem: vi.fn(() => null),
      }),
    ).toBe(false);
  });

  it("labels live STT microphone input levels", () => {
    expect(getLiveAudioLevelLabel(null)).toBe("입력 대기");
    expect(getLiveAudioLevelPercent(null)).toBe(0);
    expect(
      getLiveAudioLevelLabel({
        type: "audio-level",
        rms: 0.001,
        peak: 0.01,
        rmsDb: -60,
        peakDb: -40,
        isLikelySilence: true,
      }),
    ).toBe("입력 낮음");
    expect(
      getLiveAudioLevelLabel({
        type: "audio-level",
        rms: 0.08,
        peak: 0.3,
        rmsDb: -22,
        peakDb: -10,
        isLikelySilence: false,
      }),
    ).toBe("입력 적정");
    expect(
      getLiveAudioLevelLabel({
        type: "audio-level",
        rms: 0.5,
        peak: 0.9,
        rmsDb: -6,
        peakDb: -2,
        isLikelySilence: false,
      }),
    ).toBe("입력 과대");
    expect(
      getLiveAudioLevelPercent({
        type: "audio-level",
        rms: 0.08,
        peak: 0.3,
        rmsDb: -22,
        peakDb: -10,
        isLikelySilence: false,
      }),
    ).toBe(60);
  });
});
