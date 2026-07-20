import { expect, test } from "@playwright/test";
import type { Deck } from "@orbit/shared";
import { createAuthenticatedProject } from "./authenticatedProject";

const presenterDeck = {
  deckId: "deck_demo_1",
  projectId: "project_demo_1",
  title: "ORBIT 발표 화면 검증",
  version: 1,
  targetDurationMinutes: 10,
  metadata: { language: "ko", locale: "ko-KR", sourceType: "manual" },
  canvas: {
    preset: "wide-16-9",
    width: 1920,
    height: 1080,
    aspectRatio: "16:9",
  },
  theme: {
    fontFamily: "Inter",
    backgroundColor: "#ffffff",
    textColor: "#15202b",
    accentColor: "#0f766e",
  },
  slides: [
    {
      slideId: "slide_presenter_1",
      order: 1,
      title: "Presenter Window",
      thumbnailUrl: "",
      estimatedSeconds: 60,
      style: {
        layout: "title-content",
        backgroundColor: "#ffffff",
        textColor: "#15202b",
        accentColor: "#0f766e",
      },
      speakerNotes: "이 대본은 슬라이드 창에 노출되면 안 됩니다.",
      elements: [
        {
          elementId: "el_presenter_1",
          type: "text",
          x: 120,
          y: 140,
          width: 980,
          height: 160,
          rotation: 0,
          opacity: 1,
          locked: false,
          props: {
            text: "Presenter Window",
            fontSize: 64,
            fontFamily: "Inter",
            fontWeight: 800,
            color: "#15202b",
            align: "left",
          },
        },
      ],
      keywords: [
        {
          keywordId: "kw_presenter_secret",
          text: "비공개 키워드",
          synonyms: [],
          abbreviations: [],
        },
      ],
      animations: [],
      aiNotes: { emphasisPoints: [], sourceEvidence: [] },
    },
    {
      slideId: "slide_presenter_2",
      order: 2,
      title: "Slide Window",
      thumbnailUrl: "",
      estimatedSeconds: 60,
      style: {
        layout: "closing",
        backgroundColor: "#f8fafc",
        textColor: "#15202b",
        accentColor: "#0f766e",
      },
      speakerNotes: "두 번째 슬라이드 대본도 슬라이드 창에 노출되면 안 됩니다.",
      elements: [
        {
          elementId: "el_presenter_2",
          type: "text",
          x: 120,
          y: 140,
          width: 980,
          height: 160,
          rotation: 0,
          opacity: 1,
          locked: false,
          props: {
            text: "Slide Window",
            fontSize: 64,
            fontFamily: "Inter",
            fontWeight: 800,
            color: "#15202b",
            align: "left",
          },
        },
      ],
      keywords: [],
      animations: [],
      aiNotes: { emphasisPoints: [], sourceEvidence: [] },
    },
  ],
};

