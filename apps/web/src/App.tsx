import {
  aiTemplateDeckGenerationJobResultSchema,
  allowedAssetMimeTypes,
  deckSchema,
  demoIds,
  maxAssetUploadSizeBytes,
  type AiTemplateDeckGenerationJobResult,
  type Deck,
  type DeckElement,
  type FilePurpose,
  type GenerateDeckJobResult,
  type Job,
  type PptxOoxmlGenerationJobResult,
  type Project,
  type ProjectMemberRole,
  type ProjectMemberStatus,
  type RehearsalReport,
  type RehearsalRun
} from "@orbit/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  Clock,
  FileUp,
  FileText,
  LayoutTemplate,
  ListChecks,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  UploadCloud,
  Trash2
} from "lucide-react";
import type {
  CSSProperties,
  ChangeEvent,
  DragEvent,
  FormEvent,
  MouseEvent,
  ReactNode
} from "react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createDemoDeck } from "../../../packages/editor-core/src/index";
import orbitLogo from "./assets/orbit-logo.png";
import { AppSidebar } from "./components/AppSidebar";
import {
  createProject,
  deleteProject,
  fetchProjects,
  resolveAssetMimeType,
  uploadProjectAsset
} from "./features/projects/ProjectAssetWorkspace";
import {
  RehearsalReportPage,
  RehearsalWorkspace
} from "./features/rehearsal/RehearsalWorkspace";
import { RehearsalReportListPage } from "./features/rehearsal/RehearsalReportListPage";
import { RehearsalProjectOverviewPage } from "./features/rehearsal/RehearsalProjectOverviewPage";
import { PresentationWorkspace } from "./features/presentation/PresentationWorkspace";
import { AudienceSessionPage } from "./pages/audience/AudienceSessionPage";
import { PresentWindow } from "./features/rehearsal/presenter/PresentWindow";
import {
  SemanticCueLabRoute,
  isSemanticCueLabRouteEnabled
} from "./features/rehearsal/semantic-cue-lab/SemanticCueLabRoute";
import { ReadOnlySlideCanvas } from "./features/slides/rendering";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ExtractedFile = {
  referenceDocumentId?: string;
  fileName: string;
  kind: string;
  status: string;
  message?: string;
  rawText: string;
  cleanedText?: string;
  cleanupStatus?: string;
  cleanupMessage?: string;
  keywords?: PresentationKeyword[];
  keywordStatus?: string;
  keywordMessage?: string;
  indexingStatus?: string;
  indexingMessage?: string;
  chunkCount?: number;
};

type JobResult = {
  files?: ExtractedFile[];
};

type PptxOoxmlGenerationResponse = {
  job: Job;
};

type AiTemplateDeckGenerationResponse = {
  job: Job;
};

type GenerateDeckJobResponse = {
  job: Job;
};

type ExtractJobResponse = {
  job: Job;
};

type ReferenceGenerationInput = {
  references: Array<{ fileId: string }>;
  referenceKeywords: Array<{ text: string }>;
  referenceContext: Array<{ fileId: string; title: string; content: string }>;
  succeededFiles: ExtractedFile[];
  failedFiles: ExtractedFile[];
};

type GenerateDeckPayloadInput = {
  topic: string;
  prompt: string;
  designPrompt?: string;
  duration: number;
  minSlides: number;
  maxSlides: number;
  template: string;
  metadata: {
    audience: string;
    purpose: string;
    tone: string;
  };
  design: GenerateDeckDesignDirection;
  designReferences: Array<{ fileId: string }>;
  referenceInput: ReferenceGenerationInput;
};

type GenerateDeckDesignDirection = {
  profile?:
    | "executive-report"
    | "startup-pitch"
    | "editorial"
    | "technical"
    | "training";
  visualRhythm: "auto" | "clean" | "editorial" | "bold" | "technical";
  densityTarget: "low" | "medium" | "high";
  mediaPolicy: "avoid" | "balanced" | "placeholder-ok";
  layoutDiversity: "stable" | "varied";
  stylePackId?: string;
  slidePresetId?: string;
};
type GenerateDeckDesignProfile = NonNullable<GenerateDeckDesignDirection["profile"]>;
type GenerateDeckDesignProfileChoice = "auto" | GenerateDeckDesignProfile;
export type HomeTemplateStyleId =
  | "simple-basic"
  | "presentation-document"
  | "submission-document";
export type HomeTemplateStyle = {
  id: HomeTemplateStyleId;
  title: string;
  description: string;
};
type TemplateStyleDesignOverrides = Partial<
  Pick<GenerateDeckDesignDirection, "densityTarget" | "layoutDiversity" | "mediaPolicy">
>;
const templateStyleDefaultOption = "style-default" as const;
type TemplateDensityTargetOption =
  | typeof templateStyleDefaultOption
  | GenerateDeckDesignDirection["densityTarget"];
type TemplateLayoutDiversityOption =
  | typeof templateStyleDefaultOption
  | GenerateDeckDesignDirection["layoutDiversity"];
type TemplateMediaPolicyOption =
  | typeof templateStyleDefaultOption
  | GenerateDeckDesignDirection["mediaPolicy"];

type GenerateDeckTargetProject = {
  created: boolean;
  project: Project | null;
  projectId: string;
};

type PresentationKeyword = {
  keyword: string;
  reason: string;
  priority: "high" | "medium" | "low" | string;
};

export type UploadRole = "content" | "design" | "both";

export type UploadFile = {
  id: string;
  file: File;
  role: UploadRole;
};

type RejectedFile = {
  name: string;
  reason: string;
};

export type Route =
  | { name: "login" }
  | { name: "home"; templateStyleId?: HomeTemplateStyleId }
  | { name: "create-deck" }
  | { name: "project-list" }
  | { name: "project-editor"; projectId: string }
  | { name: "project-request"; projectId: string }
  | { name: "audience-session"; sessionId: string }
  | { name: "presentation"; projectId: string }
  | { name: "present"; deckId: string; sessionId?: string }
  | {
      name: "rehearsal";
      presenterInitialSlideIndex?: number;
      presenterInitialStepIndex?: number;
      presenterSessionId?: string;
      presenterWindow?: boolean;
      projectId: string;
    }
  | { name: "rehearsal-report"; projectId: string; runId: string }
  | { name: "report-mockup" }
  | { name: "report-list" }
  | { name: "report-project-overview"; projectId: string }
  | { name: "semantic-cue-lab" }
  | { name: "deck-render" };

export const deckRenderPayloadStorageKey = "orbit.deckRenderPayload.v1";

type AuthUser = {
  userId: string;
  email?: string;
  displayName?: string;
};

type ProjectAccessResponse = {
  project: Project;
  membership: {
    role: ProjectMemberRole;
    status: ProjectMemberStatus;
  } | null;
};

const EditorShell = lazy(() =>
  import("./features/editor/shell/EditorShell").then((module) => ({
    default: module.EditorShell
  }))
);

export const defaultHomeTemplateStyleId: HomeTemplateStyleId = "simple-basic";
export const homeTemplateStyles: HomeTemplateStyle[] = [
  {
    id: "simple-basic",
    title: "심플 베이직 스타일",
    description: "깔끔한 기본형 문서 디자인"
  },
  {
    id: "presentation-document",
    title: "발표용 문서 스타일",
    description: "키워드와 발표 메모 중심"
  },
  {
    id: "submission-document",
    title: "제출용 문서 스타일",
    description: "본문과 근거가 자족적인 보고형"
  }
];
const homeToneOptions: Array<{
  value: "professional" | "friendly" | "confident" | "concise";
  label: string;
  description: string;
}> = [
  {
    value: "professional",
    label: "Professional",
    description: "정돈된 비즈니스 톤"
  },
  {
    value: "friendly",
    label: "Friendly",
    description: "부드럽고 설명적인 톤"
  },
  {
    value: "confident",
    label: "Confident",
    description: "확신 있는 제안 톤"
  },
  {
    value: "concise",
    label: "Concise",
    description: "짧고 핵심적인 톤"
  }
];
const uploadRoleLabels: Record<UploadRole, string> = {
  content: "내용 참고",
  design: "디자인 참고",
  both: "둘 다"
};
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
  status: "succeeded",
  error: null,
  rawAudioDeletedAt: null,
  createdAt: "2026-07-01T08:54:12.000Z",
  updatedAt: reportMockupGeneratedAt
};
const reportMockupReport: RehearsalReport = {
  reportId: "report_mockup",
  runId: reportMockupRunId,
  projectId: demoIds.projectId,
  deckId: demoIds.deckId,
  transcriptRetained: false,
  transcript: null,
  metrics: {
    durationSeconds: 286,
    wordsPerMinute: 128,
    fillerWordCount: 3,
    pauseCount: 2,
    keywordCoverage: 0.86,
    keywordCoverageMeasurement: { state: "measured" }
  },
  speedSamples: [
    { startSecond: 0, endSecond: 30, wordsPerMinute: 118 },
    { startSecond: 30, endSecond: 60, wordsPerMinute: 132 },
    { startSecond: 60, endSecond: 90, wordsPerMinute: 126 }
  ],
  fillerWordDetails: [{ word: "음", count: 3 }],
  pauseDetails: [{ startSecond: 144, endSecond: 146, durationSeconds: 2 }],
  missedKeywords: [{ slideId: "slide_1", keywordId: "kw_1", text: "핵심 메시지" }],
  utteranceOutcomes: [],
  semanticCueDecisions: [],
  semanticEvaluation: {
    state: "unavailable",
    measurementMode: "none",
    reasons: ["evaluation_not_run"],
    retryable: false
  },
  semanticCueOutcomes: [],
  slideTimings: [{ slideId: "slide_1", targetSeconds: 60, actualSeconds: 58 }],
  slideInsights: [{ slideId: "slide_1", fillerWordCount: 2, pauseCount: 1 }],
  qnaSummary: {
    questionCount: 0,
    questionSummary: "",
    unclearTopics: []
  },
  coaching: {
    status: "succeeded",
    summary: "핵심 메시지는 안정적으로 전달됐고, 속도도 발표 시간에 잘 맞습니다.",
    strengths: [
      "도입부에서 발표 목적을 빠르게 제시했습니다.",
      "중요 키워드를 반복해 청중이 흐름을 따라가기 좋았습니다.",
      "슬라이드 전환 사이의 멈춤이 과하지 않았습니다."
    ],
    improvements: [
      "중간 설명에서 일부 filler 표현이 반복됩니다.",
      "마무리 전에 다음 행동을 더 명확하게 요청하면 좋습니다.",
      "수치가 있는 문장은 한 번 더 천천히 읽는 편이 좋습니다."
    ],
    nextPracticeFocus:
      "다음 연습에서는 결론 슬라이드의 CTA 문장을 먼저 고정하고, 수치 설명 구간의 호흡을 조금 더 길게 가져가세요.",
    message: ""
  },
  generatedAt: reportMockupGeneratedAt
};
const pptxAccept = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pptx"
].join(",");
const homeAssetAccept = [
  ...allowedAssetMimeTypes,
  ".pdf",
  ".pptx",
  ".docx",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp"
].join(",");
const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const simpleBasicStylePackId = defaultHomeTemplateStyleId;
const referenceContextMaxChars = 12_000;

async function fetchCurrentUser(): Promise<AuthUser> {
  const response = await fetch("/api/v1/auth/me", {
    credentials: "include"
  });
  if (!response.ok) {
    throw new Error("Unauthenticated");
  }
  const payload = (await response.json()) as AuthUser | { user: AuthUser };
  return "user" in payload ? payload.user : payload;
}

