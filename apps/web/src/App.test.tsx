import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  App,
  deckRenderPayloadStorageKey,
  fetchProjectAccess,
  getProjectAccessFailureBehavior,
  getProjectAccessRoleLabel,
  getAppNavigationItem,
  getRoute,
  ProjectAccessRequestError,
  shouldRetryProjectAccess,
  shouldRenderAppFrame,
  shouldWaitForAuthResolution
} from "./App";
import { OrbitAppHeader } from "./components/OrbitAppHeader";
import { OrbitAuthPage, submitOrbitAuth } from "./features/auth/AuthPage";
import { LandingPage } from "./features/landing/LandingPage";
import { authMeQueryKey } from "./features/auth/auth-session";
import { ProjectExplorerPage } from "./features/projects/ProjectExplorerPage";
import { OrbitWorkspaceHome } from "./features/projects/ProjectHub";
import { RehearsalProjectPickerPage } from "./features/rehearsal/RehearsalProjectPickerPage";

vi.mock("@huggingface/transformers", () => ({
  env: {},
  pipeline: vi.fn(),
}));

vi.mock("react-konva", () => {
  const Group = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>
  );
  const Stage = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>
  );
  const Text = ({ text }: { text?: string }) => <span>{text}</span>;

  return {
    Arrow: () => <span data-konva-arrow="true" />,
    Circle: () => <span data-konva-circle="true" />,
    Group,
    Image: () => <span data-konva-image="true" />,
    Layer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Line: () => <span data-konva-line="true" />,
    Rect: () => <span data-konva-rect="true" />,
    RegularPolygon: () => <span data-konva-polygon="true" />,
    Shape: () => <span data-konva-shape="true" />,
    Star: () => <span data-konva-star="true" />,
    Stage,
    Text
  };
});
describe("App shell routing", () => {
  it("renders the product brand and account menu", () => {
    const html = renderToStaticMarkup(
      <OrbitAppHeader
        activeItem="reports"
        isAuthenticated
        isLoggingOut={false}
        onLogout={() => undefined}
        onNavigate={() => undefined}
        userInitial="김"
        userLabel="kim@orbit.test"
      />
    );

    expect(html).toContain("main-logo.png");
    expect(html).toContain("kim@orbit.test");
    expect(html).toContain('aria-haspopup="menu"');
  });

  it("resolves the header active item from production routes", () => {
    expect(getAppNavigationItem({ name: "home" })).toBe("home");
    expect(getAppNavigationItem({ name: "project-list" })).toBe("project");
    expect(getAppNavigationItem({ name: "rehearsal-project-list" })).toBe("rehearsal");
    expect(getAppNavigationItem({ name: "report-list" })).toBe("reports");
    expect(
      getAppNavigationItem({
        name: "rehearsal-report",
        projectId: "project_bcaee91d-3878-4bec-a9b1-9f41fad8bff5",
        runId: "run_cdfd5478-97dc-4598-b556-3a2e1737e338"
      })
    ).toBe("reports");
    expect(
      getAppNavigationItem({
        name: "presentation-report",
        projectId: "project_bcaee91d-3878-4bec-a9b1-9f41fad8bff5",
        sessionId: "session_demo_1"
      })
    ).toBe("reports");
    expect(getAppNavigationItem({ name: "create-deck" })).toBe("project");
  });

  it("keeps the login page outside the shared navigation shell", () => {
    expect(shouldRenderAppFrame({ name: "login" })).toBe(false);
    expect(shouldRenderAppFrame({ name: "signup" })).toBe(false);
    expect(
      shouldRenderAppFrame({
        name: "project-editor",
        projectId: "project_demo_1"
      })
    ).toBe(false);
    expect(
      shouldRenderAppFrame({
        name: "presentation",
        projectId: "project_demo_1"
      })
    ).toBe(false);
    expect(
      shouldRenderAppFrame({
        name: "rehearsal",
        projectId: "project_demo_1"
      })
    ).toBe(false);
    expect(
      shouldRenderAppFrame({
        name: "rehearsal-report",
        projectId: "project_demo_1",
        runId: "run_demo_1"
      })
    ).toBe(true);
    expect(
      shouldRenderAppFrame({
        name: "report-project-overview",
        projectId: "project_demo_1"
      })
    ).toBe(true);
    expect(
      shouldRenderAppFrame({
        name: "present",
        deckId: "deck_demo_1",
        sessionId: "session_demo_1"
      })
    ).toBe(false);
    expect(shouldRenderAppFrame({ name: "home" })).toBe(true);
  });

  it("renders public routes without waiting for the current-user request", () => {
    expect(shouldWaitForAuthResolution({ name: "login" })).toBe(true);
    expect(shouldWaitForAuthResolution({ name: "signup" })).toBe(true);
    expect(shouldWaitForAuthResolution({ name: "report-mockup" })).toBe(false);
    expect(shouldWaitForAuthResolution({ name: "not-found" })).toBe(false);
    expect(
      shouldWaitForAuthResolution({ name: "audience-session", sessionId: "session-1" })
    ).toBe(false);
    expect(
      shouldWaitForAuthResolution({
        name: "audience-activity",
        sessionId: "session-1",
        activityId: "activity-1"
      })
    ).toBe(false);
    expect(
      shouldWaitForAuthResolution({
        name: "companion-spike",
        spikeId: "spike-1"
      })
    ).toBe(false);
  });

  it("waits for authentication before rendering workspace routes", () => {
    expect(shouldWaitForAuthResolution({ name: "home" })).toBe(true);
    expect(shouldWaitForAuthResolution({ name: "project-list" })).toBe(true);
    expect(
      shouldWaitForAuthResolution({ name: "rehearsal-project-list" })
    ).toBe(true);
    expect(
      shouldWaitForAuthResolution({ name: "project-editor", projectId: "project-1" })
    ).toBe(true);
  });

  it("exposes the design-system preview outside the product shell", () => {
    const route = getRoute("/design-system");

    expect(route).toEqual({ name: "design-system" });
    expect(shouldRenderAppFrame(route)).toBe(false);
  });

  it("parses the isolated mockup flow routes outside the product shell", () => {
    expect(getRoute("/mockup")).toEqual({ name: "mockup", screen: "public" });
    expect(getRoute("/mockup/home")).toEqual({ name: "mockup", screen: "home" });
    expect(getRoute("/mockup/create")).toEqual({ name: "mockup", screen: "create" });
    expect(getRoute("/mockup/editor")).toEqual({ name: "mockup", screen: "editor" });
    expect(getRoute("/mockup/microphone-check")).toEqual({ name: "mockup", screen: "microphone-check" });
    expect(getRoute("/mockup/project-request")).toEqual({ name: "mockup", screen: "project-request" });
    expect(getRoute("/mockup/rehearsal")).toEqual({ name: "mockup", screen: "rehearsal" });
    expect(getRoute("/mockup/rehearsal-complete")).toEqual({ name: "mockup", screen: "rehearsal-complete" });
    expect(getRoute("/mockup/reports")).toEqual({ name: "mockup", screen: "reports" });
    expect(getRoute("/mockup/report")).toEqual({ name: "mockup", screen: "report" });
    expect(getRoute("/mockup/report-project")).toEqual({ name: "mockup", screen: "report-project" });
    expect(getRoute("/mockup/live")).toEqual({ name: "mockup", screen: "live" });
    expect(getRoute("/mockup/live-presenter")).toEqual({ name: "mockup", screen: "live-presenter" });
    expect(getRoute("/mockup/login")).toEqual({ name: "mockup", screen: "login" });
    expect(getRoute("/mockup/signup")).toEqual({ name: "mockup", screen: "signup" });
    expect(getRoute("/mockup/presenter")).toEqual({ name: "mockup", screen: "presenter" });
    expect(getRoute("/mockup/catalog")).toEqual({ name: "mockup", screen: "catalog" });
    expect(getRoute("/mockup/brief")).toEqual({ name: "mockup", screen: "brief" });
    expect(getRoute("/mockup/practice-plan")).toEqual({ name: "mockup", screen: "practice-plan" });
    expect(getRoute("/mockup/focused-practice")).toEqual({ name: "mockup", screen: "focused-practice" });
    expect(getRoute("/mockup/challenge-qna")).toEqual({ name: "mockup", screen: "challenge-qna" });
    expect(getRoute("/mockup/audience")).toEqual({ name: "mockup", screen: "audience" });
    expect(getRoute("/mockup/version-history")).toEqual({ name: "mockup", screen: "version-history" });
    expect(getRoute("/mockup/ai-ppt")).toEqual({ name: "not-found" });
    expect(shouldRenderAppFrame({ name: "mockup", screen: "public" })).toBe(false);
  });

  it("exposes separate production login and signup routes", () => {
    expect(getRoute("/login")).toEqual({ name: "login" });
    expect(getRoute("/signup")).toEqual({ name: "signup" });
    expect(getRoute("/profile")).toEqual({ name: "profile" });
  });

  it("parses the canonical direct audience activity route", () => {
    expect(getRoute("/audience/session_1/a/activity_1")).toEqual({
      name: "audience-activity",
      sessionId: "session_1",
      activityId: "activity_1"
    });
  });

  it("parses isolated companion spike routes outside the product shell", () => {
    const companion = getRoute("/companion-spike/spike_1");
    const audience = getRoute("/companion-spike/spike_1/audience");
    const capture = getRoute("/companion-spike/spike_1/capture");

    expect(companion).toEqual({
      name: "companion-spike",
      spikeId: "spike_1"
    });
    expect(audience).toEqual({
      name: "companion-spike-audience",
      spikeId: "spike_1"
    });
    expect(capture).toEqual({
      name: "companion-spike-capture",
      spikeId: "spike_1"
    });
    expect(shouldRenderAppFrame(companion)).toBe(false);
    expect(shouldRenderAppFrame(audience)).toBe(false);
    expect(shouldRenderAppFrame(capture)).toBe(false);
  });

  it("keeps pairing and authenticated companion routes public and frameless", () => {
    expect(getRoute("/companion/pair/code%2Fprivate")).toEqual({
      name: "companion-pair",
      code: "code/private",
    });
    expect(getRoute("/companion/session%2F1")).toEqual({
      name: "companion",
      sessionId: "session/1",
    });
    for (const route of [
      { name: "companion-pair", code: "code" } as const,
      { name: "companion", sessionId: "session_1" } as const,
    ]) {
      expect(shouldWaitForAuthResolution(route)).toBe(false);
      expect(shouldRenderAppFrame(route)).toBe(false);
    }
  });

  it("parses the standalone activity audience preview route", () => {
    expect(
      getRoute("/project/project_demo_1/activity-preview/activity_pre_question_1")
    ).toEqual({
      name: "activity-preview",
      projectId: "project_demo_1",
      activityId: "activity_pre_question_1"
    });
    expect(
      shouldRenderAppFrame({
        name: "activity-preview",
        projectId: "project_demo_1",
        activityId: "activity_pre_question_1"
      })
    ).toBe(false);
  });

  it("renders the production AI PPT wizard from the createdeck route", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(authMeQueryKey, {
      userId: "user_demo_1",
      email: "demo@orbit.test"
    });
    vi.stubGlobal("window", {
      location: { pathname: "/createdeck", search: "" }
    });

    try {
      expect(getRoute()).toEqual({ name: "create-deck" });
      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      );

      expect(html).not.toContain("핵심 컨텍스트");
      expect(html).toContain("대본 톤");
      expect(html).toContain("다음 단계");
      expect(html).toContain("Style &amp; Color");
    } finally {
      vi.unstubAllGlobals();
      queryClient.clear();
    }
  });

  it("parses project brief and version history production routes", () => {
    expect(getRoute("/project/project_demo_1/brief")).toEqual({
      name: "project-brief",
      projectId: "project_demo_1"
    });
    expect(getRoute("/project/project_demo_1/history")).toEqual({
      name: "project-history",
      projectId: "project_demo_1"
    });
    expect(
      getRoute(
        "/project/project_demo_1/presentation-sessions/session_demo_1/results",
      ),
    ).toEqual({
      name: "activity-results",
      projectId: "project_demo_1",
      sessionId: "session_demo_1",
    });
  });

  it("matches Style & Color and generation before the generic project route", () => {
    expect(getRoute("/project/project_demo_1/style-color/job-1")).toEqual({
      name: "story-style-color",
      projectId: "project_demo_1",
      jobId: "job-1",
    });
    expect(getRoute("/project/project_demo_1/generation/job-1")).toEqual({
      name: "ai-deck-generation",
      projectId: "project_demo_1",
      jobId: "job-1",
    });
  });

  it("parses presenter slide-window routes with an optional session id", () => {
    expect(getRoute("/present/deck_demo_1", "?sessionId=session_demo_1")).toEqual({
      name: "present",
      deckId: "deck_demo_1",
      sessionId: "session_demo_1"
    });
    expect(getRoute("/present/deck_demo_1")).toEqual({
      name: "present",
      deckId: "deck_demo_1",
      sessionId: undefined
    });
  });

  it("parses presentation workspace routes", () => {
    expect(getRoute("/presentation/project_demo_1")).toEqual({
      name: "presentation",
      projectId: "project_demo_1"
    });
    expect(
      getRoute(
        "/presentation/project_demo_1",
        "?presenterSessionId=local-window-1&presenterWindow=1&slideIndex=2&stepIndex=1"
      )
    ).toEqual({
      name: "presentation",
      presenterInitialSlideIndex: 2,
      presenterInitialStepIndex: 1,
      presenterSessionId: "local-window-1",
      presenterWindow: true,
      projectId: "project_demo_1"
    });
    expect(
      getRoute(
        "/presentation/project_demo_1/report/session_demo_1",
        "?runId=presentation_run_1"
      )
    ).toEqual({
      name: "presentation-report",
      projectId: "project_demo_1",
      sessionId: "session_demo_1",
      runId: "presentation_run_1"
    });
    expect(
      getRoute("/presentation/project_demo_1/report/session_demo_1")
    ).toEqual({
      name: "presentation-report",
      projectId: "project_demo_1",
      sessionId: "session_demo_1",
      runId: undefined
    });
  });

  it("parses rehearsal presenter-window session query parameters", () => {
    expect(
      getRoute(
        "/rehearsal/project_demo_1",
        "?presenterSessionId=session-presenter-1&presenterWindow=1&slideIndex=2&stepIndex=1"
      )
    ).toEqual({
      name: "rehearsal",
      presenterInitialSlideIndex: 2,
      presenterInitialStepIndex: 1,
      presenterSessionId: "session-presenter-1",
      presenterWindow: true,
      projectId: "project_demo_1"
    });
  });

  it("keeps the deck render fixture outside the shared navigation shell", () => {
    const route = getRoute("/__deck-render");

    expect(route).toEqual({ name: "deck-render" });
    expect(shouldRenderAppFrame(route)).toBe(false);
    expect(deckRenderPayloadStorageKey).toBe("orbit.deckRenderPayload.v1");
  });

  it("does not expose the old upload workspace route", () => {
    expect(getRoute("/upload")).toEqual({ name: "not-found" });
  });

  it("returns a recoverable not-found route for unknown and malformed paths", () => {
    expect(getRoute("/missing-page")).toEqual({ name: "not-found" });
    expect(getRoute("/project/%E0%A4%A")).toEqual({ name: "not-found" });
  });

  it("preserves rehearsal intent in the project selection route", () => {
    expect(getRoute("/project", "?intent=rehearsal")).toEqual({
      name: "rehearsal-project-list"
    });
  });

  it("ignores the removed home template style query route", () => {
    expect(getRoute("/", "?templateStyle=presentation-document")).toEqual({
      name: "home"
    });
  });
});
describe("public and authentication surfaces", () => {
  it("renders the public landing hero with login and signup entry points", () => {
    const html = renderToStaticMarkup(
        <LandingPage onNavigate={() => undefined} />
    );

    expect(html).toContain("생각을 발표로 바꾸는");
    expect(html).toContain("가장 빠른 캔버스");
    expect(html).toContain("로그인");
    expect(html).toContain("무료로 시작");
    expect(html.match(/redesign-gradient-button/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("랜딩 페이지 메뉴");
    expect(html).not.toContain("Google");
    expect(html).not.toContain("비밀번호를 잊으셨나요");
  });

  it("renders nickname only on the signup form", () => {
    const queryClient = new QueryClient();
    const loginHtml = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <OrbitAuthPage isAuthenticated={false} mode="login" onNavigate={() => undefined} />
      </QueryClientProvider>
    );
    const signupHtml = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <OrbitAuthPage isAuthenticated={false} mode="register" onNavigate={() => undefined} />
      </QueryClientProvider>
    );

    expect(loginHtml).toContain("다시 만나서 반가워요.");
    expect(signupHtml).toContain("첫 발표를 시작해 볼까요?");
    expect(loginHtml).toContain('type="email"');
    expect(loginHtml).toContain('type="password"');
    expect(loginHtml).toContain("redesign-gradient-button");
    expect(signupHtml).toContain("redesign-gradient-button");
    expect(signupHtml).not.toContain("Google");
    expect(loginHtml).not.toContain('autoComplete="name"');
    expect(signupHtml).toContain('autoComplete="name"');
    expect(signupHtml).toContain("닉네임");
  });

  it("submits the existing auth contract and surfaces API errors", async () => {
    const successFetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await submitOrbitAuth({
      email: "kim@orbit.test",
      fetcher: successFetcher,
      mode: "login",
      password: "password123"
    });

    expect(successFetcher).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );

    const errorFetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "이메일 또는 비밀번호를 확인하세요." }), {
        status: 401
      })
    );
    await expect(
      submitOrbitAuth({
        email: "kim@orbit.test",
        fetcher: errorFetcher,
        mode: "register",
        password: "password123"
      })
    ).rejects.toThrow("이메일 또는 비밀번호를 확인하세요.");
  });
});

