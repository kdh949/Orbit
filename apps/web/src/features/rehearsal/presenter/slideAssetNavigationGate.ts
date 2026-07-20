export type SlideNavigationSource = "auto" | "manual" | "remote-goto";

export type SlideNavigationRequest = {
  source: SlideNavigationSource;
  stepIndex: number;
  targetSlideIndex: number;
};

export type SlideNavigationResult = "committed" | "ignored" | "superseded";

export function createSlideAssetNavigationGate(options: {
  commit: (request: SlideNavigationRequest) => void;
  onPendingChange: (pending: boolean) => void;
  prepare: (request: SlideNavigationRequest) => Promise<unknown>;
}) {
  let pending = false;
  let requestId = 0;

  return {
    cancel() {
      requestId += 1;
      if (pending) {
        pending = false;
        options.onPendingChange(false);
      }
    },
    isPending() {
      return pending;
    },
    async request(
      request: SlideNavigationRequest
    ): Promise<SlideNavigationResult> {
      if (pending && request.source !== "remote-goto") {
        return "ignored";
      }

      const currentRequestId = ++requestId;
      if (!pending) {
        pending = true;
        options.onPendingChange(true);
      }

      try {
        await options.prepare(request);
      } catch {
        // Asset preparation failures use the renderer's existing placeholder.
      }
      if (currentRequestId !== requestId) {
        return "superseded";
      }

      options.commit(request);
      pending = false;
      options.onPendingChange(false);
      return "committed";
    }
  };
}

export type SlideAssetNavigationGate = ReturnType<
  typeof createSlideAssetNavigationGate
>;
