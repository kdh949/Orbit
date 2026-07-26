export type ScreenShareSourceIntent = "tab-or-window" | "monitor";

export type ScreenShareCaptureErrorCode =
  | "unsupported"
  | "cancelled"
  | "activation-required"
  | "not-readable"
  | "monitor-not-allowed"
  | "capture-failed";

export class ScreenShareCaptureError extends Error {
  readonly code: ScreenShareCaptureErrorCode;

  constructor(code: ScreenShareCaptureErrorCode, message: string) {
    super(message);
    this.name = "ScreenShareCaptureError";
    this.code = code;
  }
}

export type ScreenShareDisplaySurface = "browser" | "window" | "monitor";

export type ScreenShareCapture = {
  displaySurface?: ScreenShareDisplaySurface;
  focusCapturedSurface: () => void;
  stream: MediaStream;
  stop: () => void;
  subscribeEnded: (listener: () => void) => () => void;
};

export type ScreenShareCapturePort = {
  isSupported: () => boolean;
  start: (intent: ScreenShareSourceIntent) => Promise<ScreenShareCapture>;
};

type CaptureControllerLike = {
  setFocusBehavior: (behavior: "focus-captured-surface") => void;
};

type ChromeDisplayMediaOptions = DisplayMediaStreamOptions & {
  controller?: CaptureControllerLike;
  monitorTypeSurfaces?: "include" | "exclude";
  selfBrowserSurface?: "exclude";
  surfaceSwitching?: "include" | "exclude";
  systemAudio?: "exclude";
};

type ScreenShareBrowserPort = {
  createCaptureController?: () => CaptureControllerLike;
  getDisplayMedia?: (options: ChromeDisplayMediaOptions) => Promise<MediaStream>;
};

export function createScreenShareCapturePort(
  browserPort: ScreenShareBrowserPort = createBrowserScreenSharePort(),
): ScreenShareCapturePort {
  return {
    isSupported: () => typeof browserPort.getDisplayMedia === "function",
    start: async (intent) => {
      if (typeof browserPort.getDisplayMedia !== "function") {
        throw new ScreenShareCaptureError(
          "unsupported",
          "이 브라우저는 화면 공유를 지원하지 않습니다.",
        );
      }

      const controller = browserPort.createCaptureController?.();
      let stream: MediaStream;
      try {
        stream = await browserPort.getDisplayMedia(
          createDisplayMediaOptions(intent, controller),
        );
      } catch (cause) {
        throw mapScreenShareCaptureError(cause);
      }

      const displaySurface = readDisplaySurface(stream);
      if (intent === "tab-or-window" && displaySurface === "monitor") {
        stopMediaStream(stream);
        throw new ScreenShareCaptureError(
          "monitor-not-allowed",
          "기본 공유에서는 브라우저의 탭 또는 앱 창을 선택해주세요.",
        );
      }

      return createScreenShareCapture({ controller, displaySurface, stream });
    },
  };
}

export function createDisplayMediaOptions(
  intent: ScreenShareSourceIntent,
  controller?: CaptureControllerLike,
): ChromeDisplayMediaOptions {
  return {
    audio: false,
    controller,
    monitorTypeSurfaces: intent === "monitor" ? "include" : "exclude",
    selfBrowserSurface: "exclude",
    surfaceSwitching: intent === "tab-or-window" ? "include" : "exclude",
    systemAudio: "exclude",
    video: {
      displaySurface: intent === "monitor" ? "monitor" : "browser",
      frameRate: { ideal: 30, max: 60 },
      height: { ideal: 3840 },
      width: { ideal: 3840 },
    },
  };
}

export function mapScreenShareCaptureError(
  cause: unknown,
): ScreenShareCaptureError {
  if (cause instanceof ScreenShareCaptureError) {
    return cause;
  }

  const name = readErrorName(cause);
  if (name === "NotAllowedError") {
    return new ScreenShareCaptureError(
      "cancelled",
      "공유가 취소되었거나 권한이 거부되었습니다.",
    );
  }
  if (name === "InvalidStateError") {
    return new ScreenShareCaptureError(
      "activation-required",
      "버튼을 다시 눌러 공유를 시작해주세요.",
    );
  }
  if (name === "NotReadableError") {
    return new ScreenShareCaptureError(
      "not-readable",
      "선택한 화면을 공유할 수 없습니다.",
    );
  }

  return new ScreenShareCaptureError(
    "capture-failed",
    "화면 공유를 시작하지 못했습니다.",
  );
}

function createScreenShareCapture(args: {
  controller?: CaptureControllerLike;
  displaySurface?: ScreenShareDisplaySurface;
  stream: MediaStream;
}): ScreenShareCapture {
  const listeners = new Set<() => void>();
  const tracks = args.stream.getTracks();
  let ended = false;

  const notifyEnded = () => {
    if (ended) return;
    ended = true;
    for (const listener of listeners) listener();
    listeners.clear();
  };
  for (const track of tracks) {
    track.addEventListener("ended", notifyEnded, { once: true });
  }

  return {
    displaySurface: args.displaySurface,
    focusCapturedSurface: () => {
      try {
        args.controller?.setFocusBehavior("focus-captured-surface");
      } catch {
        // Focus is a convenience only; capture remains usable when denied.
      }
    },
    stream: args.stream,
    stop: () => {
      if (ended) return;
      for (const track of tracks) {
        track.removeEventListener("ended", notifyEnded);
        track.stop();
      }
      notifyEnded();
    },
    subscribeEnded: (listener) => {
      if (ended) {
        listener();
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function readDisplaySurface(
  stream: MediaStream,
): ScreenShareDisplaySurface | undefined {
  const value = stream.getVideoTracks()[0]?.getSettings().displaySurface;
  return value === "browser" || value === "window" || value === "monitor"
    ? value
    : undefined;
}

function stopMediaStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function readErrorName(cause: unknown) {
  return cause && typeof cause === "object" && "name" in cause
    ? String(cause.name)
    : "";
}

function createBrowserScreenSharePort(): ScreenShareBrowserPort {
  const mediaDevices =
    typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  const CaptureControllerConstructor =
    typeof window === "undefined"
      ? undefined
      : (
          window as unknown as {
            CaptureController?: new () => CaptureControllerLike;
          }
        ).CaptureController;

  return {
    createCaptureController: CaptureControllerConstructor
      ? () => new CaptureControllerConstructor()
      : undefined,
    getDisplayMedia:
      typeof mediaDevices?.getDisplayMedia === "function"
        ? (options) => mediaDevices.getDisplayMedia(options)
        : undefined,
  };
}