describe("workspace project surfaces", () => {
  it("classifies an expired authentication session from project access", async () => {
    await expect(
      fetchProjectAccess(
        "project_1",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ message: "Authentication required" }), {
            status: 401,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      name: "ProjectAccessRequestError",
      status: 401,
    });
  });

  it("retries transient project access failures but not authentication or missing-project responses", () => {
    expect(shouldRetryProjectAccess(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetryProjectAccess(2, new TypeError("Failed to fetch"))).toBe(false);
    expect(
      shouldRetryProjectAccess(
        0,
        new ProjectAccessRequestError("Authentication required", 401),
      ),
    ).toBe(false);
    expect(
      shouldRetryProjectAccess(
        0,
        new ProjectAccessRequestError("Project not found", 404),
      ),
    ).toBe(false);
    expect(
      shouldRetryProjectAccess(
        0,
        new ProjectAccessRequestError("Server error", 503),
      ),
    ).toBe(true);
  });

  it("keeps an already-authorized editor open for a transient access failure", () => {
    expect(
      getProjectAccessFailureBehavior(new TypeError("Failed to fetch"), true),
    ).toBe("preserve");
    expect(
      getProjectAccessFailureBehavior(
        new ProjectAccessRequestError("Authentication required", 401),
        true,
      ),
    ).toBe("login");
    expect(
      getProjectAccessFailureBehavior(new TypeError("Failed to fetch"), false),
    ).toBe("blocking");
  });

  it("uses localized project access roles", () => {
    expect(getProjectAccessRoleLabel("owner")).toBe("소유자");
    expect(getProjectAccessRoleLabel("editor")).toBe("편집 가능");
    expect(getProjectAccessRoleLabel("viewer")).toBe("보기 전용");
  });

  it("renders a recents-only workspace home with an AI creation tile", () => {
    const queryClient = new QueryClient();
    const projectItems = Array.from({ length: 5 }, (_, index) => ({
      createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      createdBy: "user_1",
      isPinned: index === 0,
      pinnedAt: index === 0 ? "2026-07-20T00:00:00.000Z" : null,
      projectId: `project_${index + 1}`,
      tags: [],
      generation: null,
      title: `프로젝트 ${index + 1}`,
      workspaceId: "workspace_1"
    }));
    queryClient.setQueryData(
      ["projects", "page", { filter: "all", query: "", sort: "latest", tags: [] }],
      {
        pages: [{ items: projectItems, page: 1, limit: 5, hasMore: false }],
        pageParams: [1]
      }
    );
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <OrbitWorkspaceHome onNavigate={() => undefined} userName="지윤" />
      </QueryClientProvider>
    );

    expect(html).toContain("내 프로젝트");
    expect(html).not.toContain("Workspace");
    expect(html).toContain("더보기");
    expect(html).toContain('class="workspace-create-project-card"');
    expect(html).toContain("AI로 발표자료 만들기");
    expect(html).toContain("발표자료 초안을 만들어드려요.");
    expect(html).not.toContain("빈 슬라이드로 시작하세요.");
    expect(html.match(/<article[^>]*workspace-home-card/g)).toHaveLength(5);
    expect(html).toMatch(/class="[^"]*workspace-home-card is-pinned/);
    expect(html).not.toContain("워크스페이스 메뉴");
  });

  it("renders search, sorting and creation controls in project explorer", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["projects"], [
      {
        createdAt: "2026-07-18T00:00:00.000Z",
        createdBy: "user_1",
        isPinned: false,
        projectId: "project_1",
        title: "프로젝트 1",
        workspaceId: "workspace_1",
      },
    ]);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ProjectExplorerPage onNavigate={() => undefined} />
      </QueryClientProvider>
    );

    expect(html).toContain('aria-label="프로젝트 검색"');
    expect(html).toContain('aria-label="새 발표자료 만들기"');
    expect(html).toContain('class="orbit-project-browse-tools"');
    expect(html).toContain('aria-label="프로젝트 정렬: 최근 생성순"');
    expect(html).not.toContain('aria-label="프로젝트 새로고침"');
    expect(html).toContain("빈 프로젝트");
    expect(html).toContain("PPTX 업로드");
    expect(html).toContain("orbit-project-commandbar-action orbit-project-commandbar-blank");
    expect(html).toContain("orbit-project-commandbar-action orbit-project-commandbar-upload");
    expect(html).toContain('class="orbit-project-gallery"');
    expect(html).toContain('aria-label="프로젝트 1 고정"');
    expect(html).toContain('aria-label="프로젝트 1 리허설 시작"');
    expect(html).toContain('aria-label="프로젝트 1 삭제"');
    expect(html.indexOf('aria-label="프로젝트 1 고정"')).toBeLessThan(
      html.indexOf('aria-label="프로젝트 1 리허설 시작"'),
    );
    expect(html.indexOf('aria-label="프로젝트 1 리허설 시작"')).toBeLessThan(
      html.indexOf('aria-label="프로젝트 1 삭제"'),
    );
    expect(html).not.toContain('aria-label="프로젝트 1 작업 메뉴"');
    expect(html).not.toContain("<h1>프로젝트</h1>");
  });

  it("renders a dedicated rehearsal project picker without creation or delete actions", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["projects"], [
      {
        createdAt: "2026-07-18T00:00:00.000Z",
        createdBy: "user_1",
        isPinned: false,
        projectId: "project_private_identifier",
        title: "리허설 발표자료",
        workspaceId: "workspace_1",
      },
    ]);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <RehearsalProjectPickerPage onNavigate={() => undefined} />
      </QueryClientProvider>
    );

    expect(html).toContain('aria-label="리허설 프로젝트 목록"');
    expect(html).toContain("리허설 발표자료");
    expect(html).toContain("연습하기");
    expect(html).not.toContain("연습하러 가기");
    expect(html).not.toContain(">작업</span>");
    expect(html).toContain("redesign-button-primary");
    expect(html).not.toContain("project_private_identifier");
    expect(html).toContain('aria-label="프로젝트 새로고침"');
    expect(html).not.toContain("빈 프로젝트");
  });
});
