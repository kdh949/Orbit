export type SlideshowPerfProbeResult = {
  averageFrameMs: number;
  droppedFrameCount: number;
  measuredFrameCount: number;
};

export function measureSlideshowFrameCadence(args: {
  durationMs?: number;
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
} = {}) {
  const durationMs = args.durationMs ?? 1_000;
  const now =
    args.now ??
    (() =>
      typeof performance === "undefined" ? Date.now() : performance.now());
  const requestFrame =
    args.requestFrame ??
    ((callback: FrameRequestCallback) => requestAnimationFrame(callback));
  const cancelFrame =
    args.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));

  return new Promise<SlideshowPerfProbeResult>((resolve) => {
    const startedAt = now();
    const frameDurations: number[] = [];
    let previousFrameAt = startedAt;
    let frameHandle: number | null = null;

    const finish = () => {
      if (frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }

      const totalFrameMs = frameDurations.reduce(
        (total, duration) => total + duration,
        0
      );

      resolve({
        averageFrameMs: frameDurations.length
          ? totalFrameMs / frameDurations.length
          : 0,
        droppedFrameCount: frameDurations.filter((duration) => duration > 34).length,
        measuredFrameCount: frameDurations.length
      });
    };

    const tick: FrameRequestCallback = (timestamp) => {
      frameDurations.push(timestamp - previousFrameAt);
      previousFrameAt = timestamp;

      if (timestamp - startedAt >= durationMs) {
        finish();
        return;
      }

      frameHandle = requestFrame(tick);
    };

    frameHandle = requestFrame(tick);
  });
}
