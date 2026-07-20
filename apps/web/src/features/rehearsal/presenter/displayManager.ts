import type { PresentationChannelIdentity } from "./presentationChannel";

export type DisplayManagerErrorCode =
  | "fullscreen-blocked"
  | "permission-denied"
  | "placement-failed"
  | "popup-blocked"
  | "window-management-unsupported";

export type DisplayManagerResult<T> =
  | { ok: true; value: T }
  | { code: DisplayManagerErrorCode; message: string; ok: false };

export type DisplayScreenDescriptor = {
  height: number;
  isCurrent: boolean;
  isPrimary: boolean;
  label: string;
  left: number;
  screenIndex: number;
  top: number;
  width: number;
};

type ScreenLike = {
  availHeight?: number;
  availLeft?: number;
  availTop?: number;
  availWidth?: number;
  height: number;
  isPrimary?: boolean;
  label?: string;
  left: number;
  top: number;
  width: number;
};

export type DisplayWindowBounds = {
  availHeight?: number;
  availLeft?: number;
  availTop?: number;
  availWidth?: number;
  height: number;
  left: number;
  top: number;
  width: number;
};

type ScreenDetailsLike = {
  currentScreen?: ScreenLike;
  screens: ScreenLike[];
};

type FullscreenOptionsWithScreen = FullscreenOptions & {
  screen?: ScreenLike;
};

const SCREEN_DETAILS_TIMEOUT_MS = 8000;

export type SlideWindowRef = {
  close?: () => void;
  closed?: boolean;
  focus?: () => void;
  moveTo?: (x: number, y: number) => void;
  postMessage?: (
    message: SlideWindowFullscreenRequestMessage,
    options: SlideWindowPostMessageOptions
  ) => void;
  resizeTo?: (width: number, height: number) => void;
};

export type SlideWindowFullscreenRequestMessage = {
  type: "orbit:enter-fullscreen";
};

type SlideWindowPostMessageOptions = {
  delegate?: "fullscreen";
  targetOrigin: string;
};

export const slideWindowFullscreenRequestType = "orbit:enter-fullscreen";

export type DisplayBrowserPort = {
  getScreenDetails?: () => Promise<ScreenDetailsLike>;
  open: (url: string, target: string, features?: string) => SlideWindowRef | null;
  requestFullscreen?: (
    target: Element,
    options?: FullscreenOptionsWithScreen
  ) => Promise<void>;
};

export type OpenSlideWindowOptions = {
  screen?: DisplayScreenDescriptor | null;
  target?: string;
};

