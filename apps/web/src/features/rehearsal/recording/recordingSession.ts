export type RecordingSession = {
  recorder: MediaRecorder;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

const preferredAudioMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

export function selectRecordingMimeType(
  recorderCtor: typeof MediaRecorder | undefined = globalThis.MediaRecorder,
) {
  if (!recorderCtor) {
    return null;
  }

  if (typeof recorderCtor.isTypeSupported !== "function") {
    return "audio/webm";
  }

  return (
    preferredAudioMimeTypes.find((mimeType) =>
      recorderCtor.isTypeSupported(mimeType),
    ) ?? "audio/webm"
  );
}

export function createRecordingFile(
  blob: Blob,
  mimeType: string,
  now: Date = new Date(),
) {
  const normalizedMimeType = normalizeRecordingMimeType(mimeType || blob.type);
  const safeTimestamp = now.toISOString().replace(/[:.]/g, "-");
  return new File(
    [blob],
    `rehearsal-${safeTimestamp}.${extensionForMimeType(normalizedMimeType)}`,
    {
      type: normalizedMimeType,
    },
  );
}

export function normalizeRecordingMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() || "audio/webm";
}

export function createRecordingSession(
  stream: MediaStream,
  options: {
    recorderCtor?: typeof MediaRecorder;
    now?: () => Date;
    onError: (error: Error) => void;
    onStop: (file: File) => void;
  },
): RecordingSession {
  const Recorder = options.recorderCtor ?? globalThis.MediaRecorder;
  const mimeType = selectRecordingMimeType(Recorder);
  if (!Recorder || !mimeType) {
    throw new Error("MediaRecorder is not supported.");
  }

  const recorder = new Recorder(stream, { mimeType });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  recorder.onerror = () => {
    options.onError(new Error("녹음 중 오류가 발생했습니다."));
  };
  recorder.onstop = () => {
    if (chunks.length === 0) {
      options.onError(new Error("녹음된 오디오가 비어 있습니다."));
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    options.onStop(
      createRecordingFile(blob, mimeType, options.now?.() ?? new Date()),
    );
  };

  return {
    recorder,
    pause: async () => {
      if (recorder.state === "recording") {
        await transitionMediaRecorder(recorder, "paused", "pause", () =>
          recorder.pause(),
        );
      }
    },
    resume: async () => {
      if (recorder.state === "paused") {
        await transitionMediaRecorder(recorder, "recording", "resume", () =>
          recorder.resume(),
        );
      }
    },
    start: () => recorder.start(),
    stop: () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    },
  };
}

export async function runRehearsalPauseSequence(options: {
  pauseRecording?: () => Promise<void>;
  pauseSpeech: () => Promise<void>;
}): Promise<{
  error: unknown | null;
  status: "paused" | "running";
}> {
  let recordingPaused = options.pauseRecording === undefined;

  try {
    if (options.pauseRecording) {
      await options.pauseRecording();
      recordingPaused = true;
    }
    await options.pauseSpeech();
    return { error: null, status: "paused" };
  } catch (error) {
    return {
      error,
      status: recordingPaused ? "paused" : "running",
    };
  }
}

function transitionMediaRecorder(
  recorder: MediaRecorder,
  targetState: RecordingState,
  eventName: "pause" | "resume",
  transition: () => void,
) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      recorder.removeEventListener?.(eventName, handleTransition);
      resolve();
    };
    const handleTransition = () => {
      if (recorder.state === targetState) {
        finish();
      }
    };

    recorder.addEventListener?.(eventName, handleTransition, { once: true });
    try {
      transition();
    } catch (error) {
      recorder.removeEventListener?.(eventName, handleTransition);
      reject(error);
      return;
    }
    if (recorder.state === targetState) {
      finish();
    }
  });
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}
