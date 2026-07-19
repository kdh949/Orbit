export type EditorSaveRetryReason = "auto" | "manual" | "online";

type EditorSaveRetryCoordinatorOptions = {
  flushNext: () => Promise<void>;
  hasPending: () => boolean;
  onFailure: (error: unknown, reason: EditorSaveRetryReason) => void;
  onStart: (reason: EditorSaveRetryReason) => void;
  onSuccess: (reason: EditorSaveRetryReason) => void;
};

export function createEditorSaveRetryCoordinator(options: EditorSaveRetryCoordinatorOptions) {
  let inFlight: Promise<void> | null = null;

  function retry(reason: EditorSaveRetryReason): Promise<void> {
    if (inFlight) return inFlight;
    if (!options.hasPending()) return Promise.resolve();

    options.onStart(reason);
    inFlight = (async () => {
      try {
        while (options.hasPending()) {
          await options.flushNext();
        }
        options.onSuccess(reason);
      } catch (error) {
        options.onFailure(error, reason);
        throw error;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  return { retry };
}
