import {
  IconAlertCircle as AlertCircle,
  IconChevronDown as ChevronDown,
  IconMaximize as Maximize2,
  IconDeviceDesktop as Monitor,
  IconRefresh as RefreshCcw,
  IconX as X,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type {
  DisplayManagerErrorCode,
  DisplayScreenDescriptor,
} from "./displayManager";
import type { PresentationChannelStatus } from "./usePresentationChannelPublisher";

export type SlideDisplayMode = "current-window" | "slide-window";

export type SlideDisplayOptions = {
  autoPlace: boolean;
  displayMode: SlideDisplayMode;
  fullscreen: boolean;
  presenterView: boolean;
  startFromBeginning: boolean;
  targetScreen?: DisplayScreenDescriptor | null;
};

export type OpenSlideDisplayResult = {
  autoPlaced?: boolean;
  displayMode: SlideDisplayMode;
  displayOpened: boolean;
  fullscreenStarted: boolean;
  placementCode?: DisplayManagerErrorCode;
  placementTargetLabel?: string;
};

export type RequestDisplayScreensResult =
  | { ok: true; screens: DisplayScreenDescriptor[] }
  | { code: DisplayManagerErrorCode; ok: false };

export type RequestSlideWindowFullscreenResult =
  | { ok: true }
  | { code: DisplayManagerErrorCode; ok: false };

type DisplayState = "idle" | "opening" | "manual-guide" | "failed";

type RemoteFullscreenState = "idle" | "available" | "requested" | "failed";

type PermissionQuery = (
  descriptor: PermissionDescriptor,
) => Promise<Pick<PermissionStatus, "state">>;

const SCREEN_REQUEST_TIMEOUT_MS = 10000;

const defaultSlideDisplayOptions: SlideDisplayOptions = {
  autoPlace: false,
  displayMode: "slide-window",
  fullscreen: true,
  presenterView: true,
  startFromBeginning: false,
};

export function DisplayControls(props: {
  channelStatus: PresentationChannelStatus;
  onOpenSlideDisplay: (
    options: SlideDisplayOptions,
  ) => Promise<OpenSlideDisplayResult>;
  onRequestDisplayScreens?: () => Promise<RequestDisplayScreensResult>;
  onRequestSlideWindowFullscreen?: () => Promise<RequestSlideWindowFullscreenResult>;
}) {
  const {
    channelStatus,
    onOpenSlideDisplay,
    onRequestDisplayScreens,
    onRequestSlideWindowFullscreen,
  } = props;
  const [displayState, setDisplayState] = useState<DisplayState>("idle");
  const [message, setMessage] = useState("");
  const [dismissedMessage, setDismissedMessage] = useState("");
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [options, setOptions] = useState<SlideDisplayOptions>(
    defaultSlideDisplayOptions,
  );
  const [remoteFullscreenState, setRemoteFullscreenState] =
    useState<RemoteFullscreenState>("idle");
  const [screenMessage, setScreenMessage] = useState("");
  const [screenOptions, setScreenOptions] = useState<DisplayScreenDescriptor[]>(
    [],
  );
  const [selectedScreenIndex, setSelectedScreenIndex] = useState<number | null>(
    null,
  );
  const mountedRef = useRef(true);
  const isRecoverable =
    shouldShowRecoverAction(channelStatus) || displayState === "failed";
  const canUseFullscreenDelegation = canDelegateSlideWindowFullscreen();
  const canStartRemoteFullscreen =
    remoteFullscreenState !== "idle" &&
    canUseFullscreenDelegation &&
    Boolean(onRequestSlideWindowFullscreen);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function openSlideWindow(launchOptions = options) {
    const resolvedLaunchOptions = resolveLaunchOptions(launchOptions);
    // Activation-consuming APIs must start inside the original click before timeout.
    const openSlideDisplayResult = onOpenSlideDisplay(resolvedLaunchOptions);

    setDisplayState("opening");
    setMessage("");
    setDismissedMessage("");
    setIsOptionsOpen(false);
    setRemoteFullscreenState("idle");

    const result = await openSlideDisplayResult;
    if (!mountedRef.current) {
      return;
    }

    if (!result.displayOpened) {
      setDisplayState("failed");
      setMessage(getDisplayControlMessage("popup-blocked"));
      return;
    }

    if (resolvedLaunchOptions.fullscreen && !result.fullscreenStarted) {
      const canRequestRemoteFullscreen =
        result.displayMode === "slide-window" &&
        canUseFullscreenDelegation &&
        Boolean(onRequestSlideWindowFullscreen);

      setRemoteFullscreenState(
        canRequestRemoteFullscreen ? "available" : "idle",
      );
      setDisplayState("manual-guide");
      setMessage(
        result.displayMode === "slide-window"
          ? canRequestRemoteFullscreen
            ? getSlideWindowRemoteFullscreenMessage(result)
            : getSlideWindowLaunchMessage(result)
          : "전체화면 전환이 차단되었습니다. 슬라이드 화면의 전체화면 버튼을 눌러주세요.",
      );
      return;
    }

    setDisplayState("manual-guide");
    setMessage(
      result.displayMode === "slide-window"
        ? getSlideWindowLaunchMessage(result)
        : "현재 창에서 슬라이드쇼를 시작했습니다.",
    );
  }

  async function requestSlideWindowFullscreen() {
    if (!onRequestSlideWindowFullscreen) {
      setRemoteFullscreenState("failed");
      setMessage(getDisplayControlMessage("fullscreen-blocked"));
      return;
    }

    const requestResult = onRequestSlideWindowFullscreen();
    setRemoteFullscreenState("requested");
    setMessage("슬라이드 창에 전체화면 요청을 보냈습니다.");
    setDismissedMessage("");

    const result = await requestResult;
    if (!mountedRef.current) {
      return;
    }

    if (!result.ok) {
      setRemoteFullscreenState("failed");
      setMessage(getDisplayControlMessage(result.code));
    }
  }

  function resolveLaunchOptions(
    launchOptions: SlideDisplayOptions,
  ): SlideDisplayOptions {
    const selectedScreen =
      screenOptions.find(
        (screen) => screen.screenIndex === selectedScreenIndex,
      ) ?? null;
    const targetScreen =
      launchOptions.targetScreen ??
      (selectedScreen && !selectedScreen.isCurrent ? selectedScreen : null);

    return {
      ...launchOptions,
      targetScreen: launchOptions.autoPlace ? targetScreen : null,
    };
  }

  async function requestDisplayScreens() {
    if (!onRequestDisplayScreens) {
      setOptions((current) => ({ ...current, autoPlace: false }));
      setScreenMessage(
        getDisplayControlMessage("window-management-unsupported"),
      );
      return;
    }

    // Window Management permission must be requested inside the original click activation.
    const requestScreensResult = onRequestDisplayScreens();

    setScreenMessage("브라우저 권한을 요청하는 중입니다.");

    const result = await withScreenRequestTimeout(requestScreensResult);
    if (!mountedRef.current) {
      return;
    }

    if (!result.ok) {
      setOptions((current) => ({ ...current, autoPlace: false }));
      setScreenOptions([]);
      setSelectedScreenIndex(null);
      setScreenMessage(getDisplayControlMessage(result.code));
      return;
    }

    setOptions((current) => ({ ...current, autoPlace: true }));
    setScreenOptions(result.screens);
    const defaultScreen = getDefaultAutoPlacementScreen(result.screens);
    setSelectedScreenIndex(defaultScreen?.screenIndex ?? null);
    setScreenMessage(
      defaultScreen
        ? `${defaultScreen?.label ?? "추가 화면"}으로 자동 배치합니다.`
        : "추가 디스플레이를 찾지 못했습니다. 열린 창을 직접 옮겨주세요.",
    );
  }

  async function syncWindowManagementPermission() {
    const permissionState = await queryWindowManagementPermissionState();
    if (!mountedRef.current) return;

    const granted = permissionState === "granted";
    setOptions((current) => ({ ...current, autoPlace: granted }));
    if (granted) {
      void requestDisplayScreens();
      return;
    }

    setScreenOptions([]);
    setSelectedScreenIndex(null);
    setScreenMessage(
      permissionState === "denied"
        ? "Chrome 사이트 설정에서 창 관리 권한을 허용한 뒤 다시 시도해주세요."
        : "",
    );
  }

  function handleWindowManagementToggle(checked: boolean) {
    if (checked) {
      void requestDisplayScreens();
      return;
    }

    setScreenMessage(
      "권한 해제는 Chrome 주소창의 사이트 정보에서 창 관리 권한을 변경해주세요.",
    );
  }

  function toggleDisplayOptions() {
    const nextOpen = !isOptionsOpen;
    setIsOptionsOpen(nextOpen);
    if (nextOpen) void syncWindowManagementPermission();
  }

  function setPresenterView(enabled: boolean) {
    setOptions((current) => ({
      ...current,
      autoPlace: enabled ? current.autoPlace : false,
      displayMode: enabled ? "slide-window" : current.displayMode,
      presenterView: enabled,
    }));
    if (enabled) void syncWindowManagementPermission();
  }

  function setDisplayMode(displayMode: SlideDisplayMode) {
    setOptions((current) => ({
      ...current,
      displayMode,
      presenterView:
        displayMode === "current-window" ? false : current.presenterView,
    }));
  }

  return (
    <section
      className="presenter-display-controls"
      aria-label="슬라이드 창 표시 제어"
    >
      {canStartRemoteFullscreen ? (
        <button
          className="presenter-display-fullscreen-start"
          type="button"
          onClick={() => void requestSlideWindowFullscreen()}
        >
          <Maximize2 size={15} />
          슬라이드쇼 전체화면
        </button>
      ) : null}
      <div className="presenter-display-split">
        <button
          className="presenter-display-primary"
          type="button"
          onClick={() => void openSlideWindow()}
        >
          {isRecoverable ? <RefreshCcw size={16} /> : <Monitor size={16} />}
          {isRecoverable ? "슬라이드 창 다시 열기" : "슬라이드 창 열기"}
        </button>
        <button
          aria-expanded={isOptionsOpen}
          aria-label="프레젠테이션 옵션"
          className="presenter-display-options-toggle"
          title="프레젠테이션 옵션"
          type="button"
          onClick={toggleDisplayOptions}
        >
          <ChevronDown size={15} />
        </button>
        {isOptionsOpen ? (
        <div
          aria-label="프레젠테이션 디스플레이 옵션"
          className="presenter-display-options-popover"
          role="dialog"
        >
          <div className="presenter-display-options-header">
            <strong>
              <Monitor size={20} />
              디스플레이 옵션
            </strong>
          </div>
          <section className="presenter-display-options-section">
            <span className="presenter-display-options-section-title">
              발표자 보기 모드
            </span>
            <label className="presenter-display-option-row presenter-display-option-row-description">
              <input
                checked={options.presenterView}
                type="checkbox"
                onChange={(event) =>
                  setPresenterView(event.currentTarget.checked)
                }
              />
              <span>
                <strong>발표자 보기 모드 사용</strong>
                <small>발표자 노트 및 핵심 키워드로 슬라이드쇼 시작</small>
              </span>
            </label>
            {options.presenterView ? (
              <label className="presenter-display-switch-row">
                <span>추가 디스플레이에 슬라이드쇼 표시 권한 허용</span>
                <input
                  checked={options.autoPlace}
                  className="presenter-display-switch"
                  type="checkbox"
                  onChange={(event) =>
                    handleWindowManagementToggle(event.currentTarget.checked)
                  }
                />
              </label>
            ) : null}
          </section>
          {options.presenterView && (options.autoPlace || screenMessage) ? (
            <div className="presenter-display-screen-picker">
              {screenOptions.length > 0 ? (
                <div
                  className="presenter-display-screen-options"
                  role="radiogroup"
                  aria-label="발표 모니터 선택"
                >
                  {screenOptions.map((screen) => (
                    <label key={screen.screenIndex}>
                      <input
                        checked={selectedScreenIndex === screen.screenIndex}
                        name="presentation-target-screen"
                        type="radio"
                        onChange={() => {
                          setSelectedScreenIndex(screen.screenIndex);
                          setScreenMessage(
                            `${screen.label}으로 자동 표시합니다.`,
                          );
                        }}
                      />
                      <span>
                        <strong>{screen.label}</strong>
                        <small>
                          {screen.width} x {screen.height}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
              {screenMessage ? <p>{screenMessage}</p> : null}
            </div>
          ) : null}
          <section className="presenter-display-options-section">
            <span className="presenter-display-options-section-title">
              슬라이드 쇼
            </span>
            <label className="presenter-display-option-row">
              <input
                checked={options.startFromBeginning}
                type="checkbox"
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setOptions((current) => ({
                    ...current,
                    startFromBeginning: checked,
                  }));
                }}
              />
              <span>
                <strong>처음부터 시작</strong>
              </span>
            </label>
            <label className="presenter-display-option-row">
              <input
                checked={options.fullscreen}
                type="checkbox"
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setOptions((current) => ({
                    ...current,
                    fullscreen: checked,
                  }));
                }}
              />
              <span>
                <strong>전체화면으로 띄우기</strong>
              </span>
            </label>
            {options.fullscreen ? (
              <div
                className="presenter-display-option-group"
                role="radiogroup"
                aria-label="슬라이드쇼 표시 방식"
              >
                <span>표시 위치</span>
                <label>
                  <input
                    checked={options.displayMode === "slide-window"}
                    name="slide-display-mode"
                    type="radio"
                    onChange={() => setDisplayMode("slide-window")}
                  />
                  <span>새 창</span>
                </label>
                <label>
                  <input
                    checked={options.displayMode === "current-window"}
                    name="slide-display-mode"
                    type="radio"
                    onChange={() => setDisplayMode("current-window")}
                  />
                  <span>현재 창</span>
                </label>
              </div>
            ) : null}
          </section>
          <div className="presenter-display-options-actions">
            <button type="button" onClick={() => void openSlideWindow(options)}>
              <span aria-hidden="true" className="material-symbols-outlined">
                slideshow
              </span>
              슬라이드쇼 시작
            </button>
          </div>
        </div>
        ) : null}
      </div>
      {message && message !== dismissedMessage ? (
        <p className="presenter-display-message">
          <AlertCircle size={15} />
          <span>{message}</span>
          <button
            type="button"
            aria-label="안내 닫기"
            title="안내 닫기"
            onClick={() => setDismissedMessage(message)}
          >
            <X size={14} />
          </button>
        </p>
      ) : null}
    </section>
  );
}

export function shouldShowRecoverAction(status: PresentationChannelStatus) {
  return status === "closed" || status === "stale" || status === "failed";
}

export function getDefaultAutoPlacementScreen(
  screens: DisplayScreenDescriptor[],
) {
  return screens.find((screen) => !screen.isCurrent) ?? null;
}

export function canDelegateSlideWindowFullscreen(userAgent = readUserAgent()) {
  const edgeMajor = readBrowserMajor(userAgent, /\bEdg\/(\d+)/);
  if (edgeMajor !== null) {
    return edgeMajor >= 104;
  }

  const chromeMajor = readBrowserMajor(
    userAgent,
    /\b(?:Chrome|Chromium)\/(\d+)/,
  );
  return (
    chromeMajor !== null && chromeMajor >= 104 && !/\bOPR\//.test(userAgent)
  );
}

export async function queryWindowManagementPermissionState(
  query: PermissionQuery | undefined = getBrowserPermissionQuery(),
): Promise<PermissionState> {
  if (!query) return "prompt";

  for (const name of ["window-management", "window-placement"]) {
    try {
      return (await query({ name: name as PermissionName })).state;
    } catch {
      // Chrome used window-placement before window-management.
    }
  }

  return "prompt";
}

export function getDisplayControlMessage(code: DisplayManagerErrorCode) {
  const messages: Record<DisplayManagerErrorCode, string> = {
    "fullscreen-blocked":
      "슬라이드 창을 열었습니다. 열린 슬라이드 창의 전체화면 버튼을 눌러주세요.",
    "permission-denied":
      "Chrome에서 창 관리 권한이 차단되었습니다. 주소창 왼쪽의 사이트 정보 → 사이트 설정 → 창 관리를 허용한 뒤 다시 시도해주세요.",
    "placement-failed":
      "자동 배치에 실패했습니다. 열린 창을 발표 모니터로 직접 옮긴 뒤 전체화면으로 전환해주세요.",
    "popup-blocked":
      "팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 열어주세요.",
    "window-management-unsupported":
      "이 브라우저는 자동 화면 배치를 지원하지 않습니다. 열린 창을 발표 모니터로 직접 옮겨주세요.",
  };

  return messages[code];
}

function withScreenRequestTimeout(
  promise: Promise<RequestDisplayScreensResult>,
): Promise<RequestDisplayScreensResult> {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      resolve({ code: "placement-failed", ok: false });
    }, SCREEN_REQUEST_TIMEOUT_MS);

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      () => {
        window.clearTimeout(timeoutId);
        resolve({ code: "placement-failed", ok: false });
      },
    );
  });
}

