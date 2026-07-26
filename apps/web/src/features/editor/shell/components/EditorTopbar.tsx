import type { Deck, DeckExportFormat } from "@orbit/shared/deck";
import { useQuery } from "@tanstack/react-query";
import {
  IconChevronDown as ChevronDown,
  IconClock as Clock,
  IconHistory as History,
  IconHome as Home,
  IconPencil as PenLine,
  IconRefresh as RefreshCw,
  IconShare as Share2,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  authMeQueryKey,
  fetchCurrentUser,
  getAvatarUrl,
} from "../../../auth/auth-session";
import type { EditorShellUiUpdater, TopMenu } from "../editorShellUiStore";
import {
  getPresenceUserInitial,
  getPresenceUserLabel,
  type ProjectPresenceUser,
} from "../hooks/useProjectPresence";
import { EditorSaveControl } from "./EditorSaveControl";
import { EditorFileMenu } from "./EditorFileMenu";
import { EditorIconButton } from "./EditorIconButton";
import { PresentationMenu } from "./PresentationMenu";

type EditorTopbarProps = {
  activePresentationAction: "presentation" | "rehearsal" | null;
  activeTopMenu: TopMenu | null;
  canManageShare: boolean;
  canMutateDeck: boolean;
  canOpenAudienceLink: boolean;
  canStartPresentation: boolean;
  canvas: Deck["canvas"];
  deckTitle: string;
  isDeckLoading: boolean;
  isPptxExporting: boolean;
  isSharePermissionLoading: boolean;
  isSlideRehearsalActive: boolean;
  isUsingFallbackDeck: boolean;
  lastSavedAtLabel: string | null;
  onExitToHome: () => void;
  onOpenExport: (format: DeckExportFormat) => void;
  onImportPptx: () => void;
  onOpenAudienceLink: () => void;
  onOpenCommunityShare: () => void;
  onOpenPresenceDebug: () => void;
  onOpenShare: () => void;
  onOpenTargetDuration: () => void;
  onRefresh: () => void;
  onRenameDeckTitle: (title: string) => void;
  onSave: () => void;
  onStartFullRehearsal: () => void;
  onStartPresentation: () => void;
  onStartRehearsal: () => void;
  projectId: string;
  projectPresenceUsers: ProjectPresenceUser[];
  pptxExportMessage: string;
  pptxImportMeta: string;
  recoveryHint: string | null;
  saveFailed: boolean;
  saveMenuMeta: string;
  saveStatusLabel: string;
  setActiveTopMenu: (updater: EditorShellUiUpdater<TopMenu | null>) => void;
  showLoadedFileLabel: boolean;
  saving: boolean;
};

