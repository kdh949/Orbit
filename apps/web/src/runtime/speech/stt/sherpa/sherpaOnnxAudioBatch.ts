export type SherpaAudioFrame = {
  sampleRate: number;
  samples: Float32Array;
};

export type SherpaAudioFrameBatch = {
  frames: SherpaAudioFrame[];
  sampleCount: number;
};

export class SherpaAudioFrameBatcher {
  private frames: SherpaAudioFrame[] = [];
  private sampleCount = 0;
  private readonly decodeBatchSamples: number;

  constructor(decodeBatchSamples: number) {
    this.decodeBatchSamples = normalizeDecodeBatchSamples(decodeBatchSamples);
  }

  push(frame: SherpaAudioFrame) {
    this.frames.push(frame);
    this.sampleCount += frame.samples.length;

    if (this.sampleCount < this.decodeBatchSamples) {
      return null;
    }

    return this.flush();
  }

  flush(): SherpaAudioFrameBatch | null {
    if (this.frames.length === 0) {
      return null;
    }

    const batch = {
      frames: this.frames,
      sampleCount: this.sampleCount
    };
    this.reset();
    return batch;
  }

  reset() {
    this.frames = [];
    this.sampleCount = 0;
  }
}

function normalizeDecodeBatchSamples(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.max(1, Math.round(value));
}
