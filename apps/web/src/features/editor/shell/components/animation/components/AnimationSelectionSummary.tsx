import type { DeckElement } from "@orbit/shared/deck";
import {
  IconChartBar as BarChart3,
  IconPhoto as ImageIcon,
  IconShape as Shapes,
  IconTypography as Type
} from "@tabler/icons-react";

import { IdBadge } from "../../EditorIdBadge";
import { getAnimationElementLabel } from "../utils/animationUi";

function getElementIcon(element: DeckElement) {
  switch (element.type) {
    case "text":
      return <Type size={18} />;
    case "image":
      return <ImageIcon size={18} />;
    case "chart":
      return <BarChart3 size={18} />;
    default:
      return <Shapes size={18} />;
  }
}

export function AnimationSelectionSummary(props: {
  element: DeckElement;
  showIds: boolean;
  summaryLabel: string;
  summaryTone: "active" | "muted";
}) {
  const { element, showIds, summaryLabel, summaryTone } = props;
  const elementLabel = getAnimationElementLabel(element);

  return (
    <section className="animation-panel-selection-card">
      <div className="animation-panel-selection-main">
        <span className="animation-panel-selection-icon">{getElementIcon(element)}</span>
        <div className="animation-panel-selection-copy">
          <strong>{elementLabel}</strong>
          <span>선택 요소 애니메이션</span>
        </div>
      </div>
      <div className="animation-panel-selection-meta">
        <span className="animation-panel-selection-badge">1개 선택됨</span>
        <span className={`animation-inspector-status-pill ${summaryTone}`}>
          {summaryLabel}
        </span>
        {showIds ? <IdBadge id={element.elementId} /> : null}
      </div>
    </section>
  );
}
