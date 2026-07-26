import { demoIds } from "@orbit/shared/common";
import {
  type CommunityTemplateCard,
  type CommunityTemplateComment,
  type CommunityTemplateDetail,
  type CommunityTemplateCategory,
  type CommunityTemplateReportReason,
} from "@orbit/shared/community-templates";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconCheck,
  IconHeart,
  IconPencil,
  IconFlag,
  IconShare3,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { WorkspaceContainer } from "../../components/patterns";
import {
  GradientButton,
  OrbitButton,
  OrbitEmptyState,
  OrbitDialog,
  OrbitField,
  OrbitIconButton,
  OrbitInput,
  OrbitSelect,
  OrbitTextarea,
} from "../../components/ui";
import { CommunityTemplatePreview } from "./CommunityTemplatePreview";
import { compactCount } from "./CommunityGalleryPage";
import { useCommunityTemplate } from "./communityTemplateApi";
import {
  createCommunityComment,
  deleteCommunityComment,
  fetchCommunityComments,
  fetchCommunityDetail,
  recordCommunityShare,
  recordCommunityView,
  reportCommunityTemplate,
  setCommunityLike,
  unpublishCommunityTemplate,
  updateCommunityComment,
  updateCommunityTemplate,
} from "./communitySocialApi";
import "./community-page.css";