function getSlideWindowLaunchMessage(result: OpenSlideDisplayResult) {
  if (result.placementCode && result.placementCode !== "fullscreen-blocked") {
    return getDisplayControlMessage(result.placementCode);
  }

  if (result.autoPlaced && result.placementTargetLabel) {
    return `${result.placementTargetLabel}로 슬라이드 창을 옮겼습니다. 열린 슬라이드 창의 전체화면 버튼을 눌러주세요.`;
  }

  return getDisplayControlMessage("fullscreen-blocked");
}

function getSlideWindowRemoteFullscreenMessage(result: OpenSlideDisplayResult) {
  if (result.placementCode && result.placementCode !== "fullscreen-blocked") {
    return getDisplayControlMessage(result.placementCode);
  }

  if (result.autoPlaced && result.placementTargetLabel) {
    return `${result.placementTargetLabel}로 슬라이드 창을 옮겼습니다. 연결되면 이 화면에서 전체화면 시작을 누르세요.`;
  }

  return "슬라이드 창을 열었습니다. 연결되면 이 화면에서 전체화면 시작을 누르세요.";
}

function readBrowserMajor(userAgent: string, pattern: RegExp) {
  const match = userAgent.match(pattern);
  if (!match?.[1]) {
    return null;
  }

  const major = Number(match[1]);
  return Number.isFinite(major) ? major : null;
}

function readUserAgent() {
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

function getBrowserPermissionQuery(): PermissionQuery | undefined {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return undefined;
  }

  return navigator.permissions.query.bind(navigator.permissions);
}
