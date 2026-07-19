import {
  deckSchema,
  demoIds,
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSlideSpeakingRate,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  projectAccessResponseSchema,
  type Deck,
  type Project,
  type ProjectAccessResponse,
  type ProjectMemberRole,
  type RehearsalReport,
  type RehearsalRun,
} from "@orbit/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconFileText } from "@tabler/icons-react";
import type { FormEvent, ReactNode } from "react";
import { lazy, Suspense, useEffect, useState } from "react";
import { createDemoDeck } from "../../../packages/editor-core/src/index";
import {
  OrbitAppHeader,
  type OrbitAppNavigationItem,
} from "./components/OrbitAppHeader";
import { RedesignSystemPage } from "./features/design-system/RedesignSystemPage";
import { OrbitButton, OrbitEmptyState, OrbitFailureState } from "./components/ui";
import { OrbitAuthPage } from "./features/auth/AuthPage";
import {
  authMeQueryKey,
  fetchCurrentUser,
  markAuthLoggedOut,
  type AuthUser,
} from "./features/auth/auth-session";
import { LandingPage } from "./features/landing/LandingPage";
import { ChallengeQnaPage } from "./features/coaching/ChallengeQnaPage";
import { FocusedPracticePage } from "./features/coaching/FocusedPracticePage";
import { PracticePlanPage } from "./features/coaching/PracticePlanPage";
import { PresentationBriefPage } from "./features/coaching/PresentationBriefPage";
import {
  AiPptMockupPage as AiPptWizardPage,
  AiPptStyleColorPage,
} from "./features/ai-ppt/AiPptMockupPage";
import { AiDeckGenerationPage } from "./features/ai-ppt/AiDeckGenerationPage";
import { DeckVersionHistoryPage } from "./features/editor/history/DeckVersionHistoryPage";
import {
  OrbitMockupFlow,
  type OrbitMockupScreen,
} from "./features/mockups/OrbitMockupFlow";
import { ProjectExplorerPage } from "./features/projects/ProjectExplorerPage";
import { OrbitWorkspaceHome } from "./features/projects/ProjectHub";
import { ProjectAccessProvider } from "./features/projects/ProjectAccessContext";
import "./features/projects/orbit-create-deck.css";
import "./features/projects/orbit-project-access.css";
import {
  RehearsalReportPage,
  RehearsalWorkspace,
} from "./features/rehearsal/RehearsalWorkspace";
import { RehearsalReportListPage } from "./features/rehearsal/RehearsalReportListPage";
import { RehearsalProjectPickerPage } from "./features/rehearsal/RehearsalProjectPickerPage";
import { RehearsalProjectOverviewPage } from "./features/rehearsal/RehearsalProjectOverviewPage";
import { PresentationWorkspace } from "./features/presentation/PresentationWorkspace";
import { AudienceSessionPage } from "./pages/audience/AudienceSessionPage";
import { PresentWindow } from "./features/rehearsal/presenter/PresentWindow";
import { ReadOnlySlideCanvas } from "./features/slides/rendering";
import { ActivityResultsPage } from "./features/activity-slides";

export type Route =
  | { name: "design-system" }
  | { name: "mockup"; screen: OrbitMockupScreen }
  | { name: "login" }
  | { name: "signup" }
  | { name: "home" }
  | { name: "create-deck" }
  | { name: "project-list" }
  | { name: "rehearsal-project-list" }
  | { name: "project-editor"; projectId: string }
  | { name: "project-brief"; projectId: string }
  | { name: "project-history"; projectId: string }
  | { name: "activity-results"; projectId: string; sessionId: string }
  | { name: "story-style-color"; projectId: string; jobId: string }
  | { name: "ai-deck-generation"; projectId: string; jobId: string }
  | { name: "project-request"; projectId: string }
  | { name: "audience-session"; sessionId: string }
  | { name: "audience-activity"; sessionId: string; activityId: string }
  | { name: "presentation"; projectId: string }
  | { name: "present"; deckId: string; sessionId?: string }
  | {
      name: "rehearsal";
      presenterInitialSlideIndex?: number;
      presenterInitialStepIndex?: number;
      presenterSessionId?: string;
      presenterWindow?: boolean;
      snapshotPreparationId?: string;
      sourceFullRunId?: string;
      sourceGoalSetId?: string;
      projectId: string;
    }
  | { name: "rehearsal-report"; projectId: string; runId: string }
  | { name: "practice-plan"; projectId: string; sourceFullRunId: string }
  | {
      name: "focused-practice";
      projectId: string;
      goalId: string;
      sourceFullRunId: string;
    }
  | { name: "challenge-qna"; projectId: string; sourceFullRunId: string }
  | { name: "report-mockup" }
  | { name: "report-list" }
  | { name: "report-project-overview"; projectId: string }
  | { name: "not-found" }
  | { name: "deck-render" };

export const deckRenderPayloadStorageKey = "orbit.deckRenderPayload.v1";

