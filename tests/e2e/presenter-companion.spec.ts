import { expect, test } from "@playwright/test";

test.describe("iPad presenter companion pairing", () => {
  test("exchanges a one-time code and removes it from browser history", async ({
    page,
  }) => {
    let exchangeCount = 0;
    await page.route(
      "**/api/v1/presentation-companion/pairings/**/exchange",
      async (route) => {
        exchangeCount += 1;
        expect(route.request().method()).toBe("POST");
        expect(route.request().headers()["content-type"]).toBe(
          "application/json",
        );
        expect(route.request().postDataJSON()).toEqual({});
        await route.fulfill({
          contentType: "application/json",
          json: {
            expiresAt: "2026-07-23T04:00:00.000Z",
            scopes: ["view-audience-output", "write-annotation"],
            sessionId: "session_companion_1",
          },
        });
      },
    );
    await page.route(
      "**/api/v1/presentation-companion/session_companion_1/bootstrap",
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          json: createBootstrap(),
        });
      },
    );

    await page.goto("/companion/pair/one-time-private-code");

    await expect(page.getByRole("heading", { name: "발표 자료" })).toBeVisible();
    await expect(page.getByText("발표자 화면 연결을 기다리고 있습니다.")).toBeVisible();
    await expect(page.getByText("iPad 발표 도우미")).toBeVisible();
    await expect(
      page.locator(".presenter-companion-shell-status"),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/companion\/session_companion_1$/);
    expect(page.url()).not.toContain("one-time-private-code");
    expect(exchangeCount).toBe(1);

    await page.goBack();
    expect(page.url()).not.toContain("one-time-private-code");
  });

  test("shows a fixed failure after removing an expired code from the URL", async ({
    page,
  }) => {
    await page.route(
      "**/api/v1/presentation-companion/pairings/**/exchange",
      async (route) => {
        await route.fulfill({ status: 404 });
      },
    );

    await page.goto("/companion/pair/expired-private-code");

    await expect(page.getByRole("alert")).toContainText(
      "연결 코드가 만료되었거나 이미 사용되었습니다.",
    );
    await expect(page.getByText("iPad 발표 도우미")).toBeVisible();
    await expect(page.getByText("연결 확인 필요")).toBeVisible();
    expect(page.url()).not.toContain("expired-private-code");
  });

  test("fails closed when a bootstrap contains a private presenter field", async ({
    page,
  }) => {
    const privateMarker = "PRIVATE_PRESENTER_NOTES_SENTINEL";
    await page.route(
      "**/api/v1/presentation-companion/session_private/bootstrap",
      async (route) => {
        const bootstrap = createBootstrap();
        await route.fulfill({
          contentType: "application/json",
          json: {
            ...bootstrap,
            deck: {
              ...bootstrap.deck,
              slides: bootstrap.deck.slides.map((slide) => ({
                ...slide,
                speakerNotes: privateMarker,
              })),
            },
          },
        });
      },
    );

    await page.goto("/companion/session_private");

    await expect(page.getByRole("alert")).toContainText(
      "iPad 발표 도우미 연결을 확인할 수 없습니다.",
    );
    await expect(page.locator("body")).not.toContainText(privateMarker);
  });

  test("uses the same safe route for rehearsal and keeps private markers absent", async ({
    page,
  }) => {
    await page.route(
      "**/api/v1/presentation-companion/session_rehearsal/bootstrap",
      async (route) => {
        await route.fulfill({
          contentType: "application/json",
          json: createBootstrap("rehearsal"),
        });
      },
    );

    await page.goto("/companion/session_rehearsal");

    await expect(page.getByText("리허설")).toBeVisible();
    await expect(page.getByText("iPad 발표 도우미")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("speakerNotes");
    await expect(page.locator("body")).not.toContainText("transcript");
  });

  test("keeps the companion surface closed when the feature is rolled back", async ({
    page,
  }) => {
    await page.route(
      "**/api/v1/presentation-companion/session_flag_off/bootstrap",
      async (route) => {
        await route.fulfill({ status: 404 });
      },
    );

    await page.goto("/companion/session_flag_off");

    await expect(page.getByRole("alert")).toContainText(
      "iPad 발표 도우미 연결을 확인할 수 없습니다.",
    );
  });
});

function createBootstrap(
  sessionPurpose: "presentation" | "rehearsal" = "presentation",
) {
  return {
    deck: {
      canvas: {
        aspectRatio: "16:9",
        height: 1080,
        preset: "wide-16-9",
        width: 1920,
      },
      deckId: "deck_companion_1",
      projectId: "project_companion_1",
      slides: [
        {
          animations: [],
          elements: [],
          kind: "content",
          order: 1,
          slideId: "slide_companion_1",
          style: {
            accentColor: "#5b4ae8",
            backgroundColor: "#ffffff",
            layout: "title-content",
            textColor: "#172033",
          },
        },
      ],
      theme: {
        accentColor: "#5b4ae8",
        backgroundColor: "#ffffff",
        fontFamily: "Inter",
        textColor: "#172033",
      },
      version: 1,
    },
    expiresAt: "2026-07-23T04:00:00.000Z",
    scopes: ["view-audience-output", "write-annotation"],
    sessionId: "session_companion_1",
    sessionPurpose,
  };
}
