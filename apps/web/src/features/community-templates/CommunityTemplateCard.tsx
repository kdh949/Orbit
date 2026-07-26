import type {
  CommunityTemplateCard as CommunityTemplateCardValue,
  CommunityTemplateCategory,
} from "@orbit/shared/community-templates";

import { CommunityTemplatePreview } from "./CommunityTemplatePreview";

const categoryLabels: Record<CommunityTemplateCategory, string> = {
  business: "비즈니스",
  education: "교육",
  design: "디자인",
  technology: "기술",
  marketing: "마케팅",
  "data-research": "데이터·리서치",
  portfolio: "포트폴리오",
  career: "커리어",
  event: "행사",
  "culture-lifestyle": "문화·라이프",
  other: "기타",
};

export function getCommunityTemplateCategoryLabel(
  category: CommunityTemplateCategory,
) {
  return categoryLabels[category];
}

export function CommunityTemplateCard(props: {
  applying?: boolean;
  card: CommunityTemplateCardValue;
  disabled?: boolean;
  instanceKey?: string;
  onSelect: () => void;
  purpose: "open-gallery" | "use";
  shelf?: boolean;
}) {
  const accessibleName =
    props.purpose === "use"
      ? `${props.card.title} 템플릿으로 바로 시작`
      : `${props.card.title} 템플릿 갤러리에서 보기`;

  return (
    <article
      className={`community-template-card${props.shelf ? " is-shelf" : ""}${props.applying ? " is-applying" : ""}`}
      data-template-instance-key={props.instanceKey}
      data-applying={
        props.instanceKey ? String(Boolean(props.applying)) : undefined
      }
      data-template-shelf-card={props.shelf ? props.card.templateId : undefined}
    >
      <button
        aria-label={accessibleName}
        className="community-template-card-action"
        disabled={props.disabled || props.applying}
        onClick={props.onSelect}
        type="button"
      >
        <span className="community-template-preview-frame">
          <CommunityTemplatePreview card={props.card} />
          {props.applying ? (
            <span
              aria-live="polite"
              className="community-template-applying"
              role="status"
            >
              <span aria-hidden="true" className="community-template-spinner" />
              템플릿 적용 중
            </span>
          ) : null}
        </span>
        <span className="community-template-card-copy">
          <strong>{props.card.title}</strong>
          <small>
            {getCommunityTemplateCategoryLabel(props.card.category)} 디자인
            템플릿
          </small>
        </span>
      </button>
    </article>
  );
}
