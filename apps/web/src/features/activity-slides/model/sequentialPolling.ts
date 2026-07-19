export function startSequentialPolling(
  task: () => Promise<void>,
  delayMs: number
): () => void {
  let cancelled = false;
  let timerId: ReturnType<typeof globalThis.setTimeout> | null = null;

  const run = async () => {
    try {
      await task();
    } finally {
      if (!cancelled) {
        timerId = globalThis.setTimeout(() => void run(), delayMs);
      }
    }
  };

  void run();

  return () => {
    cancelled = true;
    if (timerId !== null) globalThis.clearTimeout(timerId);
  };
}