export function createDisplayManager(port: DisplayBrowserPort = createBrowserDisplayPort()) {
  let cachedScreenDetails: ScreenDetailsLike | null = null;

  return {
    getCapabilities: () => ({
      canOpenWindow: typeof port.open === "function",
      canRequestFullscreen: typeof port.requestFullscreen === "function",
      canUseWindowManagement: typeof port.getScreenDetails === "function"
    }),
    listExternalScreens: async (): Promise<DisplayManagerResult<DisplayScreenDescriptor[]>> => {
      if (typeof port.getScreenDetails !== "function") {
        return createDisplayError(
          "window-management-unsupported",
          "이 브라우저는 화면 자동 배치를 지원하지 않습니다."
        );
      }

      try {
        const details = await withScreenDetailsTimeout(port.getScreenDetails());
        cachedScreenDetails = details;
        const currentScreen = details.currentScreen;
        const screens = details.screens.map((screen, screenIndex) =>
          toScreenDescriptor(screen, screenIndex, currentScreen)
        );

        return {
          ok: true,
          value: screens
        };
      } catch (cause) {
        return createDisplayError(
          isPermissionDenied(cause) ? "permission-denied" : "placement-failed",
          "화면 정보를 가져오지 못했습니다."
        );
      }
    },
    getCurrentScreen: (): DisplayWindowBounds | null =>
      snapshotWindowBounds(cachedScreenDetails?.currentScreen),
    getLiveScreen: (screenIndex: number): DisplayWindowBounds | null =>
      cachedScreenDetails?.screens[screenIndex] ?? null,
    openSlideWindow: (
      identity: PresentationChannelIdentity,
      options: OpenSlideWindowOptions = {}
    ): DisplayManagerResult<SlideWindowRef> => {
      const windowRef = port.open(
        buildPresentWindowUrl(identity),
        options.target ?? "orbit-present-window",
        buildSlideWindowFeatures(options.screen ?? null)
      );

      if (!windowRef) {
        return createDisplayError(
          "popup-blocked",
          "브라우저가 슬라이드 창 팝업을 차단했습니다."
        );
      }

      windowRef.focus?.();
      return { ok: true, value: windowRef };
    },
    openPresenterRemoteWindow: (
      url: string,
      options: { screen?: DisplayWindowBounds | null; target?: string } = {}
    ): DisplayManagerResult<SlideWindowRef> => {
      const windowRef = port.open(
        url,
        options.target ?? `orbit-presenter-remote-${Date.now()}`,
        buildPresenterRemoteWindowFeatures(options.screen ?? null)
      );

      if (!windowRef) {
        return createDisplayError(
          "popup-blocked",
          "브라우저가 발표자 창 팝업을 차단했습니다."
        );
      }

      windowRef.focus?.();
      return { ok: true, value: windowRef };
    },
    placeOnScreen: (
      windowRef: SlideWindowRef,
      screen: DisplayScreenDescriptor
    ): DisplayManagerResult<void> => {
      try {
        windowRef.moveTo?.(screen.left, screen.top);
        windowRef.resizeTo?.(screen.width, screen.height);
        windowRef.focus?.();
        return { ok: true, value: undefined };
      } catch {
        return createDisplayError(
          "placement-failed",
          "슬라이드 창을 선택한 화면으로 이동하지 못했습니다."
        );
      }
    },
    delegateSlideWindowFullscreen: (
      windowRef: SlideWindowRef
    ): DisplayManagerResult<void> => {
      try {
        if (typeof windowRef.postMessage !== "function") {
          return createDisplayError(
            "fullscreen-blocked",
            "슬라이드 창 전체화면을 자동으로 시작하지 못했습니다."
          );
        }

        windowRef.postMessage(
          { type: slideWindowFullscreenRequestType },
          {
            delegate: "fullscreen",
            targetOrigin: readWindowOrigin()
          }
        );
        return { ok: true, value: undefined };
      } catch {
        return createDisplayError(
          "fullscreen-blocked",
          "슬라이드 창 전체화면을 자동으로 시작하지 못했습니다."
        );
      }
    },
    requestFullscreenOnScreen: async (
      target: Element | null,
      screenIndex: number
    ): Promise<DisplayManagerResult<void>> => {
      if (!target || typeof port.requestFullscreen !== "function") {
        return createDisplayError(
          "fullscreen-blocked",
          "발표 모니터 전체화면을 자동으로 시작하지 못했습니다."
        );
      }

      const screen = cachedScreenDetails?.screens[screenIndex];
      if (!screen) {
        return createDisplayError(
          "placement-failed",
          "선택한 발표 모니터 정보를 찾지 못했습니다."
        );
      }

      try {
        await port.requestFullscreen(target, { screen });
        return { ok: true, value: undefined };
      } catch {
        return createDisplayError(
          "fullscreen-blocked",
          "발표 모니터 전체화면을 자동으로 시작하지 못했습니다."
        );
      }
    }
  };
}