const EditorShell = lazy(() =>
  import("./features/editor/shell/EditorShell").then((module) => ({
    default: module.EditorShell,
  })),
);

const demoDeck = createDemoDeck();
const reportMockupRunId = "run_report_mockup";
const reportMockupGeneratedAt = "2026-07-01T09:00:00.000Z";
const reportMockupRun: RehearsalRun = {
  runId: reportMockupRunId,
  projectId: demoIds.projectId,
  deckId: demoIds.deckId,
  audioFileId: "file_report_mockup_audio",
  jobId: "job_report_mockup_stt",
  deckVersion: null,
  evaluationSnapshot: null,
  semanticEvaluationMode: "full",
  analysisRevision: 1,
  analysisFinalizedAt: reportMockupGeneratedAt,
  status: "succeeded",
  error: null,
  rawAudioDeletedAt: null,
  createdAt: "2026-07-01T08:54:12.000Z",
  updatedAt: reportMockupGeneratedAt,
};
const reportMockupReport: RehearsalReport = {
  reportId: "report_mockup",
  runId: reportMockupRunId,
  projectId: demoIds.projectId,
  deckId: demoIds.deckId,
  transcriptRetained: false,
  transcript: null,
  volumeAnalysis: legacyRehearsalVolumeAnalysis,
  silenceAnalysis: {
    ...legacyRehearsalSilenceAnalysis,
    measurementState: "measured",
    reasonCode: null,
    detectorVersion: "6.2.1",
    analysisWindowStartSeconds: 0.4,
    analysisWindowEndSeconds: 285.5,
    totalSilenceSeconds: 2,
    silenceRatio: 0.007,
    longSilenceCount: 1,
    detectedSegmentCount: 1,
    segments: [
      {
        category: "long",
        startSeconds: 144,
        endSeconds: 146,
        durationSeconds: 2,
      },
    ],
  },
  metrics: {
    ...legacyRehearsalReportMetricsDefaults,
    durationSeconds: 286,
    wordsPerMinute: 128,
    fillerWordCount: 3,
    longSilenceCount: 1,
    measurements: {
      ...legacyRehearsalReportMetricsDefaults.measurements,
      longSilenceCount: {
        measurementState: "measured",
        metricDefinitionVersion: 1,
        reasonCode: null,
      },
    },
    keywordCoverage: 0.86,
    keywordCoverageMeasurement: { state: "measured" },
  },
  speedSamples: [
    { startSecond: 0, endSecond: 30, wordsPerMinute: 118 },
    { startSecond: 30, endSecond: 60, wordsPerMinute: 132 },
    { startSecond: 60, endSecond: 90, wordsPerMinute: 126 },
  ],
  fillerWordDetails: [{ word: "음", count: 3 }],
  missedKeywords: [
    { slideId: "slide_1", keywordId: "kw_1", text: "핵심 메시지" },
  ],
  utteranceOutcomes: [],
  semanticCueDecisions: [],
  semanticEvaluation: {
    state: "unavailable",
    measurementMode: "none",
    reasons: ["evaluation_not_run"],
    retryable: false,
  },
  semanticCueOutcomes: [],
  slideTimings: [{ slideId: "slide_1", targetSeconds: 60, actualSeconds: 58 }],
  slideInsights: [
    {
      slideId: "slide_1",
      fillerWordCount: 2,
      longSilenceCount: 1,
      speakingRate: legacyRehearsalSlideSpeakingRate,
    },
  ],
  qnaSummary: {
    questionCount: 0,
    questionSummary: "",
    unclearTopics: [],
  },
  coaching: {
    status: "succeeded",
    summary:
      "핵심 메시지는 안정적으로 전달됐고, 속도도 발표 시간에 잘 맞습니다.",
    strengths: [
      "도입부에서 발표 목적을 빠르게 제시했습니다.",
      "중요 키워드를 반복해 청중이 흐름을 따라가기 좋았습니다.",
      "슬라이드 전환 사이의 멈춤이 과하지 않았습니다.",
    ],
    improvements: [
      "중간 설명에서 일부 filler 표현이 반복됩니다.",
      "마무리 전에 다음 행동을 더 명확하게 요청하면 좋습니다.",
      "수치가 있는 문장은 한 번 더 천천히 읽는 편이 좋습니다.",
    ],
    nextPracticeFocus:
      "다음 연습에서는 결론 슬라이드의 CTA 문장을 먼저 고정하고, 수치 설명 구간의 호흡을 조금 더 길게 가져가세요.",
    message: "",
  },
  generatedAt: reportMockupGeneratedAt,
};
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ProjectAccessRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProjectAccessRequestError";
  }
}