test.describe("P1 presenter screen and slide window", () => {
  test("keeps the slide-only window synchronized without exposing presenter notes", async ({
    page,
  }) => {
    await installScreenShareMock(page);
    const { project } = await createAuthenticatedProject(page, {
      deck: presenterDeck as Deck,
      label: "presenter-sync",
    });

    await page.goto(`/rehearsal/${project.projectId}`);
    await page.getByRole("button", { name: "음성 없이 연습하기" }).click();
    await expect(page.getByText("리허설 · 자동 따라가기")).toBeVisible();
    await expect(page.getByText("Presenter Window")).toBeVisible();

    const slideWindowPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "슬라이드 창 열기" }).click();
    const slideWindow = await slideWindowPromise;
    await slideWindow.waitForLoadState();

    await expect(slideWindow.getByLabel("슬라이드 전용 창")).toBeVisible();
    await expectPresentWindowFillsViewport(slideWindow);
    await expect(page.getByText("슬라이드 화면 연결됨")).toBeVisible();
    await expect(
      slideWindow.locator('[data-slide-id="slide_presenter_1"]'),
    ).toBeVisible();
    await expect
      .poll(async () =>
        slideWindow
          .locator(".slideshow-renderer")
          .getAttribute("data-slide-title"),
      )
      .toBe("Presenter Window");
    expect(await slideWindow.content()).not.toContain(
      "이 대본은 슬라이드 창에 노출되면 안 됩니다",
    );
    expect(await slideWindow.content()).not.toContain("비공개 키워드");

    await page.getByRole("button", { name: "웹·실습 보여주기" }).click();
    const sharedVideo = slideWindow.getByLabel("공유 중인 웹 또는 실습 화면");
    await expect(sharedVideo).toBeVisible();
    await expect
      .poll(async () =>
          sharedVideo.evaluate((video) => ({
            audioTracks:
              (
                (video as HTMLVideoElement).srcObject as MediaStream | null
              )?.getAudioTracks().length ?? -1,
            muted: (video as HTMLVideoElement).muted,
            videoTracks:
              (
                (video as HTMLVideoElement).srcObject as MediaStream | null
              )?.getVideoTracks().length ?? 0,
        })),
      )
      .toEqual({ audioTracks: 0, muted: true, videoTracks: 1 });
    await expect
      .poll(() => getScreenShareRequest(page))
      .toMatchObject({
        audio: false,
        monitorTypeSurfaces: "exclude",
        selfBrowserSurface: "exclude",
        systemAudio: "exclude",
      });

    await delayNextMockShare(page);
    await page.getByRole("button", { name: "고급 옵션" }).click();
    await page.getByRole("button", { name: "전체 화면 공유" }).click();
    await page.getByLabel("노출 위험을 확인했습니다").check();
    await page.getByRole("button", { name: "전체 화면 선택" }).click();
    await expect(
      slideWindow.locator('[data-slide-id="slide_presenter_1"]'),
    ).toBeVisible();
    await page.waitForTimeout(6000);
    await expect(slideWindow.locator("video")).toHaveCount(0);
    await releaseNextMockShare(page);
    await expect(sharedVideo).toBeVisible();
    await expect
      .poll(() => getScreenShareRequest(page))
      .toMatchObject({ monitorTypeSurfaces: "include" });

    await page.getByRole("button", { name: "다음 슬라이드" }).click();

    await page.getByRole("button", { name: "슬라이드로 돌아가기" }).click();

    await expect(
      slideWindow.locator('[data-slide-id="slide_presenter_2"]'),
    ).toBeVisible();
    await expect
      .poll(async () =>
        slideWindow
          .locator(".slideshow-renderer")
          .getAttribute("data-slide-title"),
      )
      .toBe("Slide Window");
    expect(await slideWindow.content()).not.toContain(
      "두 번째 슬라이드 대본도",
    );

    await page.getByRole("button", { name: "청중 화면 가리기" }).click();
    await expect(slideWindow.getByLabel("청중 화면 가림")).toBeVisible();
    await expectPresentWindowFillsViewport(slideWindow);
    await expect(slideWindow.locator(".slideshow-renderer")).toHaveCount(0);
    await expect(slideWindow.locator("video")).toHaveCount(0);
    await page.getByRole("button", { name: "슬라이드로 돌아가기" }).click();
    await expect(
      slideWindow.locator('[data-slide-id="slide_presenter_2"]'),
    ).toBeVisible();

    await page.getByRole("button", { name: "웹·실습 보여주기" }).click();
    await expect(sharedVideo).toBeVisible();
    await endLatestMockShare(page);
    await expect(
      slideWindow.locator('[data-slide-id="slide_presenter_2"]'),
    ).toBeVisible();

    await page.getByRole("button", { name: "웹·실습 보여주기" }).click();
    await expect(sharedVideo).toBeVisible();

    await slideWindow.close();
    await expect(
      page.getByRole("button", { name: "슬라이드 창 다시 열기" }),
    ).toBeVisible();
    await expect.poll(() => getLatestMockTrackState(page)).toBe("ended");

    const reopenedWindowPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "슬라이드 창 다시 열기" }).click();
    const reopenedWindow = await reopenedWindowPromise;
    await reopenedWindow.waitForLoadState();

    await expect(
      reopenedWindow.locator('[data-slide-id="slide_presenter_2"]'),
    ).toBeVisible();
    await expect
      .poll(async () =>
        reopenedWindow
          .locator(".slideshow-renderer")
          .getAttribute("data-slide-title"),
      )
      .toBe("Slide Window");
    expect(await reopenedWindow.content()).not.toContain(
      "두 번째 슬라이드 대본도",
    );
  });

  test("shares from the surface-swap presenter remote into its opener audience", async ({
    page,
  }) => {
    await installScreenShareMock(page);
    await installSurfaceSwapMock(page);
    const { project } = await createAuthenticatedProject(page, {
      deck: presenterDeck as Deck,
      label: "presenter-surface-swap-share",
    });

    await page.goto(`/rehearsal/${project.projectId}`);
    await page.getByRole("button", { name: "음성 없이 연습하기" }).click();
    await expect(page.getByText("리허설 · 자동 따라가기")).toBeVisible();
    await page.getByRole("button", { name: "프레젠테이션 옵션" }).click();
    await page.getByRole("button", { name: "화면 권한 요청" }).click();
    await expect(
      page.getByRole("radio", { name: /청중 모니터/ }),
    ).toBeChecked();

    const remoteWindowPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "슬라이드쇼 시작" }).click();
    const remoteWindow = await remoteWindowPromise;
    await remoteWindow.waitForLoadState();
    await expect
      .poll(() => getSurfaceSwapPresenterWindowFeatures(page))
      .toContain("left=0");
    expect(await getSurfaceSwapPresenterWindowFeatures(page)).toContain(
      "top=0",
    );
    expect(await getSurfaceSwapPresenterWindowFeatures(page)).not.toContain(
      "left=1440",
    );

    await expect(page.getByLabel("슬라이드 전용 창")).toBeVisible();
    await expectPresentWindowFillsViewport(page);
    await expect(remoteWindow.getByLabel("발표자 제어 창")).toBeVisible();
    await expect(remoteWindow.getByText("팝업 연결됨")).toBeVisible();
    await expect
      .poll(() =>
        remoteWindow.evaluate(() => {
          const opener = window.opener as Window & {
            __orbitAudienceStreamBridgeV1?: { attach?: unknown };
          };
          return {
            bridgeReady: typeof opener?.__orbitAudienceStreamBridgeV1?.attach === "function",
            hasOpener: Boolean(opener),
            openerClosed: opener?.closed ?? true,
          };
        }),
      )
      .toEqual({ bridgeReady: true, hasOpener: true, openerClosed: false });
    await remoteWindow
      .getByRole("button", { name: "리허설 일시정지" })
      .click();
    await expect(
      remoteWindow.getByRole("button", { name: "리허설 다시 시작" }),
    ).toBeVisible();
    await remoteWindow.waitForTimeout(6000);
    await expect(remoteWindow.getByText("팝업 연결됨")).toBeVisible();
    await expect(
      remoteWindow.getByRole("button", { name: "웹·실습 보여주기" }),
    ).toBeEnabled();
    await remoteWindow
      .getByRole("button", { name: "웹·실습 보여주기" })
      .click();
    await expect
      .poll(() => getScreenShareRequest(remoteWindow))
      .toMatchObject({
        audio: false,
        monitorTypeSurfaces: "exclude",
      });
    await expect.poll(() => getLatestMockTrackState(remoteWindow)).toBe("live");
    await expect(
      remoteWindow.locator(".audience-output-control-status"),
    ).toHaveText("웹·실습 화면 공유 중");
    await expect(page.getByLabel("공유 중인 웹 또는 실습 화면")).toBeVisible();

    await remoteWindow
      .getByRole("button", { name: "다음", exact: true })
      .click();
    await remoteWindow
      .getByRole("button", { name: "슬라이드로 돌아가기" })
      .click();
    await expect(
      page.locator('.slideshow-renderer[data-slide-id="slide_presenter_2"]'),
    ).toBeVisible();

    await remoteWindow
      .getByRole("button", { name: "청중 화면 가리기" })
      .click();
    await expect(page.getByLabel("청중 화면 가림")).toBeVisible();
    await expectPresentWindowFillsViewport(page);
    await remoteWindow
      .getByRole("button", { name: "슬라이드로 돌아가기" })
      .click();
    await expect(
      page.locator('.slideshow-renderer[data-slide-id="slide_presenter_2"]'),
    ).toBeVisible();

    await remoteWindow
      .getByRole("button", { name: "웹·실습 보여주기" })
      .click();
    await expect(page.getByLabel("공유 중인 웹 또는 실습 화면")).toBeVisible();
    await remoteWindow.close();
    await expect(
      page.locator('.slideshow-renderer[data-slide-id="slide_presenter_2"]'),
    ).toBeVisible();
    expect(await page.content()).not.toContain("두 번째 슬라이드 대본도");
  });

  test("recovers from a missing receiver stream while presenter state keeps changing", async ({
    page,
  }) => {
    await installScreenShareMock(page);
    const { project } = await createAuthenticatedProject(page, {
      deck: presenterDeck as Deck,
      label: "presenter-missing-stream",
    });

    await page.goto(`/rehearsal/${project.projectId}`);
    await page.getByRole("button", { name: "음성 없이 연습하기" }).click();
    const slideWindowPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "슬라이드 창 열기" }).click();
    const slideWindow = await slideWindowPromise;
    await slideWindow.waitForLoadState();
    await suppressNextAudienceStreamAttach(slideWindow);

    await page.getByRole("button", { name: "웹·실습 보여주기" }).click();
    await expect(slideWindow.getByLabel("공유 화면 연결 중")).toBeVisible();
    await page.waitForTimeout(6000);

    await expect(
      slideWindow.locator('[data-slide-id="slide_presenter_1"]'),
    ).toBeVisible();
    await expect.poll(() => getLatestMockTrackState(page)).toBe("ended");
  });

  test("shows a screen picker when Window Management reports multiple external displays", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "getScreenDetails", {
        configurable: true,
        value: async () => ({
          currentScreen: {
            height: 900,
            isPrimary: true,
            label: "내장 화면",
            left: 0,
            top: 0,
            width: 1440,
          },
          screens: [
            {
              height: 900,
              isPrimary: true,
              label: "내장 화면",
              left: 0,
              top: 0,
              width: 1440,
            },
            {
              availHeight: 1080,
              availWidth: 1920,
              height: 1080,
              isPrimary: false,
              label: "HDMI A",
              left: 1440,
              top: 0,
              width: 1920,
            },
            {
              availHeight: 1080,
              availWidth: 1920,
              height: 1080,
              isPrimary: false,
              label: "HDMI B",
              left: 3360,
              top: 0,
              width: 1920,
            },
          ],
        }),
      });
    });
    const { project } = await createAuthenticatedProject(page, {
      deck: presenterDeck as Deck,
      label: "presenter-display-picker",
    });

    await page.goto(`/rehearsal/${project.projectId}`);
    await page.getByRole("button", { name: "음성 없이 연습하기" }).click();
    await expect(page.getByText("리허설 · 자동 따라가기")).toBeVisible();
    await page.getByRole("button", { name: "프레젠테이션 옵션" }).click();
    await page.getByRole("button", { name: "화면 권한 요청" }).click();

    await expect(page.getByRole("radio", { name: /HDMI A/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /HDMI B/ })).toBeVisible();
  });
});

