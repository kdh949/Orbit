import type { OrbitMockupScreen } from "../../features/mockups/OrbitMockupFlow";
import {
  parseRouteNonNegativeInteger,
  resolveStaticRoute,
} from "../staticRoutes";

export type Route =
  | { name: "design-system" }
  | { name: "mockup"; screen: OrbitMockupScreen }
  | { name: "login" }
  | { name: "signup" }
  | { name: "profile" }
  | { name: "home" }
  | { name: "create-deck" }
  | { name: "project-list" }
  | { name: "rehearsal-project-list" }
  | { name: "project-editor"; projectId: string }
  | { name: "project-brief"; projectId: string }
  | { name: "project-history"; projectId: string }
  | { name: "activity-preview"; projectId: string; activityId: string }
  | { name: "activity-results"; projectId: string; sessionId: string }
  | { name: "story-style-color"; projectId: string; jobId: string }
  | { name: "ai-deck-generation"; projectId: string; jobId: string }
  | { name: "project-request"; projectId: string }
  | { name: "audience-session"; sessionId: string }
  | { name: "audience-activity"; sessionId: string; activityId: string }
  | { name: "companion-spike"; spikeId: string }
  | { name: "companion-spike-audience"; spikeId: string }
  | { name: "companion-spike-capture"; spikeId: string }
  | { name: "companion-pair"; code: string }
  | { name: "companion"; sessionId: string }
  | {
      name: "presentation";
      presenterInitialSlideIndex?: number;
      presenterInitialStepIndex?: number;
      presenterSessionId?: string;
      presenterWindow?: boolean;
      projectId: string;
    }
  | {
      name: "presentation-report";
      projectId: string;
      sessionId: string;
      runId?: string;
    }
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
      preflightMode?: "microphone" | "without-voice";
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
  | { name: "community" }
  | { name: "community-detail"; templateId: string }
  | { name: "report-project-overview"; projectId: string }
  | { name: "not-found" }
  | { name: "deck-render" };

export function isDeckRenderRouteEnabled() {
  return import.meta.env.DEV || import.meta.env.MODE === "test";
}

export function getRoute(pathname?: string, search?: string): Route {
  const currentPathname =
    pathname ??
    (typeof window === "undefined" ? "/" : window.location.pathname);
  const currentSearch =
    search ?? (typeof window === "undefined" ? "" : window.location.search);
  const normalized = currentPathname.replace(/\/+$/, "") || "/";

  try {
    const staticRoute = resolveStaticRoute(normalized, currentSearch, {
      deckRenderEnabled: isDeckRenderRouteEnabled(),
    });
    if (staticRoute) {
      return staticRoute;
    }
    const communityTemplateMatch = normalized.match(/^\/community\/([^/]+)$/);
    if (communityTemplateMatch) {
      return {
        name: "community-detail",
        templateId: decodeURIComponent(communityTemplateMatch[1]),
      };
    }
    const reportProjectMatch = normalized.match(/^\/reports\/([^/]+)$/);
    if (reportProjectMatch) {
      return {
        name: "report-project-overview",
        projectId: decodeURIComponent(reportProjectMatch[1]),
      };
    }

    const companionSpikeAudienceMatch = normalized.match(
      /^\/companion-spike\/([^/]+)\/audience$/,
    );
    if (companionSpikeAudienceMatch) {
      return {
        name: "companion-spike-audience",
        spikeId: decodeURIComponent(companionSpikeAudienceMatch[1]),
      };
    }

    const companionSpikeCaptureMatch = normalized.match(
      /^\/companion-spike\/([^/]+)\/capture$/,
    );
    if (companionSpikeCaptureMatch) {
      return {
        name: "companion-spike-capture",
        spikeId: decodeURIComponent(companionSpikeCaptureMatch[1]),
      };
    }

    const companionSpikeMatch = normalized.match(
      /^\/companion-spike\/([^/]+)$/,
    );
    if (companionSpikeMatch) {
      return {
        name: "companion-spike",
        spikeId: decodeURIComponent(companionSpikeMatch[1]),
      };
    }

    const companionPairMatch = normalized.match(/^\/companion\/pair\/([^/]+)$/);
    if (companionPairMatch) {
      return {
        name: "companion-pair",
        code: decodeURIComponent(companionPairMatch[1]),
      };
    }

    const companionMatch = normalized.match(/^\/companion\/([^/]+)$/);
    if (companionMatch) {
      return {
        name: "companion",
        sessionId: decodeURIComponent(companionMatch[1]),
      };
    }

    const audienceActivityMatch = normalized.match(
      /^\/audience\/([^/]+)\/a\/([^/]+)$/,
    );
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

    const presentationReportMatch = normalized.match(
      /^\/presentation\/([^/]+)\/report\/([^/]+)$/,
    );
    if (presentationReportMatch) {
      return {
        name: "presentation-report",
        projectId: decodeURIComponent(presentationReportMatch[1]),
        sessionId: decodeURIComponent(presentationReportMatch[2]),
        runId: new URLSearchParams(currentSearch).get("runId") ?? undefined,
      };
    }

    const presentationMatch = normalized.match(/^\/presentation\/([^/]+)$/);
    if (presentationMatch) {
      const searchParams = new URLSearchParams(currentSearch);
      const presenterInitialSlideIndex = parseRouteNonNegativeInteger(
        searchParams.get("slideIndex"),
      );
      const presenterInitialStepIndex = parseRouteNonNegativeInteger(
        searchParams.get("stepIndex"),
      );
      const presenterSessionId =
        searchParams.get("presenterSessionId") ?? undefined;
      const presenterWindow = searchParams.get("presenterWindow") === "1";
      return {
        name: "presentation",
        ...(presenterInitialSlideIndex === undefined
          ? {}
          : { presenterInitialSlideIndex }),
        ...(presenterInitialStepIndex === undefined
          ? {}
          : { presenterInitialStepIndex }),
        ...(presenterSessionId ? { presenterSessionId } : {}),
        ...(presenterWindow ? { presenterWindow: true } : {}),
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

    const activityPreviewMatch = normalized.match(
      /^\/project\/([^/]+)\/activity-preview\/([^/]+)$/,
    );
    if (activityPreviewMatch) {
      return {
        name: "activity-preview",
        projectId: decodeURIComponent(activityPreviewMatch[1]),
        activityId: decodeURIComponent(activityPreviewMatch[2]),
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
        preflightMode:
          searchParams.get("preflight") === "complete"
            ? "microphone"
            : searchParams.get("preflight") === "without-voice"
              ? "without-voice"
              : undefined,
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