export async function fetchProjectAccess(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<ProjectAccessResponse> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/access`,
    {
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new ProjectAccessRequestError(
      await readApiError(response, "프로젝트 권한을 확인하지 못했습니다."),
      response.status,
    );
  }
  return projectAccessResponseSchema.parse(await response.json());
}

export function shouldRetryProjectAccess(
  failureCount: number,
  error: unknown,
) {
  if (error instanceof ProjectAccessRequestError) {
    return error.status >= 500 && failureCount < 2;
  }

  return failureCount < 2;
}

export function getProjectAccessFailureBehavior(
  error: unknown,
  hasAcceptedMembership: boolean,
) {
  if (
    error instanceof ProjectAccessRequestError &&
    error.status === 401
  ) {
    return "login";
  }

  return hasAcceptedMembership ? "preserve" : "blocking";
}
async function requestProjectAccess(
  projectId: string,
  role: Exclude<ProjectMemberRole, "owner">,
): Promise<ProjectAccessResponse> {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/access-requests`,
    {
      body: JSON.stringify({ role }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  if (!response.ok) {
    throw new Error(
      await readApiError(response, "프로젝트 권한 요청에 실패했습니다."),
    );
  }
  return projectAccessResponseSchema.parse(await response.json());
}

export function getRoute(pathname?: string, search?: string): Route {
  const currentPathname =
    pathname ??
    (typeof window === "undefined" ? "/" : window.location.pathname);
  const currentSearch =
    search ?? (typeof window === "undefined" ? "" : window.location.search);
  const normalized = currentPathname.replace(/\/+$/, "") || "/";

  try {
    if (normalized === "/login") return { name: "login" };
    if (normalized === "/signup") return { name: "signup" };
    if (normalized === "/design-system") return { name: "design-system" };
    if (normalized === "/mockup") return { name: "mockup", screen: "public" };
    if (normalized === "/mockup/home")
      return { name: "mockup", screen: "home" };
    if (normalized === "/mockup/create")
      return { name: "mockup", screen: "create" };
    if (normalized === "/mockup/editor")
      return { name: "mockup", screen: "editor" };
    if (normalized === "/mockup/microphone-check")
      return { name: "mockup", screen: "microphone-check" };
    if (normalized === "/mockup/project-request")
      return { name: "mockup", screen: "project-request" };
    if (normalized === "/mockup/rehearsal")
      return { name: "mockup", screen: "rehearsal" };
    if (normalized === "/mockup/presenter")
      return { name: "mockup", screen: "presenter" };
    if (normalized === "/mockup/rehearsal-complete")
      return { name: "mockup", screen: "rehearsal-complete" };
    if (normalized === "/mockup/reports")
      return { name: "mockup", screen: "reports" };
    if (normalized === "/mockup/report")
      return { name: "mockup", screen: "report" };
    if (normalized === "/mockup/report-project")
      return { name: "mockup", screen: "report-project" };
    if (normalized === "/mockup/live")
      return { name: "mockup", screen: "live" };
    if (normalized === "/mockup/live-presenter")
      return { name: "mockup", screen: "live-presenter" };
    if (normalized === "/mockup/login")
      return { name: "mockup", screen: "login" };
    if (normalized === "/mockup/signup")
      return { name: "mockup", screen: "signup" };
    if (normalized === "/mockup/catalog")
      return { name: "mockup", screen: "catalog" };
    if (normalized === "/mockup/brief")
      return { name: "mockup", screen: "brief" };
    if (normalized === "/mockup/practice-plan")
      return { name: "mockup", screen: "practice-plan" };
    if (normalized === "/mockup/focused-practice")
      return { name: "mockup", screen: "focused-practice" };
    if (normalized === "/mockup/challenge-qna")
      return { name: "mockup", screen: "challenge-qna" };
    if (normalized === "/mockup/audience")
      return { name: "mockup", screen: "audience" };
    if (normalized === "/mockup/version-history")
      return { name: "mockup", screen: "version-history" };
    if (normalized === "/createdeck") return { name: "create-deck" };
    if (normalized === "/project") {
      return new URLSearchParams(currentSearch).get("intent") === "rehearsal"
        ? { name: "rehearsal-project-list" }
        : { name: "project-list" };
    }
    if (normalized === "/reports") return { name: "report-list" };
    const reportProjectMatch = normalized.match(/^\/reports\/([^/]+)$/);
    if (reportProjectMatch) {
      return {
        name: "report-project-overview",
        projectId: decodeURIComponent(reportProjectMatch[1]),
      };
    }
    if (normalized === "/report_mockup") return { name: "report-mockup" };
    if (normalized === "/__deck-render" && isDeckRenderRouteEnabled()) {
      return { name: "deck-render" };
    }

    const audienceActivityMatch = normalized.match(/^\/audience\/([^/]+)\/a\/([^/]+)$/);
    if (audienceActivityMatch) {
      return {
        name: "audience-activity",
        sessionId: decodeURIComponent(audienceActivityMatch[1]),
        activityId: decodeURIComponent(audienceActivityMatch[2]),
      };
    }

    const audienceSessionMatch = normalized.match(/^\/audience\/([^/]+)$/);
    if (audienceSessionMatch) {
      return {
        name: "audience-session",
        sessionId: decodeURIComponent(audienceSessionMatch[1]),
      };
    }

    const presentationMatch = normalized.match(/^\/presentation\/([^/]+)$/);
    if (presentationMatch) {
      return {
        name: "presentation",
        projectId: decodeURIComponent(presentationMatch[1]),
      };
    }

    const projectRequestMatch = normalized.match(
      /^\/project\/([^/]+)\/request$/,
    );
    if (projectRequestMatch) {
      return {
        name: "project-request",
        projectId: decodeURIComponent(projectRequestMatch[1]),
      };
    }

    const projectBriefMatch = normalized.match(/^\/project\/([^/]+)\/brief$/);
    if (projectBriefMatch) {
      return {
        name: "project-brief",
        projectId: decodeURIComponent(projectBriefMatch[1]),
      };
    }

    const projectHistoryMatch = normalized.match(
      /^\/project\/([^/]+)\/history$/,
    );
    if (projectHistoryMatch) {
      return {
        name: "project-history",
        projectId: decodeURIComponent(projectHistoryMatch[1]),
      };
    }

    const activityResultsMatch = normalized.match(
      /^\/project\/([^/]+)\/presentation-sessions\/([^/]+)\/results$/,
    );
    if (activityResultsMatch) {
      return {
        name: "activity-results",
        projectId: decodeURIComponent(activityResultsMatch[1]),
        sessionId: decodeURIComponent(activityResultsMatch[2]),
      };
    }

    const storyStyleColorMatch = normalized.match(
      /^\/project\/([^/]+)\/style-color\/([^/]+)$/,
    );
    if (storyStyleColorMatch) {
      return {
        name: "story-style-color",
        projectId: decodeURIComponent(storyStyleColorMatch[1]),
        jobId: decodeURIComponent(storyStyleColorMatch[2]),
      };
    }

    const aiDeckGenerationMatch = normalized.match(
      /^\/project\/([^/]+)\/generation\/([^/]+)$/,
    );
    if (aiDeckGenerationMatch) {
      return {
        name: "ai-deck-generation",
        projectId: decodeURIComponent(aiDeckGenerationMatch[1]),
        jobId: decodeURIComponent(aiDeckGenerationMatch[2]),
      };
    }

    const projectMatch = normalized.match(/^\/project\/([^/]+)$/);
    if (projectMatch) {
      return {
        name: "project-editor",
        projectId: decodeURIComponent(projectMatch[1]),
      };
    }

    const rehearsalReportMatch = normalized.match(
      /^\/rehearsal\/([^/]+)\/report\/([^/]+)$/,
    );
    if (rehearsalReportMatch) {
      return {
        name: "rehearsal-report",
        projectId: decodeURIComponent(rehearsalReportMatch[1]),
        runId: decodeURIComponent(rehearsalReportMatch[2]),
      };
    }

    const practicePlanMatch = normalized.match(
      /^\/rehearsal\/([^/]+)\/plan\/([^/]+)$/,
    );
    if (practicePlanMatch) {
      return {
        name: "practice-plan",
        projectId: decodeURIComponent(practicePlanMatch[1]),
        sourceFullRunId: decodeURIComponent(practicePlanMatch[2]),
      };
    }

    const focusedPracticeMatch = normalized.match(
      /^\/rehearsal\/([^/]+)\/focus\/([^/]+)$/,
    );
    if (focusedPracticeMatch) {
      const searchParams = new URLSearchParams(currentSearch);
      return {
        name: "focused-practice",
        projectId: decodeURIComponent(focusedPracticeMatch[1]),
        goalId: decodeURIComponent(focusedPracticeMatch[2]),
        sourceFullRunId: searchParams.get("sourceFullRunId") ?? "",
      };
    }

    const challengeQnaMatch = normalized.match(
      /^\/rehearsal\/([^/]+)\/challenge\/([^/]+)$/,
    );
    if (challengeQnaMatch) {
      return {
        name: "challenge-qna",
        projectId: decodeURIComponent(challengeQnaMatch[1]),
        sourceFullRunId: decodeURIComponent(challengeQnaMatch[2]),
      };
    }

    const rehearsalMatch = normalized.match(/^\/rehearsal\/([^/]+)$/);
    if (rehearsalMatch) {
      const searchParams = new URLSearchParams(currentSearch);
      return {
        name: "rehearsal",
        presenterInitialSlideIndex: parseRouteNonNegativeInteger(
          searchParams.get("slideIndex"),
        ),
        presenterInitialStepIndex: parseRouteNonNegativeInteger(
          searchParams.get("stepIndex"),
        ),
        presenterSessionId: searchParams.get("presenterSessionId") ?? undefined,
        presenterWindow: searchParams.get("presenterWindow") === "1",
        snapshotPreparationId:
          searchParams.get("snapshotPreparationId") ?? undefined,
        sourceFullRunId: searchParams.get("sourceFullRunId") ?? undefined,
        sourceGoalSetId: searchParams.get("sourceGoalSetId") ?? undefined,
        projectId: decodeURIComponent(rehearsalMatch[1]),
      };
    }

    const presentMatch = normalized.match(/^\/present\/([^/]+)$/);
    if (presentMatch) {
      const searchParams = new URLSearchParams(currentSearch);
      const sessionId = searchParams.get("sessionId") ?? undefined;
      return {
        name: "present",
        deckId: decodeURIComponent(presentMatch[1]),
        sessionId,
      };
    }

    if (normalized === "/") {
      return { name: "home" };
    }
    return { name: "not-found" };
  } catch {
    return { name: "not-found" };
  }
}

function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function App() {
  const [route, setRoute] = useState(() => getRoute());

  useEffect(() => {
    const handleRouteChange = () => setRoute(getRoute());
    window.addEventListener("popstate", handleRouteChange);
    return () => window.removeEventListener("popstate", handleRouteChange);
  }, []);

  const auth = useQuery({
    queryKey: authMeQueryKey,
    queryFn: () => fetchCurrentUser(),
    retry: false,
  });

  if (auth.isPending && shouldWaitForAuthResolution(route)) {
    return <AuthLoadingFallback />;
  }

  if (route.name === "home" && !auth.data) {
    return <LandingPage onNavigate={navigateTo} />;
  }

  if (!shouldRenderAppFrame(route)) {
    return renderRoute(route, auth.data ?? undefined);
  }

  return (
    <AppFrame
      isAuthenticated={Boolean(auth.data)}
      route={route}
      user={auth.data ?? undefined}
    >
      {renderRoute(route, auth.data ?? undefined)}
    </AppFrame>
  );
}

export function shouldWaitForAuthResolution(route: Route) {
  return ![
    "login",
    "signup",
    "design-system",
    "mockup",
    "report-mockup",
    "audience-session",
    "audience-activity",
    "present",
    "deck-render",
    "not-found",
  ].includes(route.name);
}

export function shouldRenderAppFrame(route: Route) {
  return (
    route.name !== "login" &&
    route.name !== "signup" &&
    route.name !== "design-system" &&
    route.name !== "mockup" &&
    route.name !== "project-editor" &&
    route.name !== "presentation" &&
    route.name !== "present" &&
    route.name !== "rehearsal" &&
    route.name !== "report-mockup" &&
    route.name !== "audience-session" &&
    route.name !== "audience-activity" &&
    route.name !== "deck-render"
  );
}

function renderRoute(route: Route, user?: AuthUser) {
  if (route.name === "design-system") return <RedesignSystemPage />;
  if (route.name === "mockup") {
    return <OrbitMockupFlow onNavigate={navigateTo} screen={route.screen} />;
  }
  if (route.name === "login") {
    return (
      <OrbitAuthPage
        isAuthenticated={Boolean(user)}
        mode="login"
        onNavigate={navigateTo}
      />
    );
  }
  if (route.name === "signup") {
    return (
      <OrbitAuthPage
        isAuthenticated={Boolean(user)}
        mode="register"
        onNavigate={navigateTo}
      />
    );
  }
  if (route.name === "create-deck") return <AiPptWizardPage />;
  if (route.name === "project-list") {
    return <ProjectExplorerPage onNavigate={navigateTo} />;
  }
  if (route.name === "rehearsal-project-list") {
    return <RehearsalProjectPickerPage onNavigate={navigateTo} />;
  }
  if (route.name === "project-editor") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <Suspense fallback={<EditorLoadingFallback />}>
          <EditorShell projectId={route.projectId} />
        </Suspense>
      </ProjectAccessGate>
    );
  }
  if (route.name === "project-brief") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <PresentationBriefPage projectId={route.projectId} />
      </ProjectAccessGate>
    );
  }
  if (route.name === "project-history") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <DeckVersionHistoryPage projectId={route.projectId} />
      </ProjectAccessGate>
    );
  }
  if (route.name === "activity-results") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <ActivityResultsPage
          projectId={route.projectId}
          sessionId={route.sessionId}
        />
      </ProjectAccessGate>
    );
  }
  if (route.name === "story-style-color") {
    return (
      <AiPptStyleColorPage
        jobId={route.jobId}
        projectId={route.projectId}
      />
    );
  }
  if (route.name === "ai-deck-generation") {
    return (
      <AiDeckGenerationPage
        jobId={route.jobId}
        projectId={route.projectId}
      />
    );
  }
  if (route.name === "project-request")
    return <ProjectAccessRequestPage projectId={route.projectId} />;
  if (route.name === "audience-session") {
    return <AudienceSessionPage sessionId={route.sessionId} />;
  }
  if (route.name === "audience-activity") {
    return (
      <AudienceSessionPage
        activityId={route.activityId}
        sessionId={route.sessionId}
      />
    );
  }
  if (route.name === "presentation") {
    return (
      <PresentationWorkspace
        fallbackDeck={
          route.projectId === demoIds.projectId ? demoDeck : undefined
        }
        projectId={route.projectId}
      />
    );
  }
  if (route.name === "present") {
    return <PresentWindow deckId={route.deckId} sessionId={route.sessionId} />;
  }
  if (route.name === "rehearsal") {
    return (
      <RehearsalWorkspace
        projectId={route.projectId}
        presenterInitialSlideIndex={route.presenterInitialSlideIndex}
        presenterInitialStepIndex={route.presenterInitialStepIndex}
        presenterSessionId={route.presenterSessionId}
        presenterWindow={route.presenterWindow}
        snapshotPreparationId={route.snapshotPreparationId}
        sourceFullRunId={route.sourceFullRunId}
        sourceGoalSetId={route.sourceGoalSetId}
        fallbackDeck={
          route.projectId === demoIds.projectId ? demoDeck : undefined
        }
      />
    );
  }
  if (route.name === "rehearsal-report") {
    return (
      <RehearsalReportPage
        key={`${route.projectId}:${route.runId}`}
        projectId={route.projectId}
        runId={route.runId}
      />
    );
  }
  if (route.name === "practice-plan") {
    return (
      <PracticePlanPage
        projectId={route.projectId}
        sourceFullRunId={route.sourceFullRunId}
      />
    );
  }
  if (route.name === "focused-practice") {
    return (
      <FocusedPracticePage
        projectId={route.projectId}
        goalId={route.goalId}
        sourceFullRunId={route.sourceFullRunId}
      />
    );
  }
  if (route.name === "challenge-qna") {
    return (
      <ChallengeQnaPage
        projectId={route.projectId}
        sourceFullRunId={route.sourceFullRunId}
      />
    );
  }
  if (route.name === "report-project-overview") {
    return (
      <RehearsalProjectOverviewPage
        key={route.projectId}
        projectId={route.projectId}
      />
    );
  }
  if (route.name === "report-list") {
    const projectId =
      new URLSearchParams(window.location.search).get("project") ?? undefined;
    return <RehearsalReportListPage projectId={projectId} />;
  }
  if (route.name === "report-mockup") {
    return (
      <RehearsalReportPage
        initialDeck={demoDeck}
        initialReport={reportMockupReport}
        initialRun={reportMockupRun}
        projectId={demoIds.projectId}
        runId={reportMockupRunId}
      />
    );
  }
  if (route.name === "deck-render") {
    return <DeckRenderPage />;
  }
  if (route.name === "not-found") {
    return (
      <OrbitEmptyState
        action={
          <>
            <OrbitButton onClick={() => navigateTo("/")}>홈으로</OrbitButton>
            <OrbitButton
              onClick={() => navigateTo("/project")}
              variant="secondary"
            >
              프로젝트 보기
            </OrbitButton>
          </>
        }
        description="주소가 바뀌었거나 존재하지 않는 페이지입니다."
        title="페이지를 찾을 수 없습니다."
      />
    );
  }
  if (route.name === "home") {
    return (
      <OrbitWorkspaceHome
        onNavigate={navigateTo}
        userName={user?.displayName}
      />
    );
  }
  return null;
}

