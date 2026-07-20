import type { ComponentProps } from "react";
import { createPortal } from "react-dom";

import { AudienceLinkModal } from "../../audience-link/AudienceLinkModal";
import type {
  EditorSessionDebugState,
  EditorSocketStatus,
  ProjectPresenceUser
} from "../hooks/useProjectPresence";
import {
  formatDebugDate,
  formatSessionRemaining,
  formatSocketStatus,
  getPresenceUserInitial,
  getPresenceUserLabel
} from "../hooks/useProjectPresence";
import { EditorExitConfirmModal } from "./EditorExitConfirmModal";
import { DeckExportDialog } from "./DeckExportDialog";
import { ShareAccessModal } from "./ShareAccessModal";
import { TargetDurationDialog } from "./TargetDurationDialog";

export function EditorModals(props: {
  audienceLink: {
    deckId: string;
    isOpen: boolean;
    onClose: () => void;
    projectId: string;
  };
  exitConfirm: {
    isOpen: boolean;
    modalProps: ComponentProps<typeof EditorExitConfirmModal>;
  };
  exportDialog: ComponentProps<typeof DeckExportDialog>;
  presence: {
    isOpen: boolean;
    lastPresenceAt: string | null;
    onClose: () => void;
    projectId: string;
    sessionDebug: EditorSessionDebugState;
    socketErrorMessage: string;
    socketId: string;
    socketStatus: EditorSocketStatus;
    users: ProjectPresenceUser[];
  };
  share: {
    isOpen: boolean;
    modalProps: ComponentProps<typeof ShareAccessModal>;
  };
  targetDuration: {
    isOpen: boolean;
    modalProps: ComponentProps<typeof TargetDurationDialog>;
  };
}) {
  return (
    <>
      {props.share.isOpen
        ? createPortal(<ShareAccessModal {...props.share.modalProps} />, document.body)
        : null}
      <AudienceLinkModal {...props.audienceLink} />
      {props.exitConfirm.isOpen
        ? createPortal(
            <EditorExitConfirmModal {...props.exitConfirm.modalProps} />,
            document.body
          )
        : null}
      {props.exportDialog.open
        ? createPortal(<DeckExportDialog {...props.exportDialog} />, document.body)
        : null}
      {props.targetDuration.isOpen
        ? createPortal(
            <TargetDurationDialog {...props.targetDuration.modalProps} />,
            document.body
          )
        : null}
      {props.presence.isOpen
        ? createPortal(
            <div
              className="presence-debug-backdrop"
              role="presentation"
              onMouseDown={props.presence.onClose}
            >
              <section
                aria-label="소켓 접속 상태"
                aria-modal="true"
                className="presence-debug-modal"
                role="dialog"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header>
                  <div>
                    <strong>소켓 접속 상태</strong>
                    <span>프로젝트 presence 테스트 데이터입니다.</span>
                  </div>
                  <button type="button" aria-label="소켓 상태 닫기" onClick={props.presence.onClose}>닫기</button>
                </header>
                <div className="presence-debug-grid">
                  <span>상태</span><strong>{formatSocketStatus(props.presence.socketStatus)}</strong>
                  <span>Socket ID</span><strong>{props.presence.socketId || "-"}</strong>
                  <span>프로젝트</span><strong>{props.presence.projectId}</strong>
                  <span>접속자</span><strong>{props.presence.users.length}명</strong>
                  <span>마지막 presence</span>
                  <strong>{props.presence.lastPresenceAt ? formatDebugDate(props.presence.lastPresenceAt) : "-"}</strong>
                  <span>세션 남은 시간</span><strong>{formatSessionRemaining(props.presence.sessionDebug)}</strong>
                </div>
                {props.presence.socketErrorMessage ? (
                  <p className="presence-debug-error">{props.presence.socketErrorMessage}</p>
                ) : null}
                <div className="presence-debug-users">
                  {props.presence.users.length > 0 ? (
                    props.presence.users.map((user) => (
                      <div key={`${user.id}-${user.connectedAt}`}>
                        <span className="avatar">{getPresenceUserInitial(user)}</span>
                        <div>
                          <strong>{getPresenceUserLabel(user)}</strong>
                          <small>{formatDebugDate(user.connectedAt)}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>현재 표시할 접속자가 없습니다.</p>
                  )}
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
