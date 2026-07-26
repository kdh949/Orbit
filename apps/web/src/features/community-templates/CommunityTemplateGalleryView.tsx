import type {
  CommunityTemplateCard,
  CommunityTemplateCategory,
} from "@orbit/shared/community-templates";
import { IconSearch, IconUpload } from "@tabler/icons-react";

import { OrbitButton, OrbitDialog, OrbitInput } from "../../components/ui";
import {
  GalleryInlineError,
  GallerySection,
  GallerySkeleton,
  TemplateGrid,
  type GallerySectionState,
} from "./CommunityTemplateGallerySections";

const categories: Array<{
  value: CommunityTemplateCategory | undefined;
  label: string;
}> = [
  { value: undefined, label: "전체" },
  { value: "business", label: "비즈니스" },
  { value: "education", label: "교육" },
  { value: "portfolio", label: "포트폴리오" },
  { value: "event", label: "이벤트" },
];

export type CommunityTemplateGalleryViewProps = {
  applyingInstanceKey: string | null;
  applyError: string | null;
  category: CommunityTemplateCategory | undefined;
  hasMore: boolean;
  list: GallerySectionState;
  onApply: (instanceKey: string, card: CommunityTemplateCard) => void;
  onCategoryChange: (category: CommunityTemplateCategory | undefined) => void;
  onClose: () => void;
  onOpenPublish: () => void;
  onPageChange: (page: number) => void;
  onResetFilters: () => void;
  onRetryApply: () => void;
  onRetryList: () => void;
  onRetryRecent: () => void;
  onSearchInputChange: (value: string) => void;
  open: boolean;
  page: number;
  publishReturnFocus: boolean;
  recent: GallerySectionState;
  searchInput: string;
};

export function CommunityTemplateGalleryView(
  props: CommunityTemplateGalleryViewProps,
) {
  const applying = props.applyingInstanceKey !== null;
  return (
    <OrbitDialog
      className="community-template-gallery-dialog"
      closeDisabled={applying}
      description="디자인과 레이아웃을 골라 바로 시작하세요."
      onClose={props.onClose}
      open={props.open}
      title="커뮤니티 템플릿"
    >
      <div className="community-template-gallery-toolbar">
        <label className="community-template-search">
          <span className="community-template-visually-hidden">
            템플릿 검색
          </span>
          <IconSearch aria-hidden="true" size={18} />
          <OrbitInput
            data-orbit-dialog-initial={
              props.publishReturnFocus ? undefined : true
            }
            disabled={applying}
            onChange={(event) => props.onSearchInputChange(event.target.value)}
            placeholder="템플릿 검색"
            type="search"
            value={props.searchInput}
          />
        </label>
        <div
          aria-label="템플릿 카테고리"
          className="community-template-categories"
        >
          {categories.map((category) => (
            <button
              aria-pressed={props.category === category.value}
              disabled={applying}
              key={category.label}
              onClick={() => props.onCategoryChange(category.value)}
              type="button"
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="community-template-publisher-strip">
        <span aria-hidden="true" className="community-template-publisher-icon">
          <IconUpload size={20} stroke={1.8} />
        </span>
        <div>
          <strong>내 슬라이드 올리기</strong>
          <p>내 프로젝트의 디자인을 커뮤니티와 공유해 보세요.</p>
        </div>
        <OrbitButton
          className="community-template-publisher-action"
          data-orbit-dialog-initial={props.publishReturnFocus || undefined}
          disabled={applying}
          onClick={props.onOpenPublish}
          variant="secondary"
        >
          내 슬라이드 올리기
        </OrbitButton>
      </div>

      {props.applyError ? (
        <div className="community-template-apply-error" role="alert">
          <span>{props.applyError}</span>
          <OrbitButton onClick={props.onRetryApply} variant="secondary">
            다시 시도
          </OrbitButton>
        </div>
      ) : null}

      <div className="community-template-gallery-content">
        {props.recent.loading ||
        props.recent.error ||
        props.recent.items.length ? (
          <GallerySection
            applyingInstanceKey={props.applyingInstanceKey}
            state={props.recent}
            onApply={props.onApply}
            onRetry={props.onRetryRecent}
            title="최근 사용한 템플릿"
          />
        ) : null}

        <section aria-labelledby="community-template-all-title">
          <div className="community-template-gallery-section-header">
            <h3 id="community-template-all-title">모든 템플릿</h3>
            <p>카드를 선택하면 바로 시작해요</p>
          </div>

          {props.list.loading ? (
            <GallerySkeleton />
          ) : props.list.error ? (
            <GalleryInlineError
              message={props.list.error}
              onRetry={props.onRetryList}
            />
          ) : props.list.items.length === 0 ? (
            <div className="community-template-empty" role="status">
              <IconSearch aria-hidden="true" size={30} />
              <strong>조건에 맞는 템플릿이 없습니다.</strong>
              <span>검색어나 카테고리를 바꿔 다시 찾아보세요.</span>
              <OrbitButton
                disabled={applying}
                onClick={props.onResetFilters}
                variant="secondary"
              >
                전체 템플릿 보기
              </OrbitButton>
            </div>
          ) : (
            <TemplateGrid
              applyingInstanceKey={props.applyingInstanceKey}
              items={props.list.items}
              onApply={props.onApply}
              section="all"
            />
          )}

          {props.page > 1 || props.hasMore ? (
            <nav
              aria-label="모든 템플릿 페이지"
              className="community-template-pagination"
            >
              <OrbitButton
                disabled={applying || props.page === 1}
                onClick={() => props.onPageChange(props.page - 1)}
                variant="secondary"
              >
                이전
              </OrbitButton>
              <span>{props.page}페이지</span>
              <OrbitButton
                disabled={applying || !props.hasMore}
                onClick={() => props.onPageChange(props.page + 1)}
                variant="secondary"
              >
                다음
              </OrbitButton>
            </nav>
          ) : null}
        </section>
      </div>
    </OrbitDialog>
  );
}