function AuthLoadingFallback() {
  return (
    <main className="orbit-page">
      <OrbitEmptyState
        description="로그인 상태와 작업 공간을 확인하고 있습니다."
        title="ORBIT를 준비하고 있어요."
      />
    </main>
  );
}

function parseRouteNonNegativeInteger(value: string | null) {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

export function isDeckRenderRouteEnabled() {
  return import.meta.env.DEV || import.meta.env.MODE === "test";
}

export function DeckRenderPage() {
  const payload = readDeckRenderPayload();
  if (!payload) {
    return (
      <div data-testid="deck-render-error">Deck render payload missing.</div>
    );
  }

  const slide = payload.deck.slides[payload.slideIndex];
  if (!slide) {
    return (
      <div data-testid="deck-render-error">Deck render slide missing.</div>
    );
  }

  return (
    <main
      aria-label="Deck render fixture"
      data-testid="deck-render-page"
      style={{ margin: 0, padding: 0 }}
    >
      <ReadOnlySlideCanvas deck={payload.deck} slide={slide} />
    </main>
  );
}

function readDeckRenderPayload(): { deck: Deck; slideIndex: number } | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(deckRenderPayloadStorageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { deck?: unknown; slideIndex?: unknown };
    const deck = deckSchema.parse(parsed.deck);
    const slideIndex =
      typeof parsed.slideIndex === "number" &&
      Number.isInteger(parsed.slideIndex)
        ? parsed.slideIndex
        : 0;
    return { deck, slideIndex };
  } catch {
    return null;
  }
}