async function fetchProjectAccess(projectId: string): Promise<ProjectAccessResponse> {
  const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/access`, {
    credentials: "include"
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "프로젝트 권한을 확인하지 못했습니다."));
  }
  return response.json() as Promise<ProjectAccessResponse>;
}

async function requestProjectAccess(
  projectId: string,
  role: Exclude<ProjectMemberRole, "owner">
): Promise<ProjectAccessResponse> {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/access-requests`,
    {
      body: JSON.stringify({ role }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST"
    }
  );
  if (!response.ok) {
    throw new Error(await readApiError(response, "프로젝트 권한 요청에 실패했습니다."));
  }
  return response.json() as Promise<ProjectAccessResponse>;
}

export function getHomeTemplateStyleId(
  value: string | null | undefined
): HomeTemplateStyleId | undefined {
  const normalized = value?.trim();
  return homeTemplateStyles.some((style) => style.id === normalized)
    ? (normalized as HomeTemplateStyleId)
    : undefined;
}

export function getHomeTemplateStylePath(styleId: HomeTemplateStyleId) {
  return `/?templateStyle=${encodeURIComponent(styleId)}`;
}

export function getRoute(
  pathname?: string,
  search?: string
): Route {
  const currentPathname =
    pathname ?? (typeof window === "undefined" ? "/" : window.location.pathname);
  const currentSearch =
    search ?? (typeof window === "undefined" ? "" : window.location.search);
  const normalized = currentPathname.replace(/\/+$/, "") || "/";

  if (normalized === "/login") return { name: "login" };
  if (normalized === "/createdeck") return { name: "create-deck" };
  if (normalized === "/project") return { name: "project-list" };
  if (normalized === "/reports") return { name: "report-list" };
  const reportProjectMatch = normalized.match(/^\/reports\/([^/]+)$/);
  if (reportProjectMatch) {
    return { name: "report-project-overview", projectId: decodeURIComponent(reportProjectMatch[1]) };
  }
  if (normalized === "/report_mockup") return { name: "report-mockup" };
  if (normalized === "/dev/semantic-cue-lab" && isSemanticCueLabRouteEnabled()) {
    return { name: "semantic-cue-lab" };
  }
  if (normalized === "/__deck-render" && isDeckRenderRouteEnabled()) {
    return { name: "deck-render" };
  }

  const audienceSessionMatch = normalized.match(/^\/audience\/([^/]+)$/);
  if (audienceSessionMatch) {
    return {
      name: "audience-session",
      sessionId: decodeURIComponent(audienceSessionMatch[1])
    };
  }

  const presentationMatch = normalized.match(/^\/presentation\/([^/]+)$/);
  if (presentationMatch) {
    return {
      name: "presentation",
      projectId: decodeURIComponent(presentationMatch[1])
    };
  }

  const projectRequestMatch = normalized.match(/^\/project\/([^/]+)\/request$/);
  if (projectRequestMatch) {
    return { name: "project-request", projectId: decodeURIComponent(projectRequestMatch[1]) };
  }

  const projectMatch = normalized.match(/^\/project\/([^/]+)$/);
  if (projectMatch) {
    return { name: "project-editor", projectId: decodeURIComponent(projectMatch[1]) };
  }

  const rehearsalReportMatch = normalized.match(/^\/rehearsal\/([^/]+)\/report\/([^/]+)$/);
  if (rehearsalReportMatch) {
    return {
      name: "rehearsal-report",
      projectId: decodeURIComponent(rehearsalReportMatch[1]),
      runId: decodeURIComponent(rehearsalReportMatch[2])
    };
  }

  const rehearsalMatch = normalized.match(/^\/rehearsal\/([^/]+)$/);
  if (rehearsalMatch) {
    const searchParams = new URLSearchParams(currentSearch);
    return {
      name: "rehearsal",
      presenterInitialSlideIndex: parseRouteNonNegativeInteger(searchParams.get("slideIndex")),
      presenterInitialStepIndex: parseRouteNonNegativeInteger(searchParams.get("stepIndex")),
      presenterSessionId: searchParams.get("presenterSessionId") ?? undefined,
      presenterWindow: searchParams.get("presenterWindow") === "1",
      projectId: decodeURIComponent(rehearsalMatch[1])
    };
  }

  const presentMatch = normalized.match(/^\/present\/([^/]+)$/);
  if (presentMatch) {
    const searchParams = new URLSearchParams(currentSearch);
    const sessionId = searchParams.get("sessionId") ?? undefined;
    return {
      name: "present",
      deckId: decodeURIComponent(presentMatch[1]),
      sessionId
    };
  }

  const searchParams = new URLSearchParams(currentSearch);
  const templateStyleId = getHomeTemplateStyleId(searchParams.get("templateStyle"));
  return templateStyleId ? { name: "home", templateStyleId } : { name: "home" };
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
    queryKey: ["auth", "me"],
    queryFn: fetchCurrentUser,
    retry: false
  });

  useEffect(() => {
    if (route.name === "home" && auth.isError) {
      window.history.replaceState({}, "", "/login");
      setRoute({ name: "login" });
    }
  }, [auth.isError, route.name]);

  if (!shouldRenderAppFrame(route)) {
    return renderRoute(route, auth.data);
  }

  return (
    <AppFrame
      isAuthenticated={auth.isSuccess}
      route={route}
      user={auth.data}
    >
      {renderRoute(route, auth.data)}
    </AppFrame>
  );
}

export function shouldRenderAppFrame(route: Route) {
  return (
    route.name !== "login" &&
    route.name !== "project-editor" &&
    route.name !== "presentation" &&
    route.name !== "present" &&
    route.name !== "rehearsal" &&
    route.name !== "rehearsal-report" &&
    route.name !== "report-project-overview" &&
    route.name !== "report-mockup" &&
    route.name !== "audience-session" &&
    route.name !== "semantic-cue-lab" &&
    route.name !== "deck-render"
  );
}

function renderRoute(route: Route, user?: AuthUser) {
  if (route.name === "login") return <LoginPage isAuthenticated={Boolean(user)} />;
  if (route.name === "create-deck") return <GenerateDeckView />;
  if (route.name === "project-list") return <ProjectListPage />;
  if (route.name === "project-editor") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <Suspense fallback={<EditorLoadingFallback />}>
          <EditorShell projectId={route.projectId} />
        </Suspense>
      </ProjectAccessGate>
    );
  }
  if (route.name === "project-request") return <ProjectAccessRequestPage projectId={route.projectId} />;
  if (route.name === "audience-session") {
    return <AudienceSessionPage sessionId={route.sessionId} />;
  }
  if (route.name === "presentation") {
    return (
      <PresentationWorkspace
        fallbackDeck={route.projectId === demoIds.projectId ? demoDeck : undefined}
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
        fallbackDeck={route.projectId === demoIds.projectId ? demoDeck : undefined}
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
  if (route.name === "report-project-overview") {
    return (
      <RehearsalProjectOverviewPage
        key={route.projectId}
        projectId={route.projectId}
      />
    );
  }
  if (route.name === "report-list") {
    const projectId = new URLSearchParams(window.location.search).get("project") ?? undefined;
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
  if (route.name === "semantic-cue-lab") {
    return <SemanticCueLabRoute />;
  }
  if (route.name === "deck-render") {
    return <DeckRenderPage />;
  }
  return <HomePage user={user} templateStyleId={route.templateStyleId} />;
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
    return <div data-testid="deck-render-error">Deck render payload missing.</div>;
  }

  const slide = payload.deck.slides[payload.slideIndex];
  if (!slide) {
    return <div data-testid="deck-render-error">Deck render slide missing.</div>;
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
      typeof parsed.slideIndex === "number" && Number.isInteger(parsed.slideIndex)
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const isHomeDashboard = route.name === "home";
  const userLabel = user ? getUserLabel(user) : "로그인";
  const userInitial = user ? getUserInitial(user) : "U";

  async function handleLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await fetch("/api/v1/auth/logout", {
        credentials: "include",
        method: "POST"
      });
      queryClient.setQueryData(["auth", "me"], undefined);
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      navigateTo("/login");
    } finally {
      setIsLoggingOut(false);
    }
  }
  return (
    <main
      className={`orbit-layout orbit-product-shell orbit-headerless-shell${
        isHomeDashboard ? " orbit-home-shell" : ""
      }`}
    >
      <div
        className={`orbit-product-body${
          isSidebarCollapsed ? " orbit-product-body-collapsed" : ""
        }`}
      >
        <AppSidebar
          isAuthenticated={isAuthenticated}
          isCollapsed={isSidebarCollapsed}
          isCreateDeckActive={route.name === "create-deck"}
          isHomeActive={route.name === "home"}
          isLoggingOut={isLoggingOut}
          isProjectActive={
            route.name === "project-list" ||
            route.name === "project-editor" ||
            route.name === "project-request"
          }
          isReportActive={route.name === "report-list" || route.name === "report-project-overview"}
          onCreateDeckClick={() => navigateTo("/createdeck")}
          onHomeClick={() => navigateTo("/")}
          onLoginClick={() => navigateTo("/login")}
          onLogoutClick={() => void handleLogout()}
          onProjectListClick={() => navigateTo("/project")}
          onReportClick={() => navigateTo("/reports")}
          onToggleCollapse={() => setIsSidebarCollapsed((current) => !current)}
          userInitial={userInitial}
          userLabel={userLabel}
        />
        <section className="orbit-page">{children}</section>
      </div>
    </main>
  );
}

function getUserInitial(user: AuthUser) {
  const source = user.displayName?.trim() || getUserLabel(user) || "U";
  return source.slice(0, 1).toUpperCase();
}

function getUserLabel(user: AuthUser) {
  return user.email?.trim() || user.userId;
}

