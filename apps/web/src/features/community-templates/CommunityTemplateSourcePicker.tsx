import type { CommunityTemplateSourceProject } from "@orbit/shared";
import { lazy, Suspense } from "react";

const ProjectSlidePreview = lazy(
  () => import("../projects/ProjectSlidePreview"),
);

export type CommunityTemplateSourceState = {
  items: CommunityTemplateSourceProject[];
  loading: boolean;
  error: string | null;
};

export function CommunityTemplateSourcePicker(props: {
  disabled: boolean;
  error?: string;
  onChange: (projectId: string) => void;
  onRetry: () => void;
  selectedProjectId: string;
  state: CommunityTemplateSourceState;
}) {
  const helperId = "community-template-publish-source-helper";
  const headingId = "community-template-publish-source-heading";
  const descriptionId = "community-template-publish-source-description";
  return (
    <div className="community-template-source-section">
      <div className="community-template-source-heading">
        <h3 id={headingId}>공개할 프로젝트</h3>
        <p id={descriptionId}>
          선택한 프로젝트의 모든 슬라이드가 커뮤니티에 공개됩니다.
        </p>
      </div>
      <fieldset
        aria-describedby={`${descriptionId}${props.error ? ` ${helperId}` : ""}`}
        aria-invalid={props.error ? "true" : undefined}
        aria-labelledby={headingId}
        className="community-template-source-field"
        data-orbit-dialog-initial
        id="community-template-publish-source"
        tabIndex={-1}
      >
        {props.state.loading ? (
          <div
            aria-label="공개 가능한 프로젝트를 불러오는 중"
            className="community-template-source-loading"
            role="status"
          >
            {Array.from({ length: 3 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
        ) : props.state.error ? (
          <div className="community-template-source-error" role="alert">
            <span>{props.state.error}</span>
            <button onClick={props.onRetry} type="button">
              다시 시도
            </button>
          </div>
        ) : props.state.items.length === 0 ? (
          <p className="community-template-source-empty" role="status">
            공개할 수 있는 프로젝트가 없습니다.
          </p>
        ) : (
          <div className="community-template-source-list">
            {props.state.items.map((source) => (
              <label
                aria-disabled={!source.publishable}
                className={`community-template-source-option${source.publishable ? "" : " is-disabled"}`}
                key={source.projectId}
                title={
                  source.publishable
                    ? source.title
                    : getUnavailableReason(source.unavailableReason)
                }
              >
                <input
                  checked={props.selectedProjectId === source.projectId}
                  disabled={props.disabled || !source.publishable}
                  name="community-template-source-project"
                  onChange={() => props.onChange(source.projectId)}
                  type="radio"
                  value={source.projectId}
                />
                <span className="community-template-source-thumbnail" aria-hidden="true">
                  <span className="community-template-source-thumbnail-fallback" />
                  <Suspense fallback={null}>
                    <ProjectSlidePreview
                      className="community-template-source-thumbnail-canvas"
                      projectId={source.projectId}
                    />
                  </Suspense>
                </span>
                <span className="community-template-source-copy">
                  <strong>{source.title}</strong>
                  <small>
                    {source.publishable
                      ? formatSourceDate(source.createdAt)
                      : getUnavailableReason(source.unavailableReason)}
                  </small>
                </span>
                <span className="community-template-source-check" aria-hidden="true" />
              </label>
            ))}
          </div>
        )}

        {props.error ? (
          <small id={helperId} role="alert">
            {props.error}
          </small>
        ) : null}
      </fieldset>
    </div>
  );
}

function getUnavailableReason(
  reason: CommunityTemplateSourceProject["unavailableReason"],
) {
  switch (reason) {
    case "ALREADY_PUBLISHED":
      return "이미 커뮤니티에 공개됨";
    case "ACTIVITY_UNSUPPORTED":
      return "활동 슬라이드는 공개할 수 없음";
    case "SNAPSHOT_TOO_LARGE":
      return "프로젝트 용량이 공개 제한을 초과함";
    case "SOURCE_DECK_NOT_FOUND":
      return "슬라이드 데이터를 찾을 수 없음";
    default:
      return "안전한 공개 형식으로 변환할 수 없음";
  }
}

function formatSourceDate(createdAt: string) {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime())
    ? "날짜 없음"
    : `${date.toLocaleDateString("ko-KR")} 생성`;
}