function AppFrame(props: {
  children: ReactNode;
  isAuthenticated: boolean;
  route: Route;
  user?: AuthUser;
}) {
  const { children, isAuthenticated, route, user } = props;
  const queryClient = useQueryClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const isHomeDashboard = route.name === "home";
  const userLabel = user ? getUserLabel(user) : "로그인";
  const userInitial = user ? getUserInitial(user) : "U";

  async function handleLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      const response = await fetch("/api/v1/auth/logout", {
        credentials: "include",
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("로그아웃하지 못했습니다.");
      }
      await queryClient.cancelQueries({ queryKey: authMeQueryKey });
      markAuthLoggedOut(queryClient);
      navigateTo("/login");
    } finally {
      setIsLoggingOut(false);
    }
  }
  return (
    <div
      className={`orbit-layout orbit-product-shell orbit-headerless-shell${
        isHomeDashboard ? " orbit-home-shell" : ""
      }`}
    >
      <OrbitAppHeader
        activeItem={getAppNavigationItem(route)}
        isAuthenticated={isAuthenticated}
        isLoggingOut={isLoggingOut}
        onLogout={() => void handleLogout()}
        onNavigate={navigateTo}
        userInitial={userInitial}
        userLabel={userLabel}
      />
      <main className="orbit-page">{children}</main>
    </div>
  );
}