export function EditorTopbar(props: EditorTopbarProps) {
  const topbarRef = useRef<HTMLElement | null>(null);
  const titleEditCancelledRef = useRef(false);
  const {
    activePresentationAction,
    activeTopMenu,
    canManageShare,
    canMutateDeck,
    canOpenAudienceLink,
    canStartPresentation,
    canvas,
    deckTitle,
    isDeckLoading,
    isPptxExporting,
    isSharePermissionLoading,
    isSlideRehearsalActive,
    isUsingFallbackDeck,
    lastSavedAtLabel,
    onExitToHome,
    onOpenExport,
    onImportPptx,
    onOpenAudienceLink,
    onOpenCommunityShare,
    onOpenPresenceDebug,
    onOpenShare,
    onOpenTargetDuration,
    onRefresh,
    onRenameDeckTitle,
    onSave,
    onStartFullRehearsal,
    onStartPresentation,
    onStartRehearsal,
    projectId,
    projectPresenceUsers,
    pptxExportMessage,
    pptxImportMeta,
    recoveryHint,
    saveFailed,
    saveMenuMeta,
    saveStatusLabel,
    setActiveTopMenu,
    showLoadedFileLabel,
    saving,
  } = props;
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(deckTitle);
  const { data: currentUser } = useQuery({
    queryFn: () => fetchCurrentUser(),
    queryKey: authMeQueryKey,
  });
  const currentUserAvatarUrl = getAvatarUrl(currentUser?.avatar);

  useEffect(() => {
    if (!isEditingTitle) setTitleDraft(deckTitle);
  }, [deckTitle, isEditingTitle]);

  function finishTitleEditing() {
    if (titleEditCancelledRef.current) {
      titleEditCancelledRef.current = false;
      setTitleDraft(deckTitle);
      setIsEditingTitle(false);
      return;
    }
    const title = titleDraft.trim();
    if (title && title !== deckTitle) onRenameDeckTitle(title);
    if (!title) setTitleDraft(deckTitle);
    setIsEditingTitle(false);
  }

  useEffect(() => {
    if (!activeTopMenu) return;

    function handlePointerDown(event: MouseEvent) {
      if (!topbarRef.current?.contains(event.target as Node)) {
        setActiveTopMenu(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveTopMenu(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeTopMenu, setActiveTopMenu]);

  return (
    <header className="app-topbar" ref={topbarRef}>
      <div className="topbar-left">
        <div className="menu-stack">
          <div className="editor-document-title">
            <span className="editor-document-title-content">
              {isEditingTitle ? (
                <input
                  aria-label="프레젠테이션 제목"
                  autoFocus
                  className="editor-document-title-input"
                  maxLength={200}
                  onBlur={finishTitleEditing}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      titleEditCancelledRef.current = true;
                      setTitleDraft(deckTitle);
                      setIsEditingTitle(false);
                    }
                  }}
                  value={titleDraft}
                />
              ) : (
                <strong>{deckTitle}</strong>
              )}
              {canMutateDeck ? (
                <button
                  aria-label="프레젠테이션 제목 수정"
                  className="editor-title-edit-button"
                  title="제목 수정"
                  type="button"
                  onClick={() => {
                    titleEditCancelledRef.current = false;
                    setTitleDraft(deckTitle);
                    setIsEditingTitle(true);
                    setActiveTopMenu(null);
                  }}
                >
                  <PenLine size={14} />
                </button>
              ) : null}
              <small>{saveStatusLabel}</small>
              <button
                aria-label="에디터 동기화"
                className="refresh-top-button editor-document-sync-button"
                title="최신 상태 동기화"
                type="button"
                onClick={onRefresh}
              >
                <RefreshCw size={14} />
              </button>
            </span>
          </div>
          <div className="menu-row">
            <EditorIconButton
              className="editor-home-button"
              icon={<Home size={16} />}
              label="홈으로 이동"
              onClick={onExitToHome}
            />
            <div className="editor-file-menu-anchor">
              <TopMenuButton
                activeTopMenu={activeTopMenu}
                label="파일"
                menu="file"
                setActiveTopMenu={setActiveTopMenu}
              />
              {activeTopMenu === "file" ? (
                <EditorFileMenu
                  align="start"
                  groups={[
                    ...(canMutateDeck ? [{
                      items: [
                        {
                          id: "import",
                          label: "PPTX 가져오기...",
                          meta: pptxImportMeta,
                          onSelect: onImportPptx,
                        },
                        {
                          id: "save",
                          label: saving ? "저장 중..." : "저장",
                          meta: saveMenuMeta,
                          onSelect: onSave,
                        },
                      ],
                    }] : []),
                    {
                      items: [
                        {
                          disabled: isPptxExporting,
                          id: "export-pptx",
                          label: isPptxExporting
                            ? "PPTX 내보내는 중..."
                            : "PPTX 내보내기...",
                          meta: pptxExportMessage,
                          onSelect: () => onOpenExport("pptx"),
                        },
                        {
                          disabled: isPptxExporting,
                          id: "export-png",
                          label: isPptxExporting
                            ? "PNG ZIP 내보내는 중..."
                            : "PNG ZIP 내보내기...",
                          meta: pptxExportMessage || "모든 장표 PNG",
                          onSelect: () => onOpenExport("png"),
                        },
                      ],
                      label: "내보내기",
                    },
                  ]}
                  subtitle={`프레젠테이션 · ${canvas.width} × ${canvas.height}px`}
                  title={deckTitle}
                  variant="soft-gray"
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="top-actions">
        {projectPresenceUsers.length > 0 ? (
          <button
            aria-label="소켓 접속 상태 보기"
            className="presence-avatar-trigger"
            onClick={onOpenPresenceDebug}
            type="button"
          >
            {projectPresenceUsers.slice(0, 4).map((user) => {
              const avatarUrl = user.userId === currentUser?.userId
                ? currentUserAvatarUrl
                : null;

              return (
                <span
                  className="avatar"
                  key={`${user.id}-${user.connectedAt}`}
                  title={getPresenceUserLabel(user)}
                >
                  {avatarUrl ? (
                    <img
                      alt=""
                      className="presence-avatar-image"
                      src={avatarUrl}
                    />
                  ) : getPresenceUserInitial(user)}
                </span>
              );
            })}
            {projectPresenceUsers.length > 4 ? (
              <span className="avatar presence-avatar-more">
                +{projectPresenceUsers.length - 4}
              </span>
            ) : null}
          </button>
        ) : null}
        {canMutateDeck ? (
          <EditorIconButton
            icon={<Clock aria-hidden="true" size={17} />}
            label="발표 시간 배분"
            onClick={onOpenTargetDuration}
            title="발표 시간 배분"
          />
        ) : null}
        {canMutateDeck ? (
          <EditorSaveControl
            disabled={isDeckLoading || isUsingFallbackDeck}
            emptyStateLabel={
              showLoadedFileLabel ? "불러온 파일" : "저장 기록 없음"
            }
            isSaving={saving}
            lastSavedAtLabel={lastSavedAtLabel}
            onSave={onSave}
            recoveryHint={recoveryHint}
            retrying={saveFailed}
            statusLabel={saveStatusLabel}
          />
        ) : null}
        {/* 에디터 상단에서는 브리프 이동 버튼을 숨긴다.
        <button aria-label="브리프" className="editor-context-top-button" title="브리프" onClick={() => { window.location.href = `/project/${encodeURIComponent(projectId)}/brief`; }} type="button">...</button>
        */}
        <button
          aria-label="버전 기록"
          className="editor-context-top-button editor-version-button"
          title="버전 기록"
          onClick={() => {
            window.location.href = `/project/${encodeURIComponent(projectId)}/history`;
          }}
          type="button"
        >
          <History size={17} />
        </button>
        <PresentationMenu
          activeStartAction={activePresentationAction}
          canOpenAudienceLink={canOpenAudienceLink}
          canStartPresentation={canStartPresentation}
          isSlideRehearsalActive={isSlideRehearsalActive}
          isOpen={activeTopMenu === "presentation"}
          onOpenAudienceLink={onOpenAudienceLink}
          onStartFullRehearsal={onStartFullRehearsal}
          onStartPresentation={onStartPresentation}
          onStartRehearsal={onStartRehearsal}
          onToggle={() =>
            setActiveTopMenu((current) =>
              current === "presentation" ? null : "presentation",
            )
          }
        />
        <div className="top-action-menu editor-share-menu-anchor">
          <EditorIconButton
            aria-expanded={activeTopMenu === "share"}
            aria-haspopup="menu"
            className="share-top-button"
            disabled={!canManageShare || isSharePermissionLoading}
            icon={<Share2 size={17} />}
            label="공유"
            title={
              canManageShare
                ? "프로젝트 공유"
                : "프로젝트 owner만 공유 설정을 변경할 수 있습니다."
            }
            onClick={() => {
              if (!canManageShare) return;
              setActiveTopMenu((current) => current === "share" ? null : "share");
            }}
          />
          {activeTopMenu === "share" ? (
            <EditorFileMenu
              align="end"
              groups={[{
                items: [
                  {
                    id: "community-share",
                    label: "커뮤니티에 공유",
                    meta: "전체 슬라이드 공개",
                    onSelect: () => {
                      setActiveTopMenu(null);
                      onOpenCommunityShare();
                    },
                  },
                  {
                    id: "collaborator-share",
                    label: "공동 작업자에게 공유",
                    meta: "초대 및 권한 관리",
                    onSelect: () => {
                      setActiveTopMenu(null);
                      onOpenShare();
                    },
                  },
                ],
              }]}
              subtitle="공유 방식 선택"
              title={deckTitle}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}

function TopMenuButton(props: {
  activeTopMenu: TopMenu | null;
  label: string;
  menu: TopMenu;
  setActiveTopMenu: (updater: EditorShellUiUpdater<TopMenu | null>) => void;
}) {
  const active = props.activeTopMenu === props.menu;
  return (
    <button
      aria-expanded={active}
      aria-haspopup="menu"
      className={`top-menu-button ${active ? "active" : ""}`}
      type="button"
      onClick={() =>
        props.setActiveTopMenu((current) =>
          current === props.menu ? null : props.menu,
        )
      }
    >
      {props.label} <ChevronDown size={14} />
    </button>
  );
}
