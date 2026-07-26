import type { CommunityTemplateCard as CommunityTemplateCardValue } from "@orbit/shared/community-templates";
import { IconChevronRight, IconPlus } from "@tabler/icons-react";

import { CommunityTemplateCard } from "./CommunityTemplateCard";
import "./community-template-gallery.css";

export function CommunityTemplateShelf(props: {
  cards: CommunityTemplateCardValue[];
  error: string | null;
  isCreatingBlank: boolean;
  loading: boolean;
  onCreateBlank: () => void;
  onOpenGallery: () => void;
  onRetry: () => void;
}) {
  const cards = props.cards.slice(0, 4);

  return (
    <section
      aria-labelledby="community-template-shelf-title"
      className="community-template-shelf"
    >
      <header className="community-template-shelf-header">
        <h2 id="community-template-shelf-title">템플릿으로 시작하기</h2>
        <button
          className="community-template-shelf-more"
          onClick={props.onOpenGallery}
          type="button"
        >
          전체보기
          <IconChevronRight aria-hidden="true" size={15} />
        </button>
      </header>

      <div className="community-template-shelf-grid">
        <button
          aria-label="빈 프레젠테이션 만들기"
          className="community-template-blank-card"
          disabled={props.isCreatingBlank}
          onClick={props.onCreateBlank}
          type="button"
        >
          <span aria-hidden="true" className="community-template-blank-preview">
            <IconPlus size={24} stroke={1.8} />
          </span>
          <span className="community-template-card-copy">
            <strong>빈 프레젠테이션</strong>
            <small>
              {props.isCreatingBlank ? "만드는 중" : "새 슬라이드로 시작"}
            </small>
          </span>
        </button>

        {props.loading
          ? Array.from({ length: 4 }, (_, index) => (
              <span
                aria-label="템플릿을 불러오는 중"
                className="community-template-shelf-skeleton"
                data-template-shelf-skeleton={index + 1}
                key={index}
                role="status"
              />
            ))
          : cards.map((card) => (
              <CommunityTemplateCard
                card={card}
                key={card.templateId}
                onSelect={props.onOpenGallery}
                purpose="open-gallery"
                shelf
              />
            ))}
      </div>

      {props.error ? (
        <div className="community-template-shelf-error" role="alert">
          <span>{props.error}</span>
          <button onClick={props.onRetry} type="button">
            템플릿 다시 불러오기
          </button>
        </div>
      ) : null}
    </section>
  );
}