export function getAppNavigationItem(route: Route): OrbitAppNavigationItem {
  if (route.name === "home") return "home";
  if (
    route.name === "report-list" ||
    route.name === "report-project-overview" ||
    route.name === "rehearsal-report"
  ) {
    return "reports";
  }
  if (
    route.name === "rehearsal" ||
    route.name === "rehearsal-project-list"
  ) {
    return "rehearsal";
  }
  return "project";
}

function getUserInitial(user: AuthUser) {
  const source = user.displayName?.trim() || getUserLabel(user) || "U";
  return source.slice(0, 1).toUpperCase();
}

function getUserLabel(user: AuthUser) {
  return user.email?.trim() || user.userId;
}

async function readApiError(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return fallback;

  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof body.message === "string") return body.message;
    if (Array.isArray(body.message)) return body.message.join(", ");
    if (typeof body.error === "string") return body.error;
  } catch {
    return text;
  }

  return fallback;
}

function ProjectAccessGate(props: { children: ReactNode; projectId: string }) {
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: ["project-access", props.projectId],
    queryFn: () => fetchProjectAccess(props.projectId),
    retry: shouldRetryProjectAccess,
  });
  const isUnauthorized =
    access.error instanceof ProjectAccessRequestError &&
    access.error.status === 401;
  const membership = access.data?.membership ?? null;
  const acceptedMembership =
    membership?.status === "accepted" ? membership : null;
  const hasAcceptedMembership = acceptedMembership !== null;
  const failureBehavior = getProjectAccessFailureBehavior(
    access.error,
    hasAcceptedMembership,
  );

  useEffect(() => {
    const membership = access.data?.membership;
    if (access.isSuccess && membership?.status !== "accepted") {
      navigateTo(`/project/${encodeURIComponent(props.projectId)}/request`);
    }
  }, [access.data?.membership, access.isSuccess, props.projectId]);

  useEffect(() => {
    if (!isUnauthorized) return;

    markAuthLoggedOut(queryClient);
    navigateTo("/login");
  }, [isUnauthorized, queryClient]);

  if (access.isLoading) return <EditorLoadingFallback />;
  if (failureBehavior === "login") return <AuthLoadingFallback />;
  if (access.isError && failureBehavior === "blocking") {
    return (
      <ProjectAccessError
        onRetry={() => void access.refetch()}
        projectId={props.projectId}
      />
    );
  }
  if (!hasAcceptedMembership)
    return <EditorLoadingFallback />;

  return (
    <ProjectAccessProvider membership={acceptedMembership}>
      {access.isError && failureBehavior === "preserve" ? (
        <ProjectAccessRecoveryNotice onRetry={() => void access.refetch()} />
      ) : null}
      {props.children}
    </ProjectAccessProvider>
  );
}