async function expectPresentWindowFillsViewport(
  page: import("@playwright/test").Page,
) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>(
          ".present-window-shell",
        );
        if (!shell) return null;

        const shellRect = shell.getBoundingClientRect();
        return {
          bodyScrollHeight: document.body.scrollHeight,
          bodyScrollWidth: document.body.scrollWidth,
          documentOverflow: getComputedStyle(document.documentElement).overflow,
          documentScrollHeight: document.documentElement.scrollHeight,
          documentScrollWidth: document.documentElement.scrollWidth,
          scrollbarGutter: getComputedStyle(document.documentElement)
            .scrollbarGutter,
          shellBottom: shellRect.bottom,
          shellLeft: shellRect.left,
          shellRight: shellRect.right,
          shellTop: shellRect.top,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        };
      }),
    )
    .toEqual({
      bodyScrollHeight: expect.any(Number),
      bodyScrollWidth: expect.any(Number),
      documentOverflow: "hidden",
      documentScrollHeight: expect.any(Number),
      documentScrollWidth: expect.any(Number),
      scrollbarGutter: "auto",
      shellBottom: expect.any(Number),
      shellLeft: 0,
      shellRight: expect.any(Number),
      shellTop: 0,
      viewportHeight: expect.any(Number),
      viewportWidth: expect.any(Number),
    });

  const layout = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".present-window-shell");
    if (!shell) throw new Error("present window shell is missing");
    const shellRect = shell.getBoundingClientRect();
    return {
      bodyScrollHeight: document.body.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      shellBottom: shellRect.bottom,
      shellRight: shellRect.right,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(layout).toMatchObject({
    bodyScrollHeight: layout.viewportHeight,
    bodyScrollWidth: layout.viewportWidth,
    documentScrollHeight: layout.viewportHeight,
    documentScrollWidth: layout.viewportWidth,
    shellBottom: layout.viewportHeight,
    shellRight: layout.viewportWidth,
  });
}

