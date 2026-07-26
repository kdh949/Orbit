import type { Deck, DeckElement, Slide } from "@orbit/shared/deck";

import { defaultAutoAdvancePolicy } from "../../runtime/presentation/advance/autoAdvanceConfig";
import type { SpeechTrackerSnapshot } from "../../runtime/speech/tracking/speechTrackingEvents";
import type {
  PresenterCompanionSessionIdentity,
  PresentationRuntimeIdentity,
} from "./presentationApi";

export const presentationAutoAdvancePolicy = Object.freeze({
  ...defaultAutoAdvancePolicy,
  live: true,
  rehearsal: false,
});

export function createPresentationScreenSession(
  runtime: PresentationRuntimeIdentity | null,
  presenterSession: PresenterCompanionSessionIdentity | null,
) {
  if (runtime) {
    return {
      audienceUrl: runtime.audienceUrl,
      passcodeState:
        runtime.accessMode === "public"
          ? ({ status: "public" } as const)
          : runtime.displayPasscode
            ? ({
                status: "private",
                displayPasscode: runtime.displayPasscode,
              } as const)
            : ({ status: "legacy-unavailable" } as const),
      sessionId: runtime.sessionId,
    };
  }
  return presenterSession
    ? {
        audienceUrl: presenterSession.audienceUrl,
        passcodeState: { status: "not-prepared" } as const,
        sessionId: presenterSession.sessionId,
      }
    : undefined;
}

export function navigateToProject(projectId?: string) {
  if (!projectId || typeof window === "undefined") {
    return;
  }

  window.history.pushState({}, "", `/project/${encodeURIComponent(projectId)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function navigateToHome() {
  if (typeof window === "undefined") {
    return;
  }

  window.history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function navigateToPresentationReport(input: {
  projectId: string;
  runId: string;
  sessionId: string;
}) {
  if (typeof window === "undefined") {
    return;
  }
  const search = new URLSearchParams({ runId: input.runId });
  window.history.pushState(
    {},
    "",
    `/presentation/${encodeURIComponent(input.projectId)}/report/${encodeURIComponent(
      input.sessionId,
    )}?${search.toString()}`,
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function createEmptySpeechTrackerSnapshot(options: {
  matchableSentenceCount: number;
  slideId: string;
}): SpeechTrackerSnapshot {
  return {
    coveredSentenceIds: [],
    coveredSentenceMatchKinds: {},
    effectiveCoverage: 0,
    finalSentenceSpoken: false,
    hitKeywordIds: [],
    matchableSentenceCount: options.matchableSentenceCount,
    provisionalMissingKeywordIds: [],
    sentenceCoverage: 0,
    slideId: options.slideId,
    wordCoverage: 0,
  };
}

export function getMiniSlideScale(deck: Deck) {
  return Math.min(0.16, 154 / deck.canvas.width, 87 / deck.canvas.height);
}

export function getSlideTitle(slide: Slide) {
  const title = slide.title.trim();
  if (title) {
    return title;
  }

  const titleElement = slide.elements.find(
    (element): element is Extract<DeckElement, { type: "text" }> =>
      element.type === "text" && element.role === "title",
  );
  return titleElement?.props.text || `Slide ${slide.order}`;
}

export function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function parseClockInput(value: string): number | null {
  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^(\d{1,3})(?::([0-5]?\d))?$/);

  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2] ?? 0);

  if (!Number.isInteger(minutes) || !Number.isInteger(seconds)) {
    return null;
  }

  return minutes * 60 + seconds;
}

export function resetPresentationTimerState(actions: {
  setElapsedSeconds: (value: number) => void;
  setIsTimerRunning: (value: boolean) => void;
  setSlideElapsedSeconds: (value: number) => void;
}) {
  actions.setElapsedSeconds(0);
  actions.setSlideElapsedSeconds(0);
  actions.setIsTimerRunning(false);
}