function ProjectAccessRecoveryNotice(props: { onRetry: () => void }) {
  return (
    <aside className="orbit-project-access-recovery" role="status">
      <span>권한 정보를 다시 확인하지 못했지만 작업 화면은 유지하고 있습니다.</span>
      <OrbitButton onClick={props.onRetry} size="compact" variant="secondary">
        다시 확인
      </OrbitButton>
    </aside>
  );
}

function ProjectAccessError(props: { onRetry: () => void; projectId: string }) {
  return (
    <ProjectAccessLayout projectId={props.projectId}>
      <OrbitFailureState
        description="잠시 후 다시 시도하거나 프로젝트 소유자에게 권한 상태를 확인해 주세요."
        onRetry={props.onRetry}
        retryLabel="다시 확인"
        title="프로젝트 권한을 확인하지 못했습니다."
      />
    </ProjectAccessLayout>
  );
}

function ProjectAccessRequestPage(props: { projectId: string }) {
  const queryClient = useQueryClient();
  const [role, setRole] =
    useState<Exclude<ProjectMemberRole, "owner">>("editor");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const access = useQuery({
    queryKey: ["project-access", props.projectId],
    queryFn: () => fetchProjectAccess(props.projectId),
    retry: false,
  });

  const membership = access.data?.membership;

  useEffect(() => {
    if (membership?.status === "accepted") {
      navigateTo(`/project/${encodeURIComponent(props.projectId)}`);
    }
  }, [membership?.status, props.projectId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const response = await requestProjectAccess(props.projectId, role);
      queryClient.setQueryData(["project-access", props.projectId], response);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "프로젝트 권한 요청에 실패했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (access.isLoading) return <EditorLoadingFallback />;

  if (access.isError) {
    return (
      <ProjectAccessLayout projectId={props.projectId}>
        <OrbitFailureState
          description="연결을 확인한 뒤 다시 시도해 주세요."
          onRetry={() => void access.refetch()}
          retryLabel="다시 확인"
          title="권한 상태를 확인하지 못했습니다."
        />
      </ProjectAccessLayout>
    );
  }

  if (membership?.status === "pending") {
    return (
      <ProjectAccessLayout
        project={access.data?.project}
        projectId={props.projectId}
      >
        <article className="orbit-access-message">
          <span className="redesign-eyebrow">APPROVAL PENDING</span>
          <h1>승인을 기다리고 있어요.</h1>
          <p>
            프로젝트 소유자가 요청을 확인하고 있습니다. 승인되면 이 프로젝트에
            접근할 수 있습니다.
          </p>
          <dl className="project-request-meta">
            <div>
              <dt>요청 권한</dt>
              <dd>{getProjectAccessRoleLabel(membership.role)}</dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>대기 중</dd>
            </div>
          </dl>
          <OrbitButton
            onClick={() => void access.refetch()}
            variant="secondary"
          >
            승인 상태 다시 확인
          </OrbitButton>
          <button
            className="orbit-access-back"
            onClick={() => navigateTo("/project")}
            type="button"
          >
            프로젝트 목록으로
          </button>
        </article>
      </ProjectAccessLayout>
    );
  }

  return (
    <ProjectAccessLayout
      project={access.data?.project}
      projectId={props.projectId}
    >
      <form className="orbit-access-message" onSubmit={handleSubmit}>
        <span className="redesign-eyebrow">ACCESS REQUIRED</span>
        <h1>
          이 프로젝트에 참여하려면
          <br />
          승인이 필요해요.
        </h1>
        <p>
          이 프로젝트는 승인된 사용자만 열 수 있습니다. 필요한 권한을 선택해서
          프로젝트 소유자에게 요청하세요.
        </p>
        <div
          className="project-request-options"
          role="radiogroup"
          aria-label="요청 권한"
        >
          <label className={role === "editor" ? "active" : ""}>
            <input
              checked={role === "editor"}
              name="project-role"
              onChange={() => setRole("editor")}
              type="radio"
              value="editor"
            />
            <strong>편집 가능</strong>
            <span>프로젝트를 열고 슬라이드를 수정할 수 있습니다.</span>
          </label>
          <label className={role === "viewer" ? "active" : ""}>
            <input
              checked={role === "viewer"}
              name="project-role"
              onChange={() => setRole("viewer")}
              type="radio"
              value="viewer"
            />
            <strong>보기 전용</strong>
            <span>프로젝트 내용을 읽고 확인할 수 있습니다.</span>
          </label>
        </div>
        {error ? (
          <p className="orbit-access-error" role="alert">
            {error}
          </p>
        ) : null}
        <OrbitButton disabled={isSubmitting} type="submit">
          {isSubmitting ? "요청 중..." : "권한 요청하기"}
        </OrbitButton>
        <button
          className="orbit-access-back"
          onClick={() => navigateTo("/project")}
          type="button"
        >
          프로젝트 목록으로
        </button>
      </form>
    </ProjectAccessLayout>
  );
}

function ProjectAccessLayout(props: {
  children: ReactNode;
  project?: Project;
  projectId: string;
}) {
  return (
    <section className="orbit-project-access">
      <aside className="orbit-access-context">
        <div className="orbit-access-icon">
          <IconFileText aria-hidden="true" size={26} />
        </div>
        <p className="redesign-eyebrow">PRIVATE PROJECT</p>
        <h2>{props.project?.title ?? "비공개 프로젝트"}</h2>
        <p>승인된 구성원만 발표자료를 열고 함께 작업할 수 있습니다.</p>
        <dl>
          <div>
            <dt>프로젝트 ID</dt>
            <dd>{props.project?.projectId ?? props.projectId}</dd>
          </div>
          <div>
            <dt>생성일</dt>
            <dd>
              {props.project
                ? new Date(props.project.createdAt).toLocaleDateString("ko-KR")
                : "확인 중"}
            </dd>
          </div>
        </dl>
      </aside>
      <div className="orbit-access-card">{props.children}</div>
    </section>
  );
}

export function getProjectAccessRoleLabel(role: ProjectMemberRole) {
  if (role === "owner") return "소유자";
  return role === "editor" ? "편집 가능" : "보기 전용";
}

function EditorLoadingFallback() {
  return (
    <section
      aria-label="에디터를 불러오는 중"
      className="editor-loading-page redesign-dark"
      role="status"
    >
      <span aria-hidden="true" className="editor-loading-indicator" />
    </section>
  );
}
