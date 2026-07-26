const processorName = "orbit-live-stt-pcm-capture";
const defaultFrameSize = 512;

class OrbitLiveSttPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const requestedFrameSize = Number(options?.processorOptions?.frameSize);
    this.frameSize =
      Number.isFinite(requestedFrameSize) && requestedFrameSize > 0
        ? Math.floor(requestedFrameSize)
        : defaultFrameSize;
    this.samples = new Float32Array(this.frameSize);
    this.offset = 0;
    this.isDisposed = false;

    this.port.onmessage = (event) => {
      if (event.data?.type === "dispose") {
        this.samples = new Float32Array(this.frameSize);
        this.offset = 0;
        this.isDisposed = true;
      }
    };
  }

  process(inputs, outputs) {
    writeSilence(outputs);

    if (this.isDisposed) {
      return false;
    }

    const input = inputs[0]?.[0];
    if (!input) {
      return true;
    }

    let inputOffset = 0;
    while (inputOffset < input.length) {
      const writableSamples = Math.min(
        this.frameSize - this.offset,
        input.length - inputOffset
      );
      this.samples.set(
        input.subarray(inputOffset, inputOffset + writableSamples),
        this.offset
      );
      this.offset += writableSamples;
      inputOffset += writableSamples;

      if (this.offset === this.frameSize) {
        this.flushFrame();
      }
    }

    return true;
  }

  flushFrame() {
    const samples = this.samples;
    this.samples = new Float32Array(this.frameSize);
    this.offset = 0;
    this.port.postMessage(
      {
        type: "audio-frame",
        sampleRate,
        samples
      },
      [samples.buffer]
    );
  }
}

function writeSilence(outputs) {
  for (const output of outputs) {
    for (const channel of output) {
      channel.fill(0);
    }
  }
}

registerProcessor(processorName, OrbitLiveSttPcmCaptureProcessor);
