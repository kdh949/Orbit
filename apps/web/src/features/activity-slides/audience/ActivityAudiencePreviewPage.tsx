import type { ActivitySlide, Deck } from "@orbit/shared";
import { useQuery } from "@tanstack/react-query";
import { IconArrowLeft, IconCheck, IconEye } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { WorkspaceContainer } from "../../../components/patterns";
import {
  OrbitBrand,
  OrbitButton,
  OrbitButtonLink,
  OrbitEmptyState,
  OrbitFailureState,
  OrbitStatus
} from "../../../components/ui";
import { fetchProjectDeckPreview } from "../../projects/ProjectAssetWorkspace";
import { AudienceSatisfactionForm } from "./AudienceSatisfactionPage";
import {
  createSatisfactionDraft,
  type SatisfactionDraft
} from "./activityFormModel";
import "./activity-audience-preview.css";

export const activityAudiencePreviewQueryKey = (projectId: string) => [
  "projects",
  projectId,
  "activity-audience-preview"
] as const;

export function findActivityPreviewSlide(
  deck: Deck | null | undefined,
  activityId: string
): ActivitySlide | null {
  const slide = deck?.slides.find(
    (candidate): candidate is ActivitySlide =>
      candidate.kind === "activity" && candidate.activity.activityId === activityId
  );
  return slide ?? null;
}

export function ActivityAudiencePreviewPage(props: {
  activityId: string;
  projectId: string;
}) {
  const deckQuery = useQuery({
    queryKey: activityAudiencePreviewQueryKey(props.projectId),
    queryFn: () => fetchProjectDeckPreview(props.projectId)
  });
  const slide = findActivityPreviewSlide(deckQuery.data, props.activityId);
  const [draft, setDraft] = useState<SatisfactionDraft>(() => createSatisfactionDraft(null));
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setDraft(createSatisfactionDraft(null));
    setSubmitted(false);
  }, [props.activityId]);

  const editorHref = `/project/${encodeURIComponent(props.projectId)}`;

  return (
    <main className="activity-audience-preview-page">
      <header className="activity-audience-preview-header">
        <WorkspaceContainer className="activity-audience-preview-header-inner" width="content">
          <a aria-label="ORBIT 홈으로 이동" href="/">
            <OrbitBrand />
          </a>
          <div>
            <strong>사전 질문 미리보기</strong>
            <span>청중에게 보일 입력 화면을 확인하세요.</span>
          </div>
          <OrbitButtonLink href={editorHref} icon={<IconArrowLeft aria-hidden="true" size={18} />} variant="secondary">
            에디터로 돌아가기
          </OrbitButtonLink>
        </WorkspaceContainer>
      </header>

      <WorkspaceContainer as="section" className="activity-audience-preview-main" width="content">
        <div className="activity-audience-preview-notice" role="status">
          <IconEye aria-hidden="true" size={20} />
          <div>
            <strong>청중 화면 미리보기</strong>
            <span>여기서 입력한 내용은 실제 응답으로 저장되지 않습니다.</span>
          </div>
          <OrbitStatus tone="info">미리보기</OrbitStatus>
        </div>

        {deckQuery.isLoading ? (
          <section className="activity-audience-preview-loading" role="status">
            <span aria-hidden="true" />
            <strong>사전 질문 화면을 불러오고 있습니다</strong>
          </section>
        ) : null}

        {deckQuery.isError ? (
          <OrbitFailureState
            description="잠시 후 다시 시도해 주세요."
            onRetry={() => void deckQuery.refetch()}
            title="사전 질문 미리보기를 불러오지 못했습니다."
          />
        ) : null}

        {deckQuery.isSuccess && !slide ? (
          <OrbitEmptyState
            action={<OrbitButtonLink href={editorHref}>에디터로 돌아가기</OrbitButtonLink>}
            description="장표가 삭제되었거나 주소가 변경되었을 수 있습니다."
            title="미리 볼 사전 질문을 찾지 못했습니다."
          />
        ) : null}

        {slide && !submitted ? (
          <AudienceSatisfactionForm
            definition={slide.activity}
            draft={draft}
            errorMessage=""
            isSubmitting={false}
            onChange={setDraft}
            onSubmit={() => setSubmitted(true)}
          />
        ) : null}

        {slide && submitted ? (
          <section className="activity-audience-card activity-audience-preview-receipt" role="status">
            <span className="activity-audience-preview-receipt-icon">
              <IconCheck aria-hidden="true" size={28} />
            </span>
            <span className="activity-audience-eyebrow">PREVIEW COMPLETE</span>
            <h1>청중의 제출 화면까지 확인했습니다</h1>
            <p>미리보기에서 입력한 내용은 저장되지 않았습니다.</p>
            <div>
              <OrbitButton onClick={() => setSubmitted(false)} variant="secondary">
                다시 입력해 보기
              </OrbitButton>
              <OrbitButtonLink href={editorHref}>에디터로 돌아가기</OrbitButtonLink>
            </div>
          </section>
        ) : null}
      </WorkspaceContainer>
    </main>
  );
}
