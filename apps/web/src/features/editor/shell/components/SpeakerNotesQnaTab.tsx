import type { Deck, Slide } from "@orbit/shared";

import { SlideQuestionGuidePanel } from "../../practice/SlideQuestionGuidePanel";
import type { AutoSlideQuestionGuideStatus } from "../../practice/useAutoSlideQuestionGuides";

export function SpeakerNotesQnaTab(props: {
  canGenerate: boolean;
  deck: Deck;
  flushPendingSaves: () => Promise<void>;
  projectId: string;
  questionGuideAutoStatus: AutoSlideQuestionGuideStatus;
  questionGuideRefreshToken: number;
  slide: Slide | null;
}) {
  return (
    <div
      aria-labelledby="speaker-notes-qna-tab"
      className="speaker-notes-feature-panel speaker-notes-qna-panel"
      id="speaker-notes-qna-panel"
      role="tabpanel"
    >
      <SlideQuestionGuidePanel
        autoStatus={props.questionGuideAutoStatus}
        canGenerate={props.canGenerate}
        deck={props.deck}
        flushPendingSaves={props.flushPendingSaves}
        projectId={props.projectId}
        refreshToken={props.questionGuideRefreshToken}
        slide={props.slide}
      />
    </div>
  );
}