async function installScreenShareMock(page: import("@playwright/test").Page) {
  await page.context().addInitScript(() => {
    const qa = {
      delayNextRequest: false,
      pendingRequestResolvers: [] as Array<() => void>,
      requests: [] as DisplayMediaStreamOptions[],
      tracks: [] as MediaStreamTrack[],
    };
    Object.defineProperty(window, "__orbitScreenShareQa", {
      configurable: true,
      value: qa,
    });
    Object.defineProperty(window, "CaptureController", {
      configurable: true,
      value: class {
        setFocusBehavior() {}
      },
    });
    const mediaDevices = navigator.mediaDevices ?? {};
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: mediaDevices,
    });
    Object.defineProperty(mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async (options: DisplayMediaStreamOptions) => {
        qa.requests.push(options);
        if (qa.delayNextRequest) {
          qa.delayNextRequest = false;
          await new Promise<void>((resolve) => {
            qa.pendingRequestResolvers.push(resolve);
          });
        }
        const canvas = document.createElement("canvas");
        canvas.hidden = true;
        canvas.width = 640;
        canvas.height = 360;
        document.documentElement.append(canvas);
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#6d5dfc";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const stream = canvas.captureStream(5);
        const track = stream.getVideoTracks()[0]!;
        const getSettings = track.getSettings.bind(track);
        Object.defineProperty(track, "getSettings", {
          configurable: true,
          value: () => ({
            ...getSettings(),
            displaySurface:
              options.monitorTypeSurfaces === "include"
                ? "monitor"
                : "browser",
          }),
        });
        qa.tracks.push(track);
        return stream;
      },
    });
  });
}

