export const liveSttPcmDebugStorageKey = "orbit.liveStt.debugPcmDump";

const defaultSampleRate = 16_000;
const maxDebugPcmDurationSeconds = 10;
const wavHeaderByteLength = 44;

export type LiveSttDebugPcmRecording = {
  blob: Blob;
  filename: string;
  sampleRate: number;
  durationMs: number;
  peak: number;
  rms: number;
};

export function isLiveSttPcmDebugEnabled(
  storage: Pick<Storage, "getItem"> | null = readBrowserLocalStorage(),
) {
  try {
    return storage?.getItem(liveSttPcmDebugStorageKey) === "1";
  } catch {
    return false;
  }
}

export function createLiveSttPcmDebugRecorder(
  sampleRate: number,
  now: () => Date = () => new Date(),
) {
  const normalizedSampleRate = normalizeSampleRate(sampleRate);
  const maxSamples = normalizedSampleRate * maxDebugPcmDurationSeconds;
  const buffer = new Float32Array(maxSamples);
  let writeIndex = 0;
  let sampleCount = 0;

  return {
    append(samples: Float32Array) {
      if (samples.length === 0) {
        return;
      }

      if (samples.length >= maxSamples) {
        buffer.set(samples.subarray(samples.length - maxSamples));
        writeIndex = 0;
        sampleCount = maxSamples;
        return;
      }

      let offset = 0;
      while (offset < samples.length) {
        const writable = Math.min(
          samples.length - offset,
          maxSamples - writeIndex,
        );
        buffer.set(samples.subarray(offset, offset + writable), writeIndex);
        writeIndex = (writeIndex + writable) % maxSamples;
        offset += writable;
      }
      sampleCount = Math.min(maxSamples, sampleCount + samples.length);
    },

    finish(): LiveSttDebugPcmRecording | null {
      if (sampleCount === 0) {
        return null;
      }

      const samples = readBufferedSamples(buffer, writeIndex, sampleCount);
      const stats = calculatePcmStats(samples);
      return {
        // 디버그 WAV는 브라우저에서만 다운로드하며 서버로 보내지 않는다.
        blob: encodePcm16Wav(samples, normalizedSampleRate),
        filename: createLiveSttDebugPcmFilename(now()),
        sampleRate: normalizedSampleRate,
        durationMs: Math.round((samples.length / normalizedSampleRate) * 1000),
        peak: stats.peak,
        rms: stats.rms,
      };
    },

    clear() {
      writeIndex = 0;
      sampleCount = 0;
      buffer.fill(0);
    },
  };
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number) {
  const normalizedSampleRate = normalizeSampleRate(sampleRate);
  const dataByteLength = samples.length * 2;
  const arrayBuffer = new ArrayBuffer(wavHeaderByteLength + dataByteLength);
  const view = new DataView(arrayBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, normalizedSampleRate, true);
  view.setUint32(28, normalizedSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataByteLength, true);

  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(
      wavHeaderByteLength + index * 2,
      floatToPcm16(samples[index] ?? 0),
      true,
    );
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export function calculatePcmStats(samples: Float32Array) {
  if (samples.length === 0) {
    return { peak: 0, rms: 0 };
  }

  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    sumSquares += sample * sample;
  }

  return {
    peak,
    rms: Math.sqrt(sumSquares / samples.length),
  };
}

function readBrowserLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeSampleRate(sampleRate: number) {
  return Number.isFinite(sampleRate) && sampleRate > 0
    ? Math.round(sampleRate)
    : defaultSampleRate;
}

function readBufferedSamples(
  buffer: Float32Array,
  writeIndex: number,
  sampleCount: number,
) {
  if (sampleCount < buffer.length) {
    return buffer.slice(0, sampleCount);
  }

  const samples = new Float32Array(sampleCount);
  samples.set(buffer.subarray(writeIndex));
  samples.set(buffer.subarray(0, writeIndex), buffer.length - writeIndex);
  return samples;
}

function createLiveSttDebugPcmFilename(createdAt: Date) {
  const timestamp = createdAt.toISOString().replace(/[:.]/g, "-");
  return `orbit-live-stt-model-input-${timestamp}.wav`;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function floatToPcm16(sample: number) {
  const clipped = Math.max(-1, Math.min(1, sample));
  return clipped < 0
    ? Math.round(clipped * 0x8000)
    : Math.round(clipped * 0x7fff);
}
