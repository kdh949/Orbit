import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  canDelegateSlideWindowFullscreen,
  DisplayControls,
  getDisplayControlMessage,
  getDefaultAutoPlacementScreen,
  queryWindowManagementPermissionState,
  shouldShowRecoverAction,
} from "./DisplayControls";

const displayControlsSourcePath = fileURLToPath(
  new URL("./DisplayControls.tsx", import.meta.url),
);

describe("DisplayControls", () => {
  it("renders Korean controls without presenter-only content", () => {
    const html = renderToStaticMarkup(
      <DisplayControls
        channelStatus="idle"
        onOpenSlideDisplay={async () => ({
          displayMode: "slide-window",
          displayOpened: true,
          fullscreenStarted: true,
        })}
      />,
    );

    expect(html).toContain("슬라이드 창 열기");
    expect(html).toContain("프레젠테이션 옵션");
    expect(html).not.toContain("presenter-display-status");
    expect(html).not.toContain("speakerNotes");
    expect(html).not.toContain("Partial transcript");
  });

  it("uses a recover action for stale, closed, or failed channel states", () => {
    expect(shouldShowRecoverAction("stale")).toBe(true);
    expect(shouldShowRecoverAction("closed")).toBe(true);
    expect(shouldShowRecoverAction("failed")).toBe(true);
    expect(shouldShowRecoverAction("connected")).toBe(false);
  });

  it("maps display manager error codes to Korean guidance", () => {
    expect(getDisplayControlMessage("popup-blocked")).toContain("팝업");
    expect(getDisplayControlMessage("permission-denied")).toContain("권한");
    expect(getDisplayControlMessage("window-management-unsupported")).toContain(
      "자동 화면 배치",
    );
    expect(getDisplayControlMessage("fullscreen-blocked")).toContain(
      "전체화면",
    );
    expect(getDisplayControlMessage("placement-failed")).toContain("자동 배치");
  });

  it("detects browsers that support fullscreen capability delegation", () => {
    expect(
      canDelegateSlideWindowFullscreen(
        "Mozilla/5.0 AppleWebKit/537.36 Chrome/104.0.0.0 Safari/537.36",
      ),
    ).toBe(true);
    expect(
      canDelegateSlideWindowFullscreen(
        "Mozilla/5.0 AppleWebKit/537.36 Chrome/103.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
    expect(
      canDelegateSlideWindowFullscreen(
        "Mozilla/5.0 AppleWebKit/537.36 Edg/121.0.0.0 Safari/537.36",
      ),
    ).toBe(true);
    expect(canDelegateSlideWindowFullscreen("Mozilla/5.0 Firefox/128.0")).toBe(
      false,
    );
  });

  it("uses only non-current screens as the auto-placement default", () => {
    expect(
      getDefaultAutoPlacementScreen([
        createScreen({ isCurrent: true, label: "현재 화면", screenIndex: 0 }),
      ]),
    ).toBeNull();
    expect(
      getDefaultAutoPlacementScreen([
        createScreen({ isCurrent: true, label: "현재 화면", screenIndex: 0 }),
        createScreen({ isCurrent: false, label: "발표 화면", screenIndex: 1 }),
      ]),
    ).toMatchObject({ label: "발표 화면", screenIndex: 1 });
  });

  it("reads granted Window Management permission and supports its legacy name", async () => {
    const queriedNames: string[] = [];
    const state = await queryWindowManagementPermissionState(async (descriptor) => {
      queriedNames.push(descriptor.name);
      if (descriptor.name === ("window-management" as PermissionName)) {
        throw new TypeError("unsupported permission name");
      }
      return { state: "granted" };
    });

    expect(state).toBe("granted");
    expect(queriedNames).toEqual(["window-management", "window-placement"]);
  });

  it("starts the slide display request before updating control state", () => {
    const source = fs.readFileSync(displayControlsSourcePath, "utf8");
    const start = source.indexOf("async function openSlideWindow(");
    const end = source.indexOf("return (", start);
    const openSlideWindowBody = source.slice(start, end);

    expect(
      openSlideWindowBody.indexOf("onOpenSlideDisplay(resolvedLaunchOptions)"),
    ).toBeLessThan(openSlideWindowBody.indexOf('setDisplayState("opening")'));
  });

  it("starts the display permission request before showing request progress", () => {
    const source = fs.readFileSync(displayControlsSourcePath, "utf8");
    const start = source.indexOf("async function requestDisplayScreens(");
    const end = source.indexOf("function setPresenterView(", start);
    const requestDisplayScreensBody = source.slice(start, end);

    expect(
      requestDisplayScreensBody.indexOf("onRequestDisplayScreens()"),
    ).toBeLessThan(
      requestDisplayScreensBody.indexOf(
        'setScreenMessage("브라우저 권한을 요청하는 중입니다.")',
      ),
    );
  });

  it("starts the remote fullscreen delegation before updating request state", () => {
    const source = fs.readFileSync(displayControlsSourcePath, "utf8");
    const start = source.indexOf(
      "async function requestSlideWindowFullscreen(",
    );
    const end = source.indexOf("function resolveLaunchOptions(", start);
    const requestFullscreenBody = source.slice(start, end);

    expect(
      requestFullscreenBody.indexOf("onRequestSlideWindowFullscreen()"),
    ).toBeLessThan(
      requestFullscreenBody.indexOf('setRemoteFullscreenState("requested")'),
    );
  });

  it("resets the mounted guard when StrictMode remounts effects", () => {
    const source = fs.readFileSync(displayControlsSourcePath, "utf8");
    const start = source.indexOf("useEffect(");
    const end = source.indexOf("async function openSlideWindow(", start);
    const effectBody = source.slice(start, end);

    expect(effectBody.indexOf("mountedRef.current = true")).toBeGreaterThan(-1);
    expect(effectBody.indexOf("mountedRef.current = true")).toBeLessThan(
      effectBody.indexOf("mountedRef.current = false"),
    );
  });

  it("captures checkbox values before scheduling display option updates", () => {
    const source = fs.readFileSync(displayControlsSourcePath, "utf8");

    expect(source).not.toContain(
      "startFromBeginning: event.currentTarget.checked",
    );
    expect(source).not.toContain("autoPlace: event.currentTarget.checked");
    expect(source).not.toContain("autoPlace: checked");
    expect(source).not.toContain("fullscreen: event.currentTarget.checked");
  });

  it("shows delegated fullscreen only after the slide window connects", () => {
    const source = fs.readFileSync(displayControlsSourcePath, "utf8");
    const start = source.indexOf("const canStartRemoteFullscreen =");
    const end = source.indexOf("useEffect(", start);

    expect(source.slice(start, end)).toContain(
      'channelStatus === "connected"',
    );
  });

  it("turns off automatic placement and clears the selected screen", () => {
    const source = fs.readFileSync(displayControlsSourcePath, "utf8");
    const start = source.indexOf("function handleWindowManagementToggle(");
    const end = source.indexOf("function toggleDisplayOptions(", start);
    const toggleBody = source.slice(start, end);

    expect(toggleBody).toContain("autoPlaceDisabledByUserRef.current = true");
    expect(toggleBody).toContain("autoPlace: false");
    expect(toggleBody).toContain("setScreenOptions([])");
    expect(toggleBody).toContain("setSelectedScreenIndex(null)");
  });
});

function createScreen(options: {
  isCurrent: boolean;
  label: string;
  screenIndex: number;
}) {
  return {
    height: 1080,
    isCurrent: options.isCurrent,
    isPrimary: options.screenIndex === 0,
    label: options.label,
    left: options.screenIndex * 1920,
    screenIndex: options.screenIndex,
    top: 0,
    width: 1920,
  };
}
