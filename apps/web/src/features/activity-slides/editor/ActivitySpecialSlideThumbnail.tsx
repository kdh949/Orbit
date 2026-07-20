import type { ActivityResultsSlide, ActivitySlide, Deck } from "@orbit/shared";

import { OrbitBrand } from "../../../components/ui";
import { createActivityThemeStyle } from "../rendering/activityThemeStyle";

const resultLayoutLabels: Record<ActivityResultsSlide["activityResult"]["layout"], string> = {
  summary: "요약 결과",
  chart: "차트 결과",
  "approved-text": "승인 의견"
};

export function ActivitySpecialSlideThumbnail(props: {
  deck: Pick<Deck, "slides" | "theme">;
  slide: ActivitySlide | ActivityResultsSlide;
}) {
  if (props.slide.kind === "activity") {
    const firstQuestion = props.slide.activity.questions[0];
    return (
      <span
        aria-label={`${props.slide.activity.title} 참여 장표 미리보기`}
        className="activity-special-thumbnail activity-special-thumbnail--activity"
        data-testid="activity-slide-thumbnail"
        style={createActivityThemeStyle(props.deck.theme, props.slide.style)}
      >
        <OrbitBrand className="activity-special-thumbnail-brand" />
        <strong>{props.slide.activity.title}</strong>
        <small>{firstQuestion?.prompt ?? props.slide.activity.description}</small>
      </span>
    );
  }

  const resultSlide = props.slide as ActivityResultsSlide;

  const source = props.deck.slides.find(
    (candidate): candidate is ActivitySlide =>
      candidate.kind === "activity" &&
      candidate.activity.activityId === resultSlide.activityResult.sourceActivityId
  );

  return (
    <span
      aria-label={`${source?.activity.title ?? "연결 결과"} 결과 장표 미리보기`}
      className="activity-special-thumbnail activity-special-thumbnail--results"
      data-testid="activity-results-slide-thumbnail"
      style={createActivityThemeStyle(props.deck.theme, resultSlide.style)}
    >
      <OrbitBrand className="activity-special-thumbnail-brand" />
      <strong>{source ? `${source.activity.title} 결과` : "원본 연결 필요"}</strong>
      <small>{resultLayoutLabels[resultSlide.activityResult.layout]}</small>
    </span>
  );
}
