import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculatePcmStats,
  createLiveSttPcmDebugRecorder,
  encodePcm16Wav,
  isLiveSttPcmDebugEnabled,
} from "./liveSttPcmDebug";

describe("Live STT PCM debug helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes model input PCM as mono 16-bit WAV", async () => {
    const recorder = createLiveSttPcmDebugRecorder(
      4,
      () => new Date("2026-06-30T00:00:00.000Z"),
    );

    recorder.append(new Float32Array([0, 0.5, -1, 1]));
    const recording = recorder.finish();

    expect(recording).not.toBeNull();
    expect(recording?.filename).toBe(
      "orbit-live-stt-model-input-2026-06-30T00-00-00-000Z.wav",
    );
    expect(recording).toMatchObject({
      sampleRate: 4,
      durationMs: 1000,
      peak: 1,
      rms: 0.75,
    });

    const view = await readWav(recording!.blob);
    expect(readAscii(view, 0, 4)).toBe("RIFF");
    expect(readAscii(view, 8, 4)).toBe("WAVE");
    expect(readAscii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(4);
    expect(view.getUint16(34, true)).toBe(16);
    expect(readAscii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(8);
    expect(readPcm16Samples(view)).toEqual([0, 16384, -32768, 32767]);
  });

  it("keeps only the last 10 seconds of PCM samples", async () => {
    const recorder = createLiveSttPcmDebugRecorder(1);
    recorder.append(new Float32Array([0, 0.01, 0.02, 0.03, 0.04]));
    recorder.append(
      new Float32Array([0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11]),
    );

    const recording = recorder.finish();
    const samples = readPcm16Samples(await readWav(recording!.blob));

    expect(recording?.durationMs).toBe(10000);
    expect(samples).toEqual([
      toPcm16(0.02),
      toPcm16(0.03),
      toPcm16(0.04),
      toPcm16(0.05),
      toPcm16(0.06),
      toPcm16(0.07),
      toPcm16(0.08),
      toPcm16(0.09),
      toPcm16(0.1),
      toPcm16(0.11),
    ]);
  });

  it("returns null when no PCM samples were captured", () => {
    const recorder = createLiveSttPcmDebugRecorder(16000);

    expect(recorder.finish()).toBeNull();
  });

  it("reads the PCM debug flag defensively", () => {
    expect(isLiveSttPcmDebugEnabled(null)).toBe(false);
    expect(
      isLiveSttPcmDebugEnabled({
        getItem: vi.fn(() => "1"),
      }),
    ).toBe(true);
    expect(
      isLiveSttPcmDebugEnabled({
        getItem: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
      }),
    ).toBe(false);
  });

  it("returns false when the browser localStorage getter is blocked", () => {
    const blockedWindow = {};
    Object.defineProperty(blockedWindow, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    vi.stubGlobal("window", blockedWindow);

    expect(isLiveSttPcmDebugEnabled()).toBe(false);
  });

  it("calculates PCM peak and RMS", () => {
    expect(calculatePcmStats(new Float32Array([0, -0.5, 0.25]))).toEqual({
      peak: 0.5,
      rms: Math.sqrt((0.25 + 0.0625) / 3),
    });
  });

  it("normalizes invalid sample rates when encoding WAV", async () => {
    const view = await readWav(
      encodePcm16Wav(new Float32Array([0]), Number.NaN),
    );

    expect(view.getUint32(24, true)).toBe(16000);
  });
});

async function readWav(blob: Blob) {
  return new DataView(await blob.arrayBuffer());
}

function readAscii(view: DataView, offset: number, length: number) {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index)),
  ).join("");
}

function readPcm16Samples(view: DataView) {
  const length = view.getUint32(40, true) / 2;
  return Array.from({ length }, (_, index) =>
    view.getInt16(44 + index * 2, true),
  );
}

function toPcm16(sample: number) {
  return sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
}
