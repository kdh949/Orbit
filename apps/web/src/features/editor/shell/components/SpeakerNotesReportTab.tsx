import type { Deck, Slide } from "@orbit/shared/deck";

import { SlidePracticeHistoryPanel } from "../../practice/SlidePracticeHistoryPanel";

export function SpeakerNotesReportTab(props: {
  celebrationSessionId: string | null;
  deck: Deck;
  onCelebrationConsumed: (sessionId: string) => void;
  projectId: string;
  refreshToken: number;
  slide: Slide | null;
}) {
  return (
    <div
      aria-labelledby="speaker-notes-report-tab"
      className="speaker-notes-feature-panel speaker-notes-report-panel"
      id="speaker-notes-report-panel"
      role="tabpanel"
    >
      <SlidePracticeHistoryPanel
        celebrationSessionId={props.celebrationSessionId}
        deck={props.deck}
        onCelebrationConsumed={props.onCelebrationConsumed}
        projectId={props.projectId}
        refreshToken={props.refreshToken}
        slide={props.slide}
      />
    </div>
  );
}