async function installSurfaceSwapMock(page: import("@playwright/test").Page) {
  await page.context().addInitScript(() => {
    const currentScreen = {
      availHeight: 900,
      availLeft: 0,
      availTop: 0,
      availWidth: 1440,
      height: 900,
      isPrimary: true,
      label: "발표자 노트북",
      left: 0,
      top: 0,
      width: 1440,
    };
    const audienceScreen = {
      availHeight: 1080,
      availLeft: 1440,
      availTop: 0,
      availWidth: 1920,
      height: 1080,
      isPrimary: false,
      label: "청중 모니터",
      left: 1440,
      top: 0,
      width: 1920,
    };
    const screenDetails = {
      currentScreen,
      screens: [currentScreen, audienceScreen],
    };
    const surfaceSwapQa = {
      presenterWindowFeatures: [] as string[],
    };
    const originalOpen = window.open.bind(window);
    Object.defineProperty(window, "__orbitSurfaceSwapQa", {
      configurable: true,
      value: surfaceSwapQa,
    });
    Object.defineProperty(window, "open", {
      configurable: true,
      value: (url?: string | URL, target?: string, features?: string) => {
        if (target?.startsWith("orbit-presenter-")) {
          surfaceSwapQa.presenterWindowFeatures.push(features ?? "");
        }
        return originalOpen(url, target, features);
      },
    });
    Object.defineProperty(window, "getScreenDetails", {
      configurable: true,
      value: async () => screenDetails,
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: async (options?: { screen?: typeof currentScreen }) => {
        screenDetails.currentScreen = options?.screen ?? audienceScreen;
      },
    });
  });
}

async function getSurfaceSwapPresenterWindowFeatures(
  page: import("@playwright/test").Page,
) {
  return page.evaluate(() => {
    const qa = (
      window as unknown as {
        __orbitSurfaceSwapQa: { presenterWindowFeatures: string[] };
      }
    ).__orbitSurfaceSwapQa;
    return qa.presenterWindowFeatures.at(-1) ?? "";
  });
}

async function getScreenShareRequest(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const qa = (
      window as unknown as {
        __orbitScreenShareQa: { requests: DisplayMediaStreamOptions[] };
      }
    ).__orbitScreenShareQa;
    return qa.requests.at(-1) ?? null;
  });
}

async function delayNextMockShare(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const qa = (
      window as unknown as {
        __orbitScreenShareQa: { delayNextRequest: boolean };
      }
    ).__orbitScreenShareQa;
    qa.delayNextRequest = true;
  });
}

async function releaseNextMockShare(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const qa = (
      window as unknown as {
        __orbitScreenShareQa: { pendingRequestResolvers: Array<() => void> };
      }
    ).__orbitScreenShareQa;
    qa.pendingRequestResolvers.shift()?.();
  });
}

async function suppressNextAudienceStreamAttach(
  page: import("@playwright/test").Page,
) {
  await page.evaluate(() => {
    const audienceWindow = window as typeof window & {
      __orbitAudienceStreamBridgeV1?: {
        attach: () => { ok: true };
      };
    };
    const bridge = audienceWindow.__orbitAudienceStreamBridgeV1;
    if (!bridge) throw new Error("audience stream bridge is not ready");
    bridge.attach = () => ({ ok: true });
  });
}

async function getLatestMockTrackState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const qa = (
      window as unknown as {
        __orbitScreenShareQa: { tracks: MediaStreamTrack[] };
      }
    ).__orbitScreenShareQa;
    return qa.tracks.at(-1)?.readyState ?? "missing";
  });
}

async function endLatestMockShare(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const qa = (
      window as unknown as {
        __orbitScreenShareQa: { tracks: MediaStreamTrack[] };
      }
    ).__orbitScreenShareQa;
    const track = qa.tracks.at(-1);
    track?.dispatchEvent(new Event("ended"));
    track?.stop();
  });
}