function LoginPage(props: { isAuthenticated: boolean }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/v1/auth/${mode}`, {
        body: JSON.stringify({ email, password }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });

      if (!response.ok) {
        throw new Error(await readAuthError(response));
      }

      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      navigateTo("/");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : mode === "register"
            ? "회원가입에 실패했습니다."
            : "로그인에 실패했습니다."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="login-page">
      <form className="login-card" onSubmit={handleLogin}>
        <img alt="Orbit" src={orbitLogo} />
        <h1>{mode === "register" ? "회원가입" : "로그인"}</h1>
        <p>
          {mode === "register"
            ? "처음 사용하는 환경이라면 계정을 먼저 생성하세요."
            : "계정으로 로그인하면 Orbit 작업 공간으로 이동합니다."}
        </p>
        <div className="login-mode-switch" role="tablist" aria-label="인증 방식">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            로그인
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
          >
            회원가입
          </button>
        </div>
        <label>
          <span>이메일</span>
          <input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@orbit.dev"
            required
            type="email"
            value={email}
          />
        </label>
        <label>
          <span>비밀번호</span>
          <input
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="비밀번호"
            required
            type="password"
            value={password}
          />
        </label>
        {error ? <p className="auth-error">{error}</p> : null}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? mode === "register"
              ? "가입 중..."
              : "로그인 중..."
            : mode === "register"
              ? "계정 만들기"
              : "로그인"}
        </button>
      </form>
      {props.isAuthenticated ? (
        <button
          className="login-next-button"
          type="button"
          onClick={() => navigateTo("/")}
          aria-label="다음 화면으로 이동"
          title="다음 화면으로 이동"
        >
          <ArrowRight size={34} strokeWidth={2.4} />
        </button>
      ) : null}
    </section>
  );
}

async function readAuthError(response: Response) {
  const fallback = "로그인에 실패했습니다.";
  const text = await response.text();
  if (!text) return fallback;

  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
    if (Array.isArray(body.message)) return body.message.join(", ");
  } catch {
    return text;
  }

  return fallback;
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
  const access = useQuery({
    queryKey: ["project-access", props.projectId],
    queryFn: () => fetchProjectAccess(props.projectId),
    retry: false
  });

  useEffect(() => {
    const membership = access.data?.membership;
    if (access.isSuccess && membership?.status !== "accepted") {
      navigateTo(`/project/${encodeURIComponent(props.projectId)}/request`);
    }
  }, [access.data?.membership, access.isSuccess, props.projectId]);

  if (access.isLoading) return <EditorLoadingFallback />;
  if (access.isError) return <ProjectAccessError onRetry={() => void access.refetch()} />;
  if (access.data?.membership?.status !== "accepted") return <EditorLoadingFallback />;

  return <>{props.children}</>;
}

function ProjectAccessError(props: { onRetry: () => void }) {
  return (
    <section className="project-request-page">
      <article className="project-request-card">
        <span className="eyebrow">Project access</span>
        <h1>프로젝트 권한을 확인하지 못했습니다.</h1>
        <p>잠시 후 다시 시도하거나 프로젝트 소유자에게 권한 상태를 확인해 주세요.</p>
        <button type="button" onClick={props.onRetry}>
          다시 확인
        </button>
      </article>
    </section>
  );
}

function ProjectAccessRequestPage(props: { projectId: string }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Exclude<ProjectMemberRole, "owner">>("editor");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const access = useQuery({
    queryKey: ["project-access", props.projectId],
    queryFn: () => fetchProjectAccess(props.projectId),
    retry: false
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
        cause instanceof Error ? cause.message : "프로젝트 권한 요청에 실패했습니다."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (access.isLoading) return <EditorLoadingFallback />;

  if (membership?.status === "pending") {
    return (
      <section className="project-request-page">
        <article className="project-request-card">
          <span className="eyebrow">Project access</span>
          <h1>권한 요청을 보냈습니다.</h1>
          <p>
            프로젝트 소유자가 요청을 확인하고 있습니다. 승인되면 이 프로젝트에
            접근할 수 있습니다.
          </p>
          <dl className="project-request-meta">
            <div>
              <dt>요청 권한</dt>
              <dd>{membership.role}</dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>대기 중</dd>
            </div>
          </dl>
        </article>
      </section>
    );
  }

  return (
    <section className="project-request-page">
      <form className="project-request-card" onSubmit={handleSubmit}>
        <span className="eyebrow">Project access</span>
        <h1>프로젝트 접근 권한이 필요합니다.</h1>
        <p>
          이 프로젝트는 승인된 사용자만 열 수 있습니다. 필요한 권한을 선택해서
          프로젝트 소유자에게 요청하세요.
        </p>
        <div className="project-request-options" role="radiogroup" aria-label="요청 권한">
          <label className={role === "editor" ? "active" : ""}>
            <input
              checked={role === "editor"}
              name="project-role"
              onChange={() => setRole("editor")}
              type="radio"
              value="editor"
            />
            <strong>editor</strong>
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
            <strong>viewer</strong>
            <span>프로젝트 내용을 읽고 확인할 수 있습니다.</span>
          </label>
        </div>
        {error ? <p className="auth-error">{error}</p> : null}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "요청 중..." : "권한 요청하기"}
        </button>
      </form>
    </section>
  );
}

function HomePage(props: { user?: AuthUser; templateStyleId?: HomeTemplateStyleId }) {
  const queryClient = useQueryClient();
  const topicInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [topic, setTopic] = useState("");
  const [prompt, setPrompt] = useState("");
  const [designPrompt, setDesignPrompt] = useState("");
  const [selectedTemplateStyleId, setSelectedTemplateStyleId] =
    useState<HomeTemplateStyleId | undefined>(props.templateStyleId);
  const [templateDensityTarget, setTemplateDensityTarget] =
    useState<TemplateDensityTargetOption>(templateStyleDefaultOption);
  const [templateLayoutDiversity, setTemplateLayoutDiversity] =
    useState<TemplateLayoutDiversityOption>(templateStyleDefaultOption);
  const [templateMediaPolicy, setTemplateMediaPolicy] =
    useState<TemplateMediaPolicyOption>(templateStyleDefaultOption);
  const [tone, setTone] = useState<"professional" | "friendly" | "confident" | "concise">(
    "professional"
  );
  const [durationInput, setDurationInput] = useState("10");
  const [minSlidesInput, setMinSlidesInput] = useState("5");
  const [maxSlidesInput, setMaxSlidesInput] = useState("8");
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isCreatingBlankProject, setIsCreatingBlankProject] = useState(false);
  const [isReferenceDragging, setIsReferenceDragging] = useState(false);
  const totalSize = useMemo(
    () => uploads.reduce((sum, upload) => sum + upload.file.size, 0),
    [uploads]
  );
  const validationMessage = getHomeGenerationValidationMessage(
    topic,
    uploads,
    durationInput,
    minSlidesInput,
    maxSlidesInput,
    !selectedTemplateStyleId
  );

  useEffect(() => {
    setSelectedTemplateStyleId(props.templateStyleId);
    if (props.templateStyleId) {
      setUploads((current) => normalizeTemplateReferenceUploads(current));
      clearHomeGenerationFeedback();
    }
  }, [props.templateStyleId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runHomeDeckGeneration();
  }

  async function handleCreateBlankProject() {
    if (isImporting || isCreatingBlankProject) return;

    setIsCreatingBlankProject(true);
    clearHomeGenerationFeedback();

    try {
      const project = await createProject("새 프레젠테이션");
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigateTo(`/project/${project.projectId}`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "빈 프레젠테이션을 만들지 못했습니다."
      );
    } finally {
      setIsCreatingBlankProject(false);
    }
  }

  async function runHomeDeckGeneration() {
    if (isImporting) return;

    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setIsImporting(true);
    setError("");
    setJob(null);
    setStatus("프로젝트 생성 중...");

    try {
      const project = await createProject(getGeneratedDeckProjectTitle(topic));
      const uploadedAssets = new Map<string, string>();
      const allowDesignReferences = !selectedTemplateStyleId;

      for (const upload of uploads) {
        setStatus(`${upload.file.name} 업로드 중...`);
        const uploaded = await uploadProjectAsset(
          project.projectId,
          upload.file,
          getHomeUploadPurpose(upload, allowDesignReferences)
        );
        uploadedAssets.set(upload.id, uploaded.fileId);
      }

      const duration = parseHomeIntegerInput(durationInput) ?? 10;
      const minSlides = parseHomeIntegerInput(minSlidesInput) ?? 5;
      const maxSlides = parseHomeIntegerInput(maxSlidesInput) ?? 8;
      const hasDesignPptx =
        allowDesignReferences && hasHomeDesignPptxUpload(uploads);
      const referenceInput = hasDesignPptx
        ? buildReferenceGenerationInput([])
        : await extractHomeReferenceInput(
            project.projectId,
            uploads,
            uploadedAssets,
            {
              setJob,
              setStatus
            },
            !allowDesignReferences
          );
      const payload = hasDesignPptx
        ? buildAiTemplateDeckGenerationPayload({
            topic,
            prompt,
            designPrompt,
            duration,
            minSlides,
            maxSlides,
            tone,
            uploads,
            uploadedAssetFileIds: uploadedAssets
          })
        : buildHomeJsonFirstGenerateDeckPayload({
            topic,
            prompt,
            designPrompt,
            templateStyleId: selectedTemplateStyleId,
            templateStyleDesignOverrides: buildTemplateStyleDesignOverrides({
              densityTarget: templateDensityTarget,
              layoutDiversity: templateLayoutDiversity,
              mediaPolicy: templateMediaPolicy
            }),
            duration,
            minSlides,
            maxSlides,
            tone,
            referenceInput
          });
      setStatus("AI 덱 생성 중...");
      const response = await fetch(
        getHomeDeckGenerationJobEndpoint(
          project.projectId,
          uploads,
          allowDesignReferences
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        throw new Error(await readApiError(response, "AI 덱 생성을 시작하지 못했습니다."));
      }

      const data = (await response.json()) as
        | AiTemplateDeckGenerationResponse
        | GenerateDeckJobResponse;
      setJob(data.job);
      const completed = await pollJob(data.job.jobId, fetch, {
        timeoutMs: 300_000,
        delayMs: 1200
      });
      setJob(completed);

      if (completed.status === "failed") {
        throw new Error(
          completed.error?.message || completed.message || "AI 덱 생성에 실패했습니다."
        );
      }

      const result = hasDesignPptx
        ? getAiTemplateDeckGenerationJobResult(completed)
        : getGenerateDeckJobResult(completed);
      if (!result) {
        throw new Error("AI 덱 생성 결과를 읽지 못했습니다.");
      }

      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["deck", project.projectId] });
      navigateTo(
        hasDesignPptx
          ? `/project/${encodeURIComponent(project.projectId)}`
          : getGeneratedDeckProjectPath(result as GenerateDeckJobResult)
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "AI 덱 생성에 실패했습니다."
      );
      setStatus("");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleConvertPptx() {
    if (isImporting) return;

    const conversionValidationMessage =
      getHomePptxConversionValidationMessage(uploads);
    if (conversionValidationMessage) {
      setError(conversionValidationMessage);
      return;
    }

    const pptxUpload = uploads.find((upload) => isPptxFile(upload.file));
    if (!pptxUpload) {
      setError("변환할 PPTX 파일을 첨부하세요.");
      return;
    }

    setIsImporting(true);
    setError("");
    setJob(null);
    setStatus("프로젝트 생성 중...");

    try {
      const project = await createProject(
        getPptxConversionProjectTitle(pptxUpload.file.name)
      );
      setStatus(`${pptxUpload.file.name} 업로드 중...`);
      const uploaded = await uploadProjectAsset(
        project.projectId,
        pptxUpload.file,
        "pptx-import"
      );
      const payload = buildPptxOoxmlGenerationPayload({
        fileId: uploaded.fileId
      });
      setStatus("PPTX 변환 중...");
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(project.projectId)}/pptx-ooxml-generations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        throw new Error(await readApiError(response, "PPTX 변환을 시작하지 못했습니다."));
      }

      const data = (await response.json()) as PptxOoxmlGenerationResponse;
      setJob(data.job);
      const completed = await pollJob(data.job.jobId, fetch, {
        timeoutMs: 300_000,
        delayMs: 1200
      });
      setJob(completed);

      if (completed.status === "failed") {
        throw new Error(
          completed.error?.message || completed.message || "PPTX 변환에 실패했습니다."
        );
      }

      const result = getPptxOoxmlGenerationJobResult(completed);
      if (!result) {
        throw new Error("PPTX 변환 결과를 읽지 못했습니다.");
      }

      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["deck", project.projectId] });
      navigateTo(getPptxOoxmlGeneratedProjectPath(project.projectId));
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "PPTX 변환에 실패했습니다."
      );
      setStatus("");
    } finally {
      setIsImporting(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) {
      addFiles(event.target.files);
    }
    event.target.value = "";
  }

  function handleReferenceDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!isImporting && event.dataTransfer.types.includes("Files")) {
      setIsReferenceDragging(true);
    }
  }

  function handleReferenceDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!isImporting) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleReferenceDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsReferenceDragging(false);
    }
  }

  function handleReferenceDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsReferenceDragging(false);
    if (!isImporting && event.dataTransfer.files.length > 0) {
      addFiles(event.dataTransfer.files);
    }
  }

  function addFiles(fileList: FileList | File[]) {
    const { acceptedFiles, rejectedFiles } = collectHomeUploadFiles(
      fileList,
      Boolean(selectedTemplateStyleId)
    );
    setUploads((current) => mergeUploadFiles(current, acceptedFiles));
    setRejected(rejectedFiles);
    setError("");
    setStatus("");
    setJob(null);
  }

  function removeUpload(id: string) {
    setUploads((current) => current.filter((upload) => upload.id !== id));
    setError("");
    setStatus("");
    setJob(null);
  }

  function updateUploadRole(id: string, role: UploadRole) {
    setUploads((current) =>
      current.map((upload) =>
        upload.id === id
          ? { ...upload, role: selectedTemplateStyleId ? "content" : role }
          : upload
      )
    );
    setError("");
    setStatus("");
    setJob(null);
  }

  function selectTemplateStyle(styleId: HomeTemplateStyleId) {
    if (selectedTemplateStyleId === styleId) {
      clearTemplateStyle();
      return;
    }
    setSelectedTemplateStyleId(styleId);
    setUploads((current) => normalizeTemplateReferenceUploads(current));
    clearHomeGenerationFeedback();
    navigateTo(getHomeTemplateStylePath(styleId));
  }

  function clearTemplateStyle() {
    setSelectedTemplateStyleId(undefined);
    clearHomeGenerationFeedback();
    navigateTo("/");
  }

  function clearHomeGenerationFeedback() {
    setRejected([]);
    setError("");
    setStatus("");
    setJob(null);
  }

  function focusTopicField() {
    topicInputRef.current?.focus();
  }

  function openReferencePicker() {
    fileInputRef.current?.click();
  }

  function scrollToTemplateStyles() {
    document.querySelector(".template-section")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  const selectedTemplateStyle = selectedTemplateStyleId
    ? homeTemplateStyles.find((style) => style.id === selectedTemplateStyleId)
    : undefined;

  return (
    <section className="home-page">
      <header className="page-heading">
        <h1>{props.user?.displayName ?? "Orbit"} 작업 공간</h1>
      </header>

      {!selectedTemplateStyle ? (
        <section className="home-chat-panel home-generate-panel" aria-label="AI 발표 자료 생성">
          <div className="home-start-panel">
            <div className="home-start-copy">
              <span>프레젠테이션 제작</span>
              <h2>어디서부터 시작할까요?</h2>
            </div>
            <div className="home-start-options" aria-label="제작 시작 방식">
              <button type="button" onClick={focusTopicField}>
                <FileText size={17} />
                <span>주제로 시작</span>
              </button>
              <button type="button" onClick={openReferencePicker}>
                <UploadCloud size={17} />
                <span>자료로 시작</span>
              </button>
              <button type="button" onClick={scrollToTemplateStyles}>
                <LayoutTemplate size={17} />
                <span>템플릿 선택</span>
              </button>
            </div>
          </div>
          <form className="home-ai-form" onSubmit={handleSubmit}>
            <div className="home-generate-layout">
              <div className="home-brief-stack">
                <label className="home-field-block home-topic-field">
                  <span>
                    <FileText size={16} />
                    발표 주제
                  </span>
                  <input
                    ref={topicInputRef}
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                    placeholder="예: 2026 상반기 제품 전략 리뷰"
                    disabled={isImporting}
                  />
                </label>

                <label className="home-field-block">
                  <span>
                    <ListChecks size={16} />
                    핵심 내용
                  </span>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="청중, 핵심 메시지, 반드시 포함할 수치, 제외할 내용을 적어주세요."
                    disabled={isImporting}
                  />
                </label>

                <section
                  className={
                    isReferenceDragging
                      ? "home-reference-drop home-reference-drop-active"
                      : "home-reference-drop"
                  }
                  aria-label="참고자료"
                  onDragEnter={handleReferenceDragEnter}
                  onDragLeave={handleReferenceDragLeave}
                  onDragOver={handleReferenceDragOver}
                  onDrop={handleReferenceDrop}
                >
                  <div>
                    <UploadCloud size={34} />
                    <div>
                      <strong>참고자료를 추가하면 더 정확해요</strong>
                      <span>파일을 이 영역에 끌어다 놓거나 PDF, PPTX, 문서, 이미지를 첨부하세요.</span>
                    </div>
                  </div>
                  <label className="home-attach-button">
                    <Paperclip size={16} />
                    <span>파일 첨부</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={homeAssetAccept}
                      multiple
                      disabled={isImporting}
                      onChange={handleFileChange}
                    />
                  </label>
                </section>

                {uploads.length > 0 && !selectedTemplateStyle ? (
                  <HomeUploadList
                    uploads={uploads}
                    totalUploadSize={totalSize}
                    isDisabled={isImporting}
                    allowDesignReference
                    onRemoveUpload={removeUpload}
                    onUpdateUploadRole={updateUploadRole}
                  />
                ) : null}
              </div>

              <aside className="home-generate-controls" aria-label="생성 옵션">
                <div className="home-control-heading">
                  <span>생성 옵션</span>
                  <strong>발표 상황에 맞추기</strong>
                </div>

                <fieldset className="home-tone-fieldset">
                  <legend>발표 톤</legend>
                  <div className="home-tone-grid">
                    {homeToneOptions.map((option) => (
                      <label
                        className={tone === option.value ? "home-tone-card active" : "home-tone-card"}
                        key={option.value}
                      >
                        <input
                          type="radio"
                          name="homeTone"
                          value={option.value}
                          checked={tone === option.value}
                          onChange={() => setTone(option.value)}
                          disabled={isImporting}
                        />
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="home-options-grid">
                  <label>
                    <span>
                      <Clock size={15} />
                      발표 시간
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={durationInput}
                      disabled={isImporting}
                      onChange={(event) => setDurationInput(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>최소 슬라이드</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={minSlidesInput}
                      disabled={isImporting}
                      onChange={(event) => setMinSlidesInput(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>최대 슬라이드</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={maxSlidesInput}
                      disabled={isImporting}
                      onChange={(event) => setMaxSlidesInput(event.target.value)}
                    />
                  </label>
                </div>

                <div className="home-convert-row">
                  <button
                    className="home-convert-button"
                    type="button"
                    onClick={() => void handleConvertPptx()}
                    disabled={isImporting || uploads.length === 0}
                  >
                    <FileUp size={16} />
                    {isImporting ? "변환 중" : "PPTX 변환하기"}
                  </button>
                </div>

                <button className="home-generate-submit" type="submit" disabled={isImporting}>
                  <ArrowRight size={17} />
                  {isImporting ? "생성 중" : "발표자료 생성하기"}
                </button>
              </aside>
            </div>
          </form>
          <HomeGenerationFeedback
            rejected={rejected}
            job={job}
            status={status}
            error={error}
          />
        </section>
      ) : null}

      <TemplateRail
        title="템플릿 스타일"
        selectedStyleId={selectedTemplateStyleId}
        onCreateProject={() => void handleCreateBlankProject()}
        onSelectStyle={selectTemplateStyle}
        isCreating={isImporting || isCreatingBlankProject}
      />
      {selectedTemplateStyle ? (
        <TemplateStyleOptionsPanel
          templateStyle={selectedTemplateStyle}
          topic={topic}
          prompt={prompt}
          tone={tone}
          durationInput={durationInput}
          minSlidesInput={minSlidesInput}
          maxSlidesInput={maxSlidesInput}
          designPrompt={designPrompt}
          densityTarget={templateDensityTarget}
          layoutDiversity={templateLayoutDiversity}
          mediaPolicy={templateMediaPolicy}
          uploads={uploads}
          totalUploadSize={totalSize}
          rejected={rejected}
          job={job}
          status={status}
          error={error}
          isDisabled={isImporting}
          onClearStyle={clearTemplateStyle}
          onTopicChange={setTopic}
          onPromptChange={setPrompt}
          onToneChange={setTone}
          onDurationInputChange={setDurationInput}
          onMinSlidesInputChange={setMinSlidesInput}
          onMaxSlidesInputChange={setMaxSlidesInput}
          onDesignPromptChange={setDesignPrompt}
          onDensityTargetChange={setTemplateDensityTarget}
          onFileChange={handleFileChange}
          onLayoutDiversityChange={setTemplateLayoutDiversity}
          onMediaPolicyChange={setTemplateMediaPolicy}
          onRemoveUpload={removeUpload}
          onUpdateUploadRole={updateUploadRole}
          onGenerate={() => void runHomeDeckGeneration()}
        />
      ) : null}
    </section>
  );
}

function ProjectListPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => fetchProjects(),
    retry: false
  });

  async function handleCreateProject() {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const project = await createProject("새 프레젠테이션");
      await projects.refetch();
      navigateTo(`/project/${project.projectId}`);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeleteProject(project: Project) {
    if (deletingProjectId) return;
    const shouldDelete = window.confirm(
      `"${project.title}" 프레젠테이션을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`
    );
    if (!shouldDelete) return;

    setDeleteError("");
    setDeletingProjectId(project.projectId);
    try {
      await deleteProject(project.projectId);
      await projects.refetch();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "프로젝트를 삭제하지 못했습니다.");
    } finally {
      setDeletingProjectId(null);
    }
  }

  return (
    <section className="project-page">
      <header className="page-heading row">
        <div>
          <span>프로젝트</span>
          <h1>프로젝트 불러오기</h1>
        </div>
        <button type="button" className="ghost-button" onClick={() => void projects.refetch()}>
          <Search size={16} />
          새로고침
        </button>
      </header>

      <TemplateRail
        title="템플릿"
        onCreateProject={handleCreateProject}
        onSelectStyle={(styleId) => navigateTo(getHomeTemplateStylePath(styleId))}
        isCreating={isCreating}
      />

      <section className="project-history">
        <div className="section-heading">
          <h2>최근 에디팅한 프로젝트</h2>
          <span>{projects.data?.length ?? 0}개</span>
        </div>
        {projects.isLoading ? <p className="empty-state">프로젝트를 불러오는 중입니다.</p> : null}
        {projects.isError ? <p className="empty-state">프로젝트 목록을 불러오지 못했습니다.</p> : null}
        {deleteError ? <p className="empty-state project-delete-error">{deleteError}</p> : null}
        <div className="project-grid">
          {(projects.data ?? []).map((project) => (
            <ProjectCard
              key={project.projectId}
              project={project}
              isDeleting={deletingProjectId === project.projectId}
              onDelete={() => void handleDeleteProject(project)}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

export function TemplateRail(props: {
  title: string;
  isCreating?: boolean;
  onCreateProject?: () => void;
  onSelectStyle?: (styleId: HomeTemplateStyleId) => void;
  selectedStyleId?: HomeTemplateStyleId;
}) {
  return (
    <section className="template-section">
      <div className="section-heading">
        <h2>{props.title}</h2>
      </div>
      <div className="template-row">
        <button
          className="new-template-card"
          type="button"
          onClick={props.onCreateProject ?? (() => navigateTo("/project"))}
          disabled={props.isCreating}
        >
          <Plus size={28} />
          <span>빈 프레젠테이션 만들기</span>
        </button>
        {homeTemplateStyles.map((template) => (
          <button
            aria-pressed={props.selectedStyleId === template.id}
            className={
              props.selectedStyleId === template.id
                ? "template-card template-card-active"
                : "template-card"
            }
            type="button"
            key={template.id}
            onClick={() => props.onSelectStyle?.(template.id)}
          >
            <LayoutTemplate size={18} />
            <strong>{template.title}</strong>
            <span>{template.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function TemplateStyleOptionsPanel(props: {
  templateStyle: HomeTemplateStyle;
  topic: string;
  prompt: string;
  tone: "professional" | "friendly" | "confident" | "concise";
  durationInput: string;
  minSlidesInput: string;
  maxSlidesInput: string;
  designPrompt: string;
  densityTarget: TemplateDensityTargetOption;
  layoutDiversity: TemplateLayoutDiversityOption;
  mediaPolicy: TemplateMediaPolicyOption;
  uploads: UploadFile[];
  totalUploadSize: number;
  rejected: RejectedFile[];
  job: Job | null;
  status: string;
  error: string;
  isDisabled?: boolean;
  onClearStyle?: () => void;
  onTopicChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onToneChange: (value: "professional" | "friendly" | "confident" | "concise") => void;
  onDurationInputChange: (value: string) => void;
  onMinSlidesInputChange: (value: string) => void;
  onMaxSlidesInputChange: (value: string) => void;
  onDesignPromptChange: (value: string) => void;
  onDensityTargetChange: (value: TemplateDensityTargetOption) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onLayoutDiversityChange: (value: TemplateLayoutDiversityOption) => void;
  onMediaPolicyChange: (value: TemplateMediaPolicyOption) => void;
  onRemoveUpload: (id: string) => void;
  onUpdateUploadRole: (id: string, role: UploadRole) => void;
  onGenerate: () => void;
}) {
  return (
    <section className="template-style-panel" aria-label="템플릿 스타일 설정">
      <header>
        <div>
          <span>선택한 템플릿</span>
          <h3>{props.templateStyle.title}</h3>
        </div>
        <button type="button" onClick={props.onClearStyle} disabled={props.isDisabled}>
          선택 해제
        </button>
      </header>
      <div className="template-style-generation-grid">
        <label className="template-style-topic-field">
          <span>발표 주제</span>
          <input
            value={props.topic}
            onChange={(event) => props.onTopicChange(event.target.value)}
            placeholder="발표 주제"
            disabled={props.isDisabled}
          />
        </label>
        <label className="template-style-prompt-field">
          <span>내용 프롬프트</span>
          <textarea
            value={props.prompt}
            onChange={(event) => props.onPromptChange(event.target.value)}
            placeholder="핵심 메시지, 포함할 내용, 제외할 내용"
            disabled={props.isDisabled}
          />
        </label>
        <label>
          <span>발표 톤</span>
          <select
            value={props.tone}
            onChange={(event) =>
              props.onToneChange(event.target.value as typeof props.tone)
            }
            disabled={props.isDisabled}
          >
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="confident">Confident</option>
            <option value="concise">Concise</option>
          </select>
        </label>
        <label>
          <span>발표 시간</span>
          <input
            type="number"
            min={1}
            max={120}
            value={props.durationInput}
            onChange={(event) => props.onDurationInputChange(event.target.value)}
            disabled={props.isDisabled}
          />
        </label>
        <label>
          <span>최소 슬라이드</span>
          <input
            type="number"
            min={1}
            max={20}
            value={props.minSlidesInput}
            onChange={(event) => props.onMinSlidesInputChange(event.target.value)}
            disabled={props.isDisabled}
          />
        </label>
        <label>
          <span>최대 슬라이드</span>
          <input
            type="number"
            min={1}
            max={20}
            value={props.maxSlidesInput}
            onChange={(event) => props.onMaxSlidesInputChange(event.target.value)}
            disabled={props.isDisabled}
          />
        </label>
      </div>
      <div className="template-style-options-grid">
        <label className="template-style-prompt-field">
          <span>템플릿 프롬프트</span>
          <textarea
            value={props.designPrompt}
            name="templateDesignPrompt"
            onChange={(event) => props.onDesignPromptChange(event.target.value)}
            placeholder="템플릿에 추가로 반영할 색감, 레이아웃, 분위기"
            disabled={props.isDisabled}
          />
        </label>
        <label>
          <span>텍스트 밀도</span>
          <select
            value={props.densityTarget}
            name="templateDensityTarget"
            onChange={(event) =>
              props.onDensityTargetChange(event.target.value as TemplateDensityTargetOption)
            }
            disabled={props.isDisabled}
          >
            <option value={templateStyleDefaultOption}>템플릿 기본값</option>
            <option value="low">낮게</option>
            <option value="medium">보통</option>
            <option value="high">높게</option>
          </select>
        </label>
        <label>
          <span>레이아웃</span>
          <select
            value={props.layoutDiversity}
            name="templateLayoutDiversity"
            onChange={(event) =>
              props.onLayoutDiversityChange(
                event.target.value as TemplateLayoutDiversityOption
              )
            }
            disabled={props.isDisabled}
          >
            <option value={templateStyleDefaultOption}>템플릿 기본값</option>
            <option value="stable">안정적</option>
            <option value="varied">다양하게</option>
          </select>
        </label>
        <label>
          <span>미디어 사용</span>
          <select
            value={props.mediaPolicy}
            name="templateMediaPolicy"
            onChange={(event) =>
              props.onMediaPolicyChange(event.target.value as TemplateMediaPolicyOption)
            }
            disabled={props.isDisabled}
          >
            <option value={templateStyleDefaultOption}>템플릿 기본값</option>
            <option value="avoid">사용 안 함</option>
            <option value="balanced">균형 있게</option>
            <option value="placeholder-ok">플레이스홀더 허용</option>
          </select>
        </label>
      </div>
      <div className="template-style-reference-area">
        <label className="template-style-attach-button">
          <Paperclip size={16} />
          <span>참고자료 첨부</span>
          <input
            type="file"
            accept={homeAssetAccept}
            multiple
            disabled={props.isDisabled}
            onChange={props.onFileChange}
          />
        </label>
        {props.uploads.length > 0 ? (
          <HomeUploadList
            uploads={props.uploads}
            totalUploadSize={props.totalUploadSize}
            isDisabled={props.isDisabled}
            allowDesignReference={false}
            onRemoveUpload={props.onRemoveUpload}
            onUpdateUploadRole={props.onUpdateUploadRole}
          />
        ) : null}
      </div>
      <div className="template-style-actions">
        <button
          className="template-style-generate-button"
          type="button"
          onClick={props.onGenerate}
          disabled={props.isDisabled}
        >
          <Sparkles size={16} />
          {props.isDisabled ? "생성 중" : "PPT 생성하기"}
        </button>
      </div>
      <HomeGenerationFeedback
        rejected={props.rejected}
        job={props.job}
        status={props.status}
        error={props.error}
      />
    </section>
  );
}

function HomeGenerationFeedback(props: {
  rejected: RejectedFile[];
  job: Job | null;
  status: string;
  error: string;
}) {
  return (
    <>
      {props.rejected.length > 0 ? (
        <div className="rejection-list" role="alert">
          {props.rejected.map((file) => (
            <p key={file.name}>
              <strong>{file.name}</strong> {file.reason}
            </p>
          ))}
        </div>
      ) : null}
      {props.job ? (
        <div className="job-status home-job-status" aria-live="polite">
          <div>
            <strong>{props.job.status}</strong>
            <span>{props.job.progress}%</span>
          </div>
          {props.job.message ? <p>{props.job.message}</p> : null}
        </div>
      ) : null}
      {props.status ? <p className="chat-file-status">{props.status}</p> : null}
      {props.error ? <p className="chat-file-error">{props.error}</p> : null}
    </>
  );
}

function HomeUploadList(props: {
  uploads: UploadFile[];
  totalUploadSize: number;
  isDisabled?: boolean;
  allowDesignReference?: boolean;
  onRemoveUpload: (id: string) => void;
  onUpdateUploadRole: (id: string, role: UploadRole) => void;
}) {
  const [openRoleMenuId, setOpenRoleMenuId] = useState<string | null>(null);
  const [roleMenuStyle, setRoleMenuStyle] = useState<CSSProperties>({});

  function getRoleOptions(file: File): UploadRole[] {
    if (!props.allowDesignReference || !isPptxFile(file)) {
      return ["content"];
    }
    return ["content", "design", "both"];
  }

  function handleRoleTriggerClick(
    id: string,
    file: File,
    event: MouseEvent<HTMLButtonElement>
  ) {
    if (openRoleMenuId === id) {
      setOpenRoleMenuId(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, 128);
    const optionCount = getRoleOptions(file).length;
    const estimatedMenuHeight = 10 + optionCount * 30 + Math.max(0, optionCount - 1) * 3;
    const menuTop =
      rect.bottom + 6 + estimatedMenuHeight > window.innerHeight - 8
        ? Math.max(8, rect.top - estimatedMenuHeight - 6)
        : rect.bottom + 6;
    setRoleMenuStyle({
      left: rect.right - menuWidth,
      top: menuTop,
      width: menuWidth
    });
    setOpenRoleMenuId(id);
  }

  useEffect(() => {
    if (!openRoleMenuId) {
      return undefined;
    }

    function closeRoleMenu() {
      setOpenRoleMenuId(null);
    }

    function closeRoleMenuOnPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".home-upload-role")) {
        closeRoleMenu();
      }
    }

    document.addEventListener("pointerdown", closeRoleMenuOnPointerDown);
    window.addEventListener("resize", closeRoleMenu);
    window.addEventListener("scroll", closeRoleMenu, true);
    return () => {
      document.removeEventListener("pointerdown", closeRoleMenuOnPointerDown);
      window.removeEventListener("resize", closeRoleMenu);
      window.removeEventListener("scroll", closeRoleMenu, true);
    };
  }, [openRoleMenuId]);

  return (
    <div className="home-upload-list">
      <div className="upload-summary" aria-live="polite">
        <span>{props.uploads.length}개 파일</span>
        <span>{formatBytes(props.totalUploadSize)}</span>
      </div>
      <ul className="file-list" aria-label="홈 AI 덱 첨부파일">
        {props.uploads.map(({ id, file, role }) => (
          <li key={id}>
            <div>
              <span className="file-name">{file.name}</span>
              <span className="file-detail">
                {getExtension(file.name).toUpperCase()} · {formatBytes(file.size)}
              </span>
            </div>
            <div className="home-upload-role">
              <button
                className="home-upload-role-trigger"
                type="button"
                aria-expanded={openRoleMenuId === id}
                aria-haspopup="listbox"
                aria-label={`${file.name} 역할`}
                disabled={props.isDisabled}
                onClick={(event) => handleRoleTriggerClick(id, file, event)}
              >
                <span>{uploadRoleLabels[props.allowDesignReference ? role : "content"]}</span>
                <ChevronDown size={14} />
              </button>
              {openRoleMenuId === id ? (
                <div className="home-upload-role-menu" role="listbox" style={roleMenuStyle}>
                  {getRoleOptions(file).map((option) => (
                    <button
                      className={
                        (props.allowDesignReference ? role : "content") === option
                          ? "home-upload-role-option active"
                          : "home-upload-role-option"
                      }
                      type="button"
                      role="option"
                      aria-selected={(props.allowDesignReference ? role : "content") === option}
                      key={option}
                      onClick={() => {
                        props.onUpdateUploadRole(id, option);
                        setOpenRoleMenuId(null);
                      }}
                    >
                      {uploadRoleLabels[option]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              className="home-upload-remove-button"
              type="button"
              onClick={() => {
                props.onRemoveUpload(id);
                setOpenRoleMenuId(null);
              }}
              aria-label={`${file.name} 제거`}
              disabled={props.isDisabled}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProjectCard(props: { project: Project; isDeleting: boolean; onDelete: () => void }) {
  const createdAt = new Date(props.project.createdAt);
  return (
    <article className="project-card">
      <button
        aria-label={`${props.project.title} 열기`}
        className="project-card-open"
        type="button"
        onClick={() => navigateTo(`/project/${props.project.projectId}`)}
      >
        <div className="project-thumb">
          <span />
        </div>
        <strong>{props.project.title}</strong>
        <span>
          {Number.isNaN(createdAt.getTime())
            ? props.project.projectId
            : createdAt.toLocaleDateString("ko-KR")}
        </span>
      </button>
      <button
        aria-label={`${props.project.title} 삭제`}
        className="project-card-delete"
        disabled={props.isDeleting}
        title="프레젠테이션 삭제"
        type="button"
        onClick={props.onDelete}
      >
        <Trash2 size={15} />
        <span>{props.isDeleting ? "삭제 중" : "삭제"}</span>
      </button>
    </article>
  );
}

function GenerateDeckView() {
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState("");
  const [prompt, setPrompt] = useState("");
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateJob, setGenerateJob] = useState<Job | null>(null);
  const [result, setResult] = useState<PptxOoxmlGenerationJobResult | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [newProjectTitle, setNewProjectTitle] = useState("PPTX 기반 발표자료");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState("");
  const projectsQuery = useQuery({
    queryKey: ["projects", "generate-deck"],
    queryFn: () => fetchProjects(),
    retry: false
  });
  const totalSize = useMemo(
    () => uploads.reduce((sum, upload) => sum + upload.file.size, 0),
    [uploads]
  );
  const selectedPptx = uploads[0]?.file ?? null;

  const handleCreateProject = async () => {
    const trimmedTitle = newProjectTitle.trim();
    if (!trimmedTitle || isCreatingProject) {
      return;
    }

    setIsCreatingProject(true);
    setProjectError("");

    try {
      const project = await createProject(trimmedTitle);
      setSelectedProjectId(project.projectId);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await projectsQuery.refetch();
    } catch (error) {
      setProjectError(
        error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다."
      );
    } finally {
      setIsCreatingProject(false);
    }
  };

  const addFiles = (fileList: FileList | File[]) => {
    const { acceptedFiles, rejectedFiles } = collectPptxUploadFiles(fileList);

    setUploads(acceptedFiles.slice(0, 1));
    setRejected(rejectedFiles);
    setGenerateError("");
    setGenerateJob(null);
    setResult(null);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      addFiles(event.target.files);
    }

    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const removeUpload = (id: string) => {
    setUploads((current) => current.filter((upload) => upload.id !== id));
    setGenerateError("");
    setGenerateJob(null);
    setResult(null);
  };

  const generateDeck = async () => {
    if (!selectedPptx || isGenerating) return;

    setIsGenerating(true);
    setGenerateError("");
    setProjectError("");
    setGenerateJob(null);
    setResult(null);

    try {
      const targetProject = await resolveGenerateDeckTargetProject({
        projects: projectsQuery.data ?? [],
        selectedProjectId,
        topic: topic || selectedPptx.name
      });
      const uploaded = await uploadProjectAsset(
        targetProject.projectId,
        selectedPptx,
        "pptx-import"
      );
      const payload = buildPptxOoxmlGenerationPayload({
        fileId: uploaded.fileId,
        topic,
        prompt
      });
      const response = await fetch(
        `/api/v1/projects/${targetProject.projectId}/pptx-ooxml-generations`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "PPTX 덱 생성에 실패했습니다.");
      }

      const data = (await response.json()) as PptxOoxmlGenerationResponse;
      setGenerateJob(data.job);

      const job = await pollExtractJob(data.job.jobId, {
        onUpdate: setGenerateJob
      });

      if (job.status === "failed") {
        throw new Error(job.error?.message || job.message || "PPTX 덱 생성에 실패했습니다.");
      }

      const generatedResult = getPptxOoxmlGenerationJobResult(job);
      if (!generatedResult) {
        throw new Error("PPTX 덱 생성 결과를 읽지 못했습니다.");
      }

      setResult(generatedResult);
      if (targetProject.created && targetProject.project) {
        queryClient.setQueryData<Project[]>(["projects"], (current) =>
          mergeGeneratedProjectList(current, targetProject.project as Project)
        );
      }
      await queryClient.invalidateQueries({
        queryKey: ["deck", targetProject.projectId]
      });
      navigateTo(getPptxOoxmlGeneratedProjectPath(targetProject.projectId));
    } catch (error) {
      setGenerateError(
        error instanceof Error ? error.message : "PPTX 덱 생성에 실패했습니다."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="app-shell generate-app-shell">
      <section className="generate-layout" aria-labelledby="generate-title">
        <form
          className="generate-form"
          onSubmit={(event) => {
            event.preventDefault();
            void generateDeck();
          }}
        >
          <div className="panel-copy">
            <span className="eyebrow">PPTX OOXML</span>
            <h1 id="generate-title">PPTX로 덱 생성</h1>
          </div>

          <section className="generate-reference-panel" aria-labelledby="generate-project-title">
            <div className="reference-panel-heading">
              <span className="eyebrow" id="generate-project-title">
                Target project
              </span>
              <p>생성된 덱을 저장하고 바로 에디터에서 열 프로젝트</p>
            </div>

            <label>
              <span>Project</span>
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                disabled={isGenerating || projectsQuery.isLoading}
              >
                <option value="">프로젝트 선택</option>
                {(projectsQuery.data ?? []).map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-grid">
              <label>
                <span>New project</span>
                <input
                  value={newProjectTitle}
                  onChange={(event) => setNewProjectTitle(event.target.value)}
                  disabled={isGenerating || isCreatingProject}
                  placeholder="PPTX 기반 발표자료"
                />
              </label>
            </div>

            <button
              className="extract-button"
              type="button"
              onClick={() => void handleCreateProject()}
              disabled={isGenerating || isCreatingProject || !newProjectTitle.trim()}
            >
              {isCreatingProject ? "프로젝트 생성 중..." : "새 프로젝트 만들고 선택"}
            </button>

            {projectsQuery.isError ? (
              <div className="rejection-list" role="alert">
                <p>프로젝트 목록을 불러오지 못했습니다.</p>
              </div>
            ) : null}

            {projectError ? (
              <div className="rejection-list" role="alert">
                <p>{projectError}</p>
              </div>
            ) : null}
          </section>

          <label>
            <span>Topic</span>
            <input value={topic} onChange={(event) => setTopic(event.target.value)} />
          </label>

          <label>
            <span>Prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="원본 템플릿의 교체 가능한 텍스트 슬롯에 반영할 지시사항"
            />
          </label>

          <section
            className="generate-reference-panel"
            aria-labelledby="generate-reference-title"
          >
            <div className="reference-panel-heading">
              <span className="eyebrow" id="generate-reference-title">
                PPTX source
              </span>
              <p>원본 OOXML package를 보존할 PPTX 파일</p>
            </div>

            <label
              className={`drop-zone${isDragging ? " is-dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input type="file" accept={pptxAccept} onChange={handleFileChange} />
              <span className="upload-mark" aria-hidden="true">
                +
              </span>
              <span className="drop-title">PPTX 파일을 끌어오거나 선택하세요</span>
              <span className="drop-meta">PPTX 1개</span>
            </label>

            <div className="upload-summary" aria-live="polite">
              <span>{uploads.length}개 파일</span>
              <span>{formatBytes(totalSize)}</span>
            </div>

            {rejected.length > 0 && (
              <div className="rejection-list" role="alert">
                {rejected.map((file) => (
                  <p key={file.name}>
                    <strong>{file.name}</strong> {file.reason}
                  </p>
                ))}
              </div>
            )}

            {uploads.length > 0 && (
              <ul className="file-list" aria-label="덱 생성 PPTX 파일">
                {uploads.map(({ id, file }) => (
                  <li key={id}>
                    <div>
                      <span className="file-name">{file.name}</span>
                      <span className="file-detail">
                        {getExtension(file.name).toUpperCase()} · {formatBytes(file.size)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeUpload(id)}
                      aria-label={`${file.name} 제거`}
                      disabled={isGenerating}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button
            className="extract-button"
            type="submit"
            disabled={isGenerating || !selectedPptx}
          >
            {isGenerating ? "덱 생성 중..." : "덱 생성"}
          </button>

          {generateJob && (
            <div className="job-status" aria-live="polite">
              <div>
                <strong>pptx {generateJob.status}</strong>
                <span>{generateJob.progress}%</span>
              </div>
              {generateJob.message && <p>{generateJob.message}</p>}
            </div>
          )}

          {generateError && (
            <div className="rejection-list" role="alert">
              <p>{generateError}</p>
            </div>
          )}
        </form>

        <section className="generate-result" aria-live="polite">
          {result ? <PptxOoxmlGenerationResult result={result} /> : <DeckPreviewPlaceholder />}
        </section>
      </section>
    </main>
  );
}


function DeckPreviewPlaceholder() {
  return (
    <div className="deck-preview-placeholder">
      <Sparkles size={28} />
      <span>PPTX deck</span>
    </div>
  );
}

function getExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function isPptxFile(file: File) {
  return (
    getExtension(file.name) === "pptx" &&
    resolveAssetMimeType(file) === pptxMimeType
  );
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function createUploadId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function getHomeUploadPurpose(
  upload: UploadFile,
  allowDesignReferences = true
): FilePurpose {
  if (
    allowDesignReferences &&
    (upload.role === "design" || upload.role === "both") &&
    isPptxFile(upload.file)
  ) {
    return "pptx-import";
  }

  return "reference-material";
}

async function extractHomeReferenceInput(
  projectId: string,
  uploads: UploadFile[],
  uploadedAssetFileIds: Map<string, string>,
  callbacks: {
    setJob: (job: Job | null) => void;
    setStatus: (status: string) => void;
  },
  includeDesignReferencesAsContent = false
) {
  const contentUploads = getHomeContentReferenceUploads(
    uploads,
    includeDesignReferencesAsContent
  );
  if (contentUploads.length === 0) {
    return buildReferenceGenerationInput([]);
  }

  callbacks.setStatus("참고자료 추출 중...");
  const response = await fetch(homeReferenceExtractEndpoint, {
    method: "POST",
    body: buildHomeExtractFormData(projectId, contentUploads, uploadedAssetFileIds)
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "참고자료 추출을 시작하지 못했습니다."));
  }

  const data = (await response.json()) as ExtractJobResponse;
  callbacks.setJob(data.job);
  const completed = await pollExtractJob(data.job.jobId, {
    fetcher: fetch,
    onUpdate: callbacks.setJob,
    timeoutMs: 300_000
  });
  callbacks.setJob(completed);

  if (completed.status === "failed") {
    throw new Error(
      completed.error?.message || completed.message || "참고자료 추출에 실패했습니다."
    );
  }

  return buildReferenceGenerationInput(getJobResultFiles(completed));
}

export function hasHomeDesignPptxUpload(uploads: UploadFile[]) {
  return uploads.some((upload) => isHomeDesignPptxUpload(upload));
}

function isHomeDesignPptxUpload(upload: UploadFile) {
  return (upload.role === "design" || upload.role === "both") && isPptxFile(upload.file);
}

export function getHomeContentReferenceUploads(
  uploads: UploadFile[],
  includeDesignReferencesAsContent = false
) {
  return uploads.filter(
    (upload) => includeDesignReferencesAsContent || upload.role === "content"
  );
}

export const homeReferenceExtractEndpoint = "/api/extract";

export function buildHomeExtractFormData(
  projectId: string,
  contentUploads: UploadFile[],
  uploadedAssetFileIds: Map<string, string>
) {
  const formData = new FormData();
  formData.append("projectId", projectId);
  for (const upload of contentUploads) {
    const fileId = uploadedAssetFileIds.get(upload.id);
    if (!fileId) {
      throw new Error(`${upload.file.name} 업로드 결과를 찾지 못했습니다.`);
    }
    formData.append("files", upload.file);
    formData.append("fileIds", fileId);
  }
  return formData;
}

export function getHomeDeckGenerationJobEndpoint(
  projectId: string,
  uploads: UploadFile[],
  allowDesignReferences = true
) {
  const jobType = allowDesignReferences && hasHomeDesignPptxUpload(uploads)
    ? "ai-template-deck-generation"
    : "generate-deck";
  return `/api/v1/projects/${encodeURIComponent(projectId)}/jobs/${jobType}`;
}

export function getHomeGenerationValidationMessage(
  topic: string,
  uploads: UploadFile[],
  durationInput = "10",
  minSlidesInput = "5",
  maxSlidesInput = "8",
  allowDesignReferences = true
) {
  if (!topic.trim()) {
    return "발표 주제를 입력하세요.";
  }

  if (allowDesignReferences) {
    const designUploads = uploads.filter(
      (upload) => upload.role === "design" || upload.role === "both"
    );
    if (designUploads.length > 1) {
      return "디자인 참고 PPTX는 1개만 선택하세요.";
    }

    if (designUploads.length === 1 && !isPptxFile(designUploads[0].file)) {
      return "디자인 참고 파일은 PPTX여야 합니다.";
    }
  }

  const duration = parseHomeIntegerInput(durationInput);
  if (duration === null || duration < 1 || duration > 120) {
    return "발표 시간은 1~120분으로 입력하세요.";
  }

  const minSlides = parseHomeIntegerInput(minSlidesInput);
  const maxSlides = parseHomeIntegerInput(maxSlidesInput);
  if (
    minSlides === null ||
    maxSlides === null ||
    minSlides < 1 ||
    minSlides > 20 ||
    maxSlides < 1 ||
    maxSlides > 20
  ) {
    return "슬라이드 수는 1~20장으로 입력하세요.";
  }

  if (minSlides > maxSlides) {
    return "최소 슬라이드 수는 최대 슬라이드 수보다 클 수 없습니다.";
  }

  return "";
}

function collectHomeUploadFiles(
  fileList: FileList | File[],
  hasSelectedTemplateStyle = false
) {
  const acceptedFiles: UploadFile[] = [];
  const rejectedFiles: RejectedFile[] = [];

  Array.from(fileList).forEach((file) => {
    const mimeType = resolveAssetMimeType(file);
    if (!mimeType) {
      rejectedFiles.push({
        name: file.name,
        reason: "PDF, PPTX, DOCX, JPG, PNG, WebP 파일만 첨부할 수 있습니다."
      });
      return;
    }

    if (file.size > maxAssetUploadSizeBytes) {
      rejectedFiles.push({
        name: file.name,
        reason: `${formatBytes(maxAssetUploadSizeBytes)} 이하 파일만 첨부할 수 있습니다.`
      });
      return;
    }

    if (file.size <= 0) {
      rejectedFiles.push({
        name: file.name,
        reason: "빈 파일은 첨부할 수 없습니다."
      });
      return;
    }

    acceptedFiles.push({
      id: createUploadId(file),
      file,
      role: getHomeDefaultUploadRole(file, hasSelectedTemplateStyle)
    });
  });

  return { acceptedFiles, rejectedFiles };
}

export function getHomeDefaultUploadRole(file: File, hasSelectedTemplateStyle = false) {
  if (!isPptxFile(file)) {
    return "content";
  }

  return hasSelectedTemplateStyle ? "content" : "design";
}

function normalizeTemplateReferenceUploads(uploads: UploadFile[]) {
  return uploads.map((upload) => ({ ...upload, role: "content" as const }));
}

function mergeUploadFiles(current: UploadFile[], next: UploadFile[]) {
  const byId = new Map(current.map((upload) => [upload.id, upload]));
  for (const upload of next) {
    byId.set(upload.id, upload);
  }

  let hasDesign = false;
  return Array.from(byId.values()).map((upload) => {
    if (!isPptxFile(upload.file)) {
      return { ...upload, role: "content" as const };
    }
    if ((upload.role === "design" || upload.role === "both") && hasDesign) {
      return { ...upload, role: "content" as const };
    }
    if (upload.role === "design" || upload.role === "both") {
      hasDesign = true;
    }
    return upload;
  });
}

function collectPptxUploadFiles(fileList: FileList | File[]) {
  const acceptedFiles: UploadFile[] = [];
  const rejectedFiles: RejectedFile[] = [];

  Array.from(fileList).forEach((file) => {
    if (isPptxFile(file)) {
      acceptedFiles.push({ id: createUploadId(file), file, role: "design" });
      return;
    }

    rejectedFiles.push({
      name: file.name,
      reason: "PPTX 파일 1개만 업로드할 수 있습니다."
    });
  });

  return { acceptedFiles, rejectedFiles };
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function parseHomeIntegerInput(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function EditorLoadingFallback() {
  return (
    <section className="loading-page">
      <h1>에디터를 불러오는 중</h1>
    </section>
  );
}
export async function pollExtractJob(
  jobId: string,
  options: {
    delayMs?: number;
    fetcher?: Fetcher;
    onUpdate?: (job: Job) => void;
    timeoutMs?: number;
  } = {}
): Promise<Job> {
  const delayMs = options.delayMs ?? 1000;
  const fetcher = options.fetcher ?? fetch;
  const timeoutAt = Date.now() + (options.timeoutMs ?? 120_000);

  for (;;) {
    const response = await fetcher(`/api/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error((await response.text()) || "Job status lookup failed.");
    }

    const job = (await response.json()) as Job;
    options.onUpdate?.(job);
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }

    if (Date.now() > timeoutAt) {
      throw new Error("Reference extraction timed out.");
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export function getJobResultFiles(job: Job): ExtractedFile[] {
  const result = job.result as JobResult | null;
  return Array.isArray(result?.files) ? result.files : [];
}

export function getGenerateDeckJobResult(job: Job): GenerateDeckJobResult | null {
  const result = job.result as GenerateDeckJobResult | null;
  return result?.deck ? result : null;
}

export function getGeneratedDeckProjectPath(result: GenerateDeckJobResult) {
  return `/project/${encodeURIComponent(result.deck.projectId)}`;
}

export function getPptxOoxmlGeneratedProjectPath(projectId: string) {
  return `/project/${encodeURIComponent(projectId)}`;
}

export function getPptxOoxmlGenerationJobResult(
  job: Job
): PptxOoxmlGenerationJobResult | null {
  const result = job.result as PptxOoxmlGenerationJobResult | null;
  return result?.deckId && result?.currentPackageFileId ? result : null;
}

export function getAiTemplateDeckGenerationJobResult(
  job: Job
): AiTemplateDeckGenerationJobResult | null {
  const parsed = aiTemplateDeckGenerationJobResultSchema.safeParse(job.result);
  return parsed.success ? parsed.data : null;
}

export function buildAiTemplateDeckGenerationPayload(input: {
  designPrompt: string;
  duration: number;
  maxSlides: number;
  minSlides: number;
  prompt: string;
  tone: "professional" | "friendly" | "confident" | "concise";
  topic: string;
  uploadedAssetFileIds: Map<string, string>;
  uploads: UploadFile[];
}) {
  return {
    topic: input.topic.trim(),
    prompt: input.prompt.trim(),
    designPrompt: input.designPrompt.trim(),
    targetDurationMinutes: clampInteger(input.duration, 1, 120),
    slideCountRange: {
      min: clampInteger(input.minSlides, 1, 20),
      max: clampInteger(input.maxSlides, 1, 20)
    },
    template: "default",
    metadata: {
      audience: "general",
      purpose: "inform",
      tone: input.tone
    },
    design: buildGenerateDeckDesignDirection({
      profile: "auto",
      visualRhythm: "auto",
      densityTarget: "medium",
      mediaPolicy: "balanced",
      layoutDiversity: "stable"
    }),
    assets: input.uploads.map((upload) => {
      const fileId = input.uploadedAssetFileIds.get(upload.id);
      if (!fileId) {
        throw new Error(`${upload.file.name} 업로드 결과를 찾지 못했습니다.`);
      }
      return { fileId, role: upload.role };
    })
  };
}

export function buildPptxOoxmlGenerationPayload(input: {
  fileId: string;
  topic?: string;
  prompt?: string;
}) {
  return {
    fileId: input.fileId,
    ...(input.topic?.trim() ? { topic: input.topic.trim() } : {}),
    ...(input.prompt?.trim() ? { prompt: input.prompt.trim() } : {})
  };
}

export async function pollJob(
  jobId: string,
  fetcher: Fetcher = fetch,
  options: { delayMs?: number; timeoutMs?: number } = {}
): Promise<Job> {
  const delayMs = options.delayMs ?? 1200;
  const timeoutAt = Date.now() + (options.timeoutMs ?? 120_000);

  for (;;) {
    const response = await fetcher(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (!response.ok) {
      throw new Error(await readApiError(response, "작업 상태를 확인하지 못했습니다."));
    }

    const job = (await response.json()) as Job;
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }

    if (Date.now() > timeoutAt) {
      throw new Error("작업 시간이 초과되었습니다.");
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export function getGeneratedDeckProjectTitle(topic: string) {
  return topic.trim() || "AI 덱";
}

export function getPptxConversionProjectTitle(fileName: string) {
  return fileName.trim().replace(/\.pptx$/i, "").trim() || "PPTX 변환";
}

export function getHomePptxConversionValidationMessage(uploads: UploadFile[]) {
  if (uploads.length === 0) {
    return "변환할 PPTX 파일을 첨부하세요.";
  }

  const pptxUploads = uploads.filter((upload) => isPptxFile(upload.file));
  if (uploads.length !== 1 || pptxUploads.length !== 1) {
    return "PPTX 변환은 PPTX 파일 1개만 첨부할 수 있습니다.";
  }

  return "";
}

export function createGeneratedDeckProject(topic: string, fetcher: Fetcher = fetch) {
  return createProject(getGeneratedDeckProjectTitle(topic), fetcher);
}

export async function resolveGenerateDeckTargetProject(args: {
  fetcher?: Fetcher;
  projects: Project[];
  selectedProjectId: string;
  topic: string;
}): Promise<GenerateDeckTargetProject> {
  const selectedProjectId = args.selectedProjectId.trim();
  if (selectedProjectId) {
    return {
      created: false,
      project:
        args.projects.find((project) => project.projectId === selectedProjectId) ??
        null,
      projectId: selectedProjectId
    };
  }

  const project = await createGeneratedDeckProject(args.topic, args.fetcher);
  return { created: true, project, projectId: project.projectId };
}

export function buildGenerateDeckPayload(input: GenerateDeckPayloadInput) {
  return {
    topic: input.topic,
    prompt: input.prompt,
    designPrompt: input.designPrompt ?? "",
    targetDurationMinutes: input.duration,
    slideCountRange: { min: input.minSlides, max: input.maxSlides },
    template: input.template,
    metadata: input.metadata,
    design: input.design,
    references: input.referenceInput.references,
    designReferences: input.designReferences,
    referenceKeywords: input.referenceInput.referenceKeywords,
    referenceContext: input.referenceInput.referenceContext
  };
}

export function buildHomeJsonFirstGenerateDeckPayload(input: {
  designPrompt: string;
  duration: number;
  maxSlides: number;
  minSlides: number;
  prompt: string;
  referenceInput?: ReferenceGenerationInput;
  templateStyleId?: HomeTemplateStyleId;
  templateStyleDesignOverrides?: TemplateStyleDesignOverrides;
  tone: "professional" | "friendly" | "confident" | "concise";
  topic: string;
}) {
  const design = input.templateStyleId
    ? {
        ...buildHomeTemplateStyleGenerateDeckDesignDirection(input.templateStyleId),
        ...(input.templateStyleDesignOverrides ?? {})
      }
    : buildDefaultHomeGenerateDeckDesignDirection();

  return buildGenerateDeckPayload({
    topic: input.topic.trim(),
    prompt: input.prompt.trim(),
    designPrompt: input.designPrompt.trim(),
    duration: clampInteger(input.duration, 1, 120),
    minSlides: clampInteger(input.minSlides, 1, 20),
    maxSlides: clampInteger(input.maxSlides, 1, 20),
    template: "default",
    metadata: {
      audience: "general",
      purpose: "inform",
      tone: input.tone
    },
    design,
    designReferences: [],
    referenceInput: input.referenceInput ?? buildReferenceGenerationInput([])
  });
}

export function buildDesignReferences(
  uploads: UploadFile[],
  uploadedAssetFileIds: Map<string, string>
) {
  return uploads
    .filter((upload) => upload.role === "design" || upload.role === "both")
    .map((upload) => uploadedAssetFileIds.get(upload.id))
    .filter((fileId): fileId is string => Boolean(fileId))
    .map((fileId) => ({ fileId }));
}

export function buildGenerateDeckDesignDirection(input: {
  densityTarget: GenerateDeckDesignDirection["densityTarget"];
  layoutDiversity: GenerateDeckDesignDirection["layoutDiversity"];
  mediaPolicy: GenerateDeckDesignDirection["mediaPolicy"];
  profile: GenerateDeckDesignProfileChoice;
  slidePresetId?: string;
  stylePackId?: string;
  visualRhythm: GenerateDeckDesignDirection["visualRhythm"];
}): GenerateDeckDesignDirection {
  const design: GenerateDeckDesignDirection = {
    visualRhythm: input.visualRhythm,
    densityTarget: input.densityTarget,
    mediaPolicy: input.mediaPolicy,
    layoutDiversity: input.layoutDiversity
  };

  if (input.profile !== "auto") {
    design.profile = input.profile;
  }

  if (input.stylePackId?.trim()) {
    design.stylePackId = input.stylePackId.trim();
  }

  if (input.slidePresetId?.trim()) {
    design.slidePresetId = input.slidePresetId.trim();
  }

  return design;
}

export function buildSimpleBasicGenerateDeckDesignDirection() {
  return buildHomeTemplateStyleGenerateDeckDesignDirection("simple-basic");
}

export function buildDefaultHomeGenerateDeckDesignDirection() {
  return buildGenerateDeckDesignDirection({
    profile: "auto",
    visualRhythm: "auto",
    densityTarget: "medium",
    mediaPolicy: "balanced",
    layoutDiversity: "varied"
  });
}

export function buildHomeTemplateStyleGenerateDeckDesignDirection(
  styleId: HomeTemplateStyleId
) {
  if (styleId === "presentation-document") {
    return buildGenerateDeckDesignDirection({
      profile: "auto",
      visualRhythm: "clean",
      densityTarget: "low",
      mediaPolicy: "balanced",
      layoutDiversity: "stable",
      stylePackId: styleId
    });
  }

  if (styleId === "submission-document") {
    return buildGenerateDeckDesignDirection({
      profile: "auto",
      visualRhythm: "technical",
      densityTarget: "high",
      mediaPolicy: "balanced",
      layoutDiversity: "stable",
      stylePackId: styleId
    });
  }

  return buildGenerateDeckDesignDirection({
    profile: "auto",
    visualRhythm: "clean",
    densityTarget: "medium",
    mediaPolicy: "balanced",
    layoutDiversity: "stable",
    stylePackId: simpleBasicStylePackId
  });
}

export function buildTemplateStyleDesignOverrides(input: {
  densityTarget: TemplateDensityTargetOption;
  layoutDiversity: TemplateLayoutDiversityOption;
  mediaPolicy: TemplateMediaPolicyOption;
}): TemplateStyleDesignOverrides {
  const overrides: TemplateStyleDesignOverrides = {};

  if (input.densityTarget !== templateStyleDefaultOption) {
    overrides.densityTarget = input.densityTarget;
  }

  if (input.layoutDiversity !== templateStyleDefaultOption) {
    overrides.layoutDiversity = input.layoutDiversity;
  }

  if (input.mediaPolicy !== templateStyleDefaultOption) {
    overrides.mediaPolicy = input.mediaPolicy;
  }

  return overrides;
}

export function mergeGeneratedProjectList(
  current: Project[] | undefined,
  project: Project
) {
  return current?.some((item) => item.projectId === project.projectId)
    ? current
    : [project, ...(current ?? [])];
}

export function buildReferenceGenerationInput(
  files: ExtractedFile[]
): ReferenceGenerationInput {
  const references: Array<{ fileId: string }> = [];
  const referenceKeywords: Array<{ text: string }> = [];
  const referenceContext: Array<{ fileId: string; title: string; content: string }> = [];
  const succeededFiles: ExtractedFile[] = [];
  const failedFiles: ExtractedFile[] = [];
  const seenFileIds = new Set<string>();
  const seenKeywords = new Set<string>();
  const seenContextIds = new Set<string>();

  for (const file of files) {
    const fileId = file.referenceDocumentId?.trim() ?? "";
    if (file.status.toLowerCase() !== "succeeded" || !fileId) {
      failedFiles.push(file);
      continue;
    }

    succeededFiles.push(file);
    if (!seenFileIds.has(fileId)) {
      seenFileIds.add(fileId);
      references.push({ fileId });
    }

    const content = (file.cleanedText?.trim() || file.rawText.trim()).slice(
      0,
      referenceContextMaxChars
    );
    if (content && !seenContextIds.has(fileId)) {
      seenContextIds.add(fileId);
      referenceContext.push({ fileId, title: file.fileName, content });
    }

    for (const keyword of file.keywords ?? []) {
      const text = keyword.keyword.trim();
      const key = text.toLowerCase();
      if (!text || seenKeywords.has(key)) continue;

      seenKeywords.add(key);
      referenceKeywords.push({ text });
    }
  }

  return {
    references,
    referenceKeywords,
    referenceContext,
    succeededFiles,
    failedFiles
  };
}

function PptxOoxmlGenerationResult(props: {
  result: PptxOoxmlGenerationJobResult;
}) {
  const { result } = props;

  return (
    <div className="generated-deck">
      <header className="result-heading">
        <div>
          <span>PPTX OOXML deck</span>
          <h2>{result.deckId}</h2>
        </div>
        <strong>{result.qualityReport.compositeScore}</strong>
      </header>
      {result.warnings.length > 0 ? <p>{result.warnings.join(" · ")}</p> : null}
      <p>template {result.templateId}</p>
      <p>package {result.currentPackageFileId}</p>
    </div>
  );
}

export function GeneratedDeckResult(props: { result: GenerateDeckJobResult }) {
  const { deck, validation, warnings } = props.result;

  return (
    <div className="generated-deck">
      <header className="result-heading">
        <div>
          <span>Generated deck</span>
          <h2>{deck.title}</h2>
        </div>
        <strong>{deck.slides.length} slides</strong>
      </header>
      {warnings.length > 0 ? <p>{warnings.join(" · ")}</p> : null}
      {validation.designIssues.length > 0 ? (
        <ul>
          {validation.designIssues.map((issue, index) => (
            <li key={`${issue.path}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
      <p>validation {validation.passed ? "passed" : "failed"}</p>
      <div className="generated-slide-grid">
        {deck.slides.map((slide) => (
          <article key={slide.slideId} className="generated-slide-card">
            <GeneratedSlidePreview
              canvas={deck.canvas}
              elements={slide.elements}
              title={slide.title}
            />
            <strong>{slide.title}</strong>
            {slide.aiNotes?.sourceEvidence.length ? (
              <ul>
                {slide.aiNotes.sourceEvidence.map((evidence) => (
                  <li key={`${slide.slideId}-${evidence.fileId}`}>
                    {evidence.fileId}
                    {evidence.note ? ` 쨌 ${evidence.note}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function GeneratedSlidePreview(props: {
  canvas: { width: number; height: number };
  elements: DeckElement[];
  title: string;
}) {
  return (
    <div
      className="generated-slide-preview"
      aria-label={props.title}
      style={{ aspectRatio: `${props.canvas.width} / ${props.canvas.height}` }}
    >
      {props.elements
        .filter((element) => element.visible)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((element) => (
          <GeneratedSlideElement
            key={element.elementId}
            canvas={props.canvas}
            element={element}
          />
        ))}
    </div>
  );
}

function GeneratedSlideElement(props: {
  canvas: { width: number; height: number };
  element: DeckElement;
}) {
  const { canvas, element } = props;
  const baseStyle: CSSProperties = {
    left: `${(element.x / canvas.width) * 100}%`,
    top: `${(element.y / canvas.height) * 100}%`,
    width: `${(element.width / canvas.width) * 100}%`,
    height: `${(element.height / canvas.height) * 100}%`,
    opacity: element.opacity,
    transform: `rotate(${element.rotation}deg)`,
    zIndex: element.zIndex
  };

  if (element.type === "text") {
    return (
      <div
        className="generated-slide-element generated-slide-text"
        style={{
          ...baseStyle,
          color: element.props.color,
          fontSize: `max(8px, ${(element.props.fontSize / canvas.width) * 100}cqw)`,
          fontWeight: element.props.fontWeight,
          lineHeight: element.props.lineHeight,
          textAlign: element.props.align
        }}
      >
        {element.props.text}
      </div>
    );
  }

  return <div className="generated-slide-element generated-slide-shape" style={baseStyle} />;
}

export function ExtractResultItem(props: { result: ExtractedFile }) {
  const { result } = props;

  return (
    <article className="result-item">
      <header>
        <h3>{result.fileName}</h3>
        <p>
          {result.kind.toUpperCase()} 쨌 {result.status}
        </p>
      </header>
      {result.indexingStatus ? (
        <p>
          {result.indexingStatus}
          {typeof result.chunkCount === "number" ? ` 쨌 ${result.chunkCount} chunks` : ""}
          {result.indexingMessage ? ` 쨌 ${result.indexingMessage}` : ""}
        </p>
      ) : null}
      <pre>{result.cleanedText || result.cleanupMessage || result.rawText}</pre>
      {result.keywords?.length ? (
        <ul>
          {result.keywords.map((keyword) => (
            <li key={`${result.fileName}-${keyword.keyword}`}>
              <strong>{keyword.keyword}</strong> {keyword.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