export function CommunityTemplateDetailPage(props: {
  onNavigate: (path: string) => void;
  templateId: string;
}) {
  const queryClient = useQueryClient();
  const recordedView = useRef<string | null>(null);
  const [comment, setComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [useBusy, setUseBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [manageTitle, setManageTitle] = useState("");
  const [manageCategory, setManageCategory] = useState<CommunityTemplateCategory>("business");
  const [manageDescription, setManageDescription] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportReason, setReportReason] = useState<CommunityTemplateReportReason>("inappropriate");
  const [reportDetails, setReportDetails] = useState("");
  const detail = useQuery({
    queryKey: ["community", "detail", props.templateId],
    queryFn: () => fetchCommunityDetail(props.templateId),
    retry: false,
  });
  const comments = useQuery({
    queryKey: ["community", "comments", props.templateId],
    queryFn: () => fetchCommunityComments(props.templateId, { page: 1, limit: 50 }),
    retry: false,
  });

  useEffect(() => {
    if (!detail.data || recordedView.current === props.templateId) return;
    recordedView.current = props.templateId;
    void recordCommunityView(props.templateId)
      .then((engagement) => {
        queryClient.setQueryData<CommunityTemplateDetail>(
          ["community", "detail", props.templateId],
          (current) => current ? { ...current, stats: engagement.stats } : current,
        );
      })
      .catch(() => undefined);
  }, [detail.data, props.templateId, queryClient]);

  const slideCards = useMemo(
    () => detail.data ? detail.data.snapshot.slides.map((slide) => ({
      ...detail.data,
      preview: {
        canvas: detail.data.snapshot.canvas,
        theme: detail.data.snapshot.theme,
        slide,
      },
    } satisfies CommunityTemplateCard)) : [],
    [detail.data],
  );

  async function toggleLike() {
    if (!detail.data || likeBusy) return;
    setLikeBusy(true);
    setActionError(null);
    try {
      const result = await setCommunityLike(props.templateId, !detail.data.likedByMe);
      queryClient.setQueryData<CommunityTemplateDetail>(
        ["community", "detail", props.templateId],
        { ...detail.data, likedByMe: result.likedByMe, stats: result.stats },
      );
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "좋아요를 반영하지 못했습니다.");
    } finally {
      setLikeBusy(false);
    }
  }

  async function shareTemplate() {
    if (!detail.data) return;
    const shareData = { title: detail.data.title, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else await navigator.clipboard.writeText(window.location.href);
      const result = await recordCommunityShare(props.templateId);
      queryClient.setQueryData<CommunityTemplateDetail>(
        ["community", "detail", props.templateId],
        { ...detail.data, stats: result.stats },
      );
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setActionError("공유 링크를 만들지 못했습니다.");
    }
  }

  async function useTemplate() {
    if (useBusy) return;
    setUseBusy(true);
    setActionError(null);
    try {
      const result = await useCommunityTemplate({
        workspaceId: demoIds.workspaceId,
        templateId: props.templateId,
        clientRequestId: crypto.randomUUID(),
      });
      props.onNavigate(`/project/${encodeURIComponent(result.project.projectId)}`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "템플릿을 적용하지 못했습니다.");
      setUseBusy(false);
    }
  }

  async function submitComment() {
    const body = comment.trim();
    if (!body || submittingComment) return;
    setSubmittingComment(true);
    setActionError(null);
    try {
      await createCommunityComment(props.templateId, body);
      setComment("");
      await Promise.all([comments.refetch(), detail.refetch()]);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "댓글을 등록하지 못했습니다.");
    } finally {
      setSubmittingComment(false);
    }
  }

  async function saveComment(item: CommunityTemplateComment) {
    const body = editingBody.trim();
    if (!body) return;
    await updateCommunityComment(props.templateId, item.commentId, body);
    setEditingId(null);
    await comments.refetch();
  }

  async function removeComment(item: CommunityTemplateComment) {
    if (!window.confirm("댓글을 삭제할까요?")) return;
    await deleteCommunityComment(props.templateId, item.commentId);
    await Promise.all([comments.refetch(), detail.refetch()]);
  }

  function openManagement() {
    if (!detail.data) return;
    setManageTitle(detail.data.title);
    setManageCategory(detail.data.category);
    setManageDescription(detail.data.description);
    setManageOpen(true);
  }

  async function saveManagement() {
    const title = manageTitle.trim();
    if (!title || manageBusy) return;
    setManageBusy(true);
    setActionError(null);
    try {
      const updated = await updateCommunityTemplate(props.templateId, {
        title,
        category: manageCategory,
        description: manageDescription,
      });
      queryClient.setQueryData<CommunityTemplateDetail>(
        ["community", "detail", props.templateId],
        (current) => current ? {
          ...current,
          title: updated.title,
          category: updated.category,
          description: updated.description,
        } : current,
      );
      await queryClient.invalidateQueries({ queryKey: ["community", "discover"] });
      setManageOpen(false);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "공개 정보를 수정하지 못했습니다.");
    } finally {
      setManageBusy(false);
    }
  }

  async function unpublish() {
    if (manageBusy || !window.confirm("이 프로젝트를 커뮤니티에서 공개 취소할까요?")) return;
    setManageBusy(true);
    setActionError(null);
    try {
      await unpublishCommunityTemplate(props.templateId);
      await queryClient.invalidateQueries({ queryKey: ["community"] });
      props.onNavigate("/community");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "공개를 취소하지 못했습니다.");
      setManageBusy(false);
    }
  }

  async function submitReport() {
    if (reportBusy) return;
    setReportBusy(true);
    setActionError(null);
    try {
      await reportCommunityTemplate(props.templateId, {
        reason: reportReason,
        details: reportDetails,
      });
      setReportOpen(false);
      setReportDetails("");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "신고를 접수하지 못했습니다.");
    } finally {
      setReportBusy(false);
    }
  }

  if (detail.isLoading) return <div className="community-detail-loading" role="status"><IconSparkles size={24} />발표자료를 펼치고 있습니다.</div>;
  if (detail.isError || !detail.data) {
    return <OrbitEmptyState action={<OrbitButton onClick={() => props.onNavigate("/community")}>커뮤니티로 돌아가기</OrbitButton>} description="삭제되었거나 접근할 수 없는 자료입니다." title="발표자료를 찾을 수 없습니다." />;
  }
  const template = detail.data;

  return (
    <main className="community-detail-page">
      <header className="community-detail-header">
        <WorkspaceContainer as="div" className="community-detail-header-inner" width="content">
          <OrbitIconButton aria-label="커뮤니티로 돌아가기" onClick={() => props.onNavigate("/community")}><IconArrowLeft size={19} /></OrbitIconButton>
          <div><h1>{template.title}</h1><p>{template.category} · 전체 {template.snapshot.slides.length}장</p></div>
          <div className="community-detail-header-actions">
            {template.ownedByMe ? (
              <OrbitButton icon={<IconPencil size={16} />} onClick={openManagement} variant="secondary">공개 정보 수정</OrbitButton>
            ) : (
              <OrbitButton icon={<IconFlag size={16} />} onClick={() => setReportOpen(true)} variant="secondary">신고</OrbitButton>
            )}
            <OrbitButton icon={<IconShare3 size={16} />} onClick={() => void shareTemplate()} variant="secondary">공유하기</OrbitButton>
            <OrbitButton icon={<IconHeart size={16} />} loading={likeBusy} onClick={() => void toggleLike()} variant={template.likedByMe ? "primary" : "secondary"}>{compactCount(template.stats.likeCount)} 좋아요</OrbitButton>
          </div>
        </WorkspaceContainer>
      </header>

      <WorkspaceContainer as="div" className="community-detail-layout" width="content">
        <section className="community-detail-slides" aria-label="템플릿 슬라이드">
          {slideCards.map((card, index) => (
            <article className="community-detail-slide" key={`${card.templateId}-${index}`}>
              <span>SLIDE {index + 1}</span>
              <CommunityTemplatePreview card={card} />
            </article>
          ))}
        </section>

        <aside className="community-detail-sidebar">
          <section className="community-detail-creator">
            <div className="community-detail-author"><span>{template.author.avatarUrl ? <img alt="" src={template.author.avatarUrl} /> : template.author.displayName.slice(0, 1)}</span><div><strong>{template.author.displayName}</strong><small>ORBIT Creator</small></div></div>
            <div className="community-detail-description"><strong>제작자 한마디</strong><p>{template.description || "발표의 흐름과 시각적 완성도를 함께 고려한 템플릿입니다. 내 콘텐츠에 맞게 자유롭게 활용해 보세요."}</p></div>
            <dl className="community-detail-stats">
              <div><dt>좋아요</dt><dd>{compactCount(template.stats.likeCount)}</dd></div>
              <div><dt>조회수</dt><dd>{compactCount(template.stats.viewCount)}</dd></div>
              <div><dt>사용</dt><dd>{compactCount(template.stats.useCount)}</dd></div>
              <div><dt>공유</dt><dd>{compactCount(template.stats.shareCount)}</dd></div>
            </dl>
            <GradientButton disabled={useBusy} onClick={() => void useTemplate()}><IconSparkles size={17} />{useBusy ? "적용 중" : "이 프로젝트로 시작하기"}</GradientButton>
          </section>

          <section className="community-detail-comments">
            <header><h2>댓글 <span>{template.stats.commentCount}</span></h2></header>
            <div className="community-comments-list">
              {comments.isLoading ? <p className="community-comments-state">댓글을 불러오는 중입니다.</p> : null}
              {!comments.isLoading && comments.data?.items.length === 0 ? (
                <div className="community-comments-empty">
                  <OrbitEmptyState
                    description="제작자에게 첫 감상과 응원을 남겨보세요."
                    title="아직 등록된 댓글이 없습니다."
                  />
                </div>
              ) : null}
              {comments.data?.items.map((item) => (
                <article className="community-comment" key={item.commentId}>
                  <span className="community-comment-avatar">{item.author.avatarUrl ? <img alt="" src={item.author.avatarUrl} /> : item.author.displayName.slice(0, 1)}</span>
                  <div>
                    <header><strong>{item.author.displayName}</strong><time>{formatRelativeDate(item.createdAt)}</time></header>
                    {editingId === item.commentId ? (
                      <div className="community-comment-edit"><OrbitTextarea maxLength={500} onChange={(event) => setEditingBody(event.currentTarget.value)} rows={3} value={editingBody} /><div><OrbitIconButton aria-label="수정 취소" onClick={() => setEditingId(null)}><IconX size={15} /></OrbitIconButton><OrbitIconButton aria-label="수정 저장" onClick={() => void saveComment(item)}><IconCheck size={15} /></OrbitIconButton></div></div>
                    ) : <p>{item.body}</p>}
                    {item.ownedByMe && editingId !== item.commentId ? (
                      <div className="community-comment-actions">
                        <OrbitIconButton aria-label="댓글 수정" onClick={() => { setEditingId(item.commentId); setEditingBody(item.body); }}><IconPencil size={14} /></OrbitIconButton>
                        <OrbitIconButton aria-label="댓글 삭제" onClick={() => void removeComment(item)}><IconTrash size={14} /></OrbitIconButton>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
            <div className="community-comment-composer">
              <span className="community-comment-composer-label">댓글 작성</span>
              <OrbitTextarea maxLength={500} onChange={(event) => setComment(event.currentTarget.value)} placeholder="제작자에게 따뜻한 조언과 감상을 남겨주세요." rows={3} value={comment} />
              <div className="community-comment-submit"><small>{comment.length} / 500</small><OrbitButton disabled={!comment.trim()} loading={submittingComment} onClick={() => void submitComment()}>등록</OrbitButton></div>
            </div>
          </section>
        </aside>
      </WorkspaceContainer>

      {actionError ? <div className="community-detail-error" role="alert">{actionError}</div> : null}
      <button className={`community-detail-floating-like${template.likedByMe ? " is-active" : ""}`} disabled={likeBusy} onClick={() => void toggleLike()} type="button"><IconHeart size={19} />{template.likedByMe ? "좋아요 취소" : "좋아요 누르기"}</button>

      <OrbitDialog
        className="community-detail-management-dialog"
        closeDisabled={manageBusy}
        description="커뮤니티에 표시되는 제목과 소개를 관리합니다. 슬라이드 원본은 변경되지 않습니다."
        footer={<><OrbitButton disabled={manageBusy} onClick={() => void unpublish()} variant="secondary">공개 취소</OrbitButton><OrbitButton disabled={!manageTitle.trim()} loading={manageBusy} onClick={() => void saveManagement()}>저장</OrbitButton></>}
        onClose={() => setManageOpen(false)}
        open={manageOpen}
        title="공개 정보 수정"
      >
        <div className="community-detail-dialog-fields">
          <OrbitField id="community-manage-title" label="제목"><OrbitInput maxLength={60} onChange={(event) => setManageTitle(event.currentTarget.value)} value={manageTitle} /></OrbitField>
          <OrbitField id="community-manage-category" label="카테고리"><OrbitSelect onChange={(event) => setManageCategory(event.currentTarget.value as CommunityTemplateCategory)} value={manageCategory}><option value="business">비즈니스</option><option value="education">교육</option><option value="portfolio">포트폴리오</option><option value="event">이벤트</option></OrbitSelect></OrbitField>
          <OrbitField hint={`${manageDescription.length} / 300`} id="community-manage-description" label="짧은 소개글"><OrbitTextarea maxLength={300} onChange={(event) => setManageDescription(event.currentTarget.value)} rows={4} value={manageDescription} /></OrbitField>
        </div>
      </OrbitDialog>

      <OrbitDialog
        className="community-detail-report-dialog"
        closeDisabled={reportBusy}
        description="운영 정책을 위반하거나 권리를 침해한 자료를 알려주세요. 신고 내용은 작성자에게 공개되지 않습니다."
        footer={<><OrbitButton disabled={reportBusy} onClick={() => setReportOpen(false)} variant="secondary">취소</OrbitButton><OrbitButton loading={reportBusy} onClick={() => void submitReport()}>신고 접수</OrbitButton></>}
        onClose={() => setReportOpen(false)}
        open={reportOpen}
        title="커뮤니티 자료 신고"
      >
        <div className="community-detail-dialog-fields">
          <OrbitField id="community-report-reason" label="신고 사유"><OrbitSelect onChange={(event) => setReportReason(event.currentTarget.value as CommunityTemplateReportReason)} value={reportReason}><option value="copyright">저작권 침해</option><option value="spam">스팸 또는 홍보</option><option value="harassment">괴롭힘 또는 혐오</option><option value="inappropriate">부적절한 콘텐츠</option><option value="other">기타</option></OrbitSelect></OrbitField>
          <OrbitField hint={`${reportDetails.length} / 500`} id="community-report-details" label="상세 내용"><OrbitTextarea maxLength={500} onChange={(event) => setReportDetails(event.currentTarget.value)} placeholder="운영자가 확인할 수 있도록 문제를 간단히 설명해 주세요." rows={5} value={reportDetails} /></OrbitField>
        </div>
      </OrbitDialog>
    </main>
  );
}

function formatRelativeDate(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return new Date(value).toLocaleDateString("ko-KR");
}
