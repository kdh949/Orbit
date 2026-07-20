import type { Deck, DeckExportFormat } from "@orbit/shared";
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
  isSharePanelOpen: boolean;
  isSharePermissionLoading: boolean;
  isSlideRehearsalActive: boolean;
  isUsingFallbackDeck: boolean;
  lastSavedAtLabel: string | null;
  ooxmlSyncStatus: {
    detail: string;
    kind: string;
    label: string;
    retryable: boolean;
  } | null;
  onExitToHome: () => void;
  onOpenExport: (format: DeckExportFormat) => void;
  onImportPptx: () => void;
  onOpenAudienceLink: () => void;
  onOpenShare: () => void;
  onOpenTargetDuration: () => void;
  onRefresh: () => void;
  onRenameDeckTitle: (title: string) => void;
  onRetryOoxmlSync: () => void;
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
    isSharePanelOpen,
    isSharePermissionLoading,
    isSlideRehearsalActive,
    isUsingFallbackDeck,
    lastSavedAtLabel,
    ooxmlSyncStatus,
    onExitToHome,
    onOpenExport,
    onImportPptx,
    onOpenAudienceLink,
    onOpenShare,
    onOpenTargetDuration,
    onRefresh,
    onRenameDeckTitle,
    onRetryOoxmlSync,
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
          <div
            aria-label="소켓 접속 상태 보기"
            className="presence-avatar-trigger"
          >
            {projectPresenceUsers.slice(0, 4).map((user) => (
              <span
                className="avatar"
                key={`${user.id}-${user.connectedAt}`}
                title={getPresenceUserLabel(user)}
              >
                {getPresenceUserInitial(user)}
              </span>
            ))}
            {projectPresenceUsers.length > 4 ? (
              <span className="avatar presence-avatar-more">
                +{projectPresenceUsers.length - 4}
              </span>
            ) : null}
          </div>
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
        {ooxmlSyncStatus ? (
          <button
            className={`ooxml-sync-pill ${ooxmlSyncStatus.kind}`}
            disabled={!ooxmlSyncStatus.retryable}
            onClick={onRetryOoxmlSync}
            title={ooxmlSyncStatus.detail}
            type="button"
          >
            {ooxmlSyncStatus.label}
          </button>
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
        <EditorIconButton
          aria-expanded={isSharePanelOpen}
          aria-haspopup="dialog"
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
            onOpenShare();
            setActiveTopMenu(null);
          }}
        />
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