function readWindowOrigin() {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

export function buildPresentWindowUrl(identity: PresentationChannelIdentity) {
  return `/present/${encodeURIComponent(identity.deckId)}?sessionId=${encodeURIComponent(
    identity.sessionId
  )}`;
}

export function buildSlideWindowFeatures(screen?: DisplayScreenDescriptor | null) {
  const bounds = screen
    ? {
        height: screen.height,
        left: screen.left,
        top: screen.top,
        width: screen.width
      }
    : {
        height: 720,
        left: undefined,
        top: undefined,
        width: 1280
      };
  const features = ["popup=yes", `width=${bounds.width}`, `height=${bounds.height}`];

  if (typeof bounds.left === "number" && typeof bounds.top === "number") {
    features.push(`left=${bounds.left}`, `top=${bounds.top}`);
  }

  return features.join(",");
}

export function buildPresenterRemoteWindowFeatures(screen?: DisplayWindowBounds | null) {
  const bounds = screen
    ? {
        height: Math.min(screen.availHeight ?? screen.height, 900),
        left: screen.availLeft ?? screen.left,
        top: screen.availTop ?? screen.top,
        width: Math.min(screen.availWidth ?? screen.width, 1512)
      }
    : {
        height: 900,
        left: undefined,
        top: undefined,
        width: 1512
      };
  const features = ["popup=yes", `width=${bounds.width}`, `height=${bounds.height}`];

  if (typeof bounds.left === "number" && typeof bounds.top === "number") {
    features.push(`left=${bounds.left}`, `top=${bounds.top}`);
  }

  return features.join(",");
}

function toScreenDescriptor(
  screen: ScreenLike,
  screenIndex: number,
  currentScreen?: ScreenLike
): DisplayScreenDescriptor {
  const isPrimary = Boolean(screen.isPrimary) || (!currentScreen && screenIndex === 0);
  const isCurrent = isSameScreen(screen, currentScreen);

  return {
    height: screen.availHeight ?? screen.height,
    isCurrent,
    isPrimary,
    label: `${screen.label || `화면 ${screenIndex + 1}`}${isCurrent ? "(현재)" : ""}`,
    left: screen.availLeft ?? screen.left,
    screenIndex,
    top: screen.availTop ?? screen.top,
    width: screen.availWidth ?? screen.width
  };
}

function snapshotWindowBounds(screen?: ScreenLike): DisplayWindowBounds | null {
  if (!screen) {
    return null;
  }

  return {
    availHeight: screen.availHeight,
    availLeft: screen.availLeft,
    availTop: screen.availTop,
    availWidth: screen.availWidth,
    height: screen.height,
    left: screen.left,
    top: screen.top,
    width: screen.width
  };
}

function isSameScreen(screen: ScreenLike, currentScreen?: ScreenLike) {
  if (!currentScreen) {
    return false;
  }

  return (
    screen.left === currentScreen.left &&
    screen.top === currentScreen.top &&
    screen.width === currentScreen.width &&
    screen.height === currentScreen.height
  );
}

function createDisplayError(
  code: DisplayManagerErrorCode,
  message: string
): DisplayManagerResult<never> {
  return { code, message, ok: false };
}

function isPermissionDenied(cause: unknown) {
  return (
    typeof DOMException !== "undefined" &&
    cause instanceof DOMException &&
    (cause.name === "NotAllowedError" || cause.name === "SecurityError")
  );
}

function withScreenDetailsTimeout(promise: Promise<ScreenDetailsLike>) {
  return new Promise<ScreenDetailsLike>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("screen-details-timeout"));
    }, SCREEN_DETAILS_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

function createBrowserDisplayPort(): DisplayBrowserPort {
  const getScreenDetails =
    typeof window !== "undefined" && "getScreenDetails" in window
      ? (
          window as unknown as Window & {
            getScreenDetails: () => Promise<ScreenDetailsLike>;
          }
        ).getScreenDetails.bind(window)
      : undefined;

  return {
    getScreenDetails,
    open: (url, target, features) =>
      typeof window === "undefined" ? null : window.open(url, target, features),
    requestFullscreen: (target, options) => target.requestFullscreen(options)
  };
}
