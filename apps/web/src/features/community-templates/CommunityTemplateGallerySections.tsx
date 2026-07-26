import type { CommunityTemplateCard as CommunityTemplateCardValue } from "@orbit/shared/community-templates";

import { OrbitButton } from "../../components/ui";
import { CommunityTemplateCard } from "./CommunityTemplateCard";

export type GallerySectionState = {
  items: CommunityTemplateCardValue[];
  loading: boolean;
  error: string | null;
};

export function GallerySection(props: {
  applyingInstanceKey: string | null;
  state: GallerySectionState;
  onApply: (instanceKey: string, card: CommunityTemplateCardValue) => void;
  onRetry: () => void;
  title: string;
}) {
  return (
    <section aria-labelledby="community-template-recent-title">
      <div className="community-template-gallery-section-header">
        <h3 id="community-template-recent-title">{props.title}</h3>
      </div>
      {props.state.loading ? (
        <GallerySkeleton compact />
      ) : props.state.error ? (
        <GalleryInlineError
          message={props.state.error}
          onRetry={props.onRetry}
        />
      ) : (
        <TemplateGrid
          applyingInstanceKey={props.applyingInstanceKey}
          items={props.state.items}
          onApply={props.onApply}
          section="recent"
        />
      )}
    </section>
  );
}

export function TemplateGrid(props: {
  applyingInstanceKey: string | null;
  items: CommunityTemplateCardValue[];
  onApply: (instanceKey: string, card: CommunityTemplateCardValue) => void;
  section: "recent" | "all";
}) {
  return (
    <div className="community-template-gallery-grid">
      {props.items.map((card) => {
        const instanceKey = `${props.section}:${card.templateId}`;
        return (
          <CommunityTemplateCard
            applying={props.applyingInstanceKey === instanceKey}
            card={card}
            disabled={props.applyingInstanceKey !== null}
            instanceKey={instanceKey}
            key={instanceKey}
            onSelect={() => props.onApply(instanceKey, card)}
            purpose="use"
          />
        );
      })}
    </div>
  );
}

export function GallerySkeleton(props: { compact?: boolean }) {
  return (
    <div
      aria-label="커뮤니티 템플릿을 불러오는 중"
      className="community-template-gallery-grid"
      role="status"
    >
      {Array.from({ length: props.compact ? 4 : 8 }, (_, index) => (
        <span className="community-template-gallery-skeleton" key={index} />
      ))}
    </div>
  );
}

export function GalleryInlineError(props: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="community-template-gallery-error" role="alert">
      <span>{props.message}</span>
      <OrbitButton onClick={props.onRetry} variant="secondary">
        다시 시도
      </OrbitButton>
    </div>
  );
}
