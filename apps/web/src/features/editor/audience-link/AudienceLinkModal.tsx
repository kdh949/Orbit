import type {
  PresentationAccessMode,
  PresentationSession
} from "@orbit/shared";
import { IconShare as Share2, IconX as X } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  closeAudienceAccessSession,
  createAudienceAccessSession,
  fetchCurrentAudienceAccessSession
} from "./audienceLinkApi";
import {
  createQrDataUrl,
  formatAudienceExpiresAt,
  formatAudienceTimeRemaining,
  resolveAbsoluteAudienceUrl,
  toAudienceLinkErrorMessage
} from "./audienceLinkUtils";
import "./audience-link.css";

type AudienceLinkModalProps = {
  deckId: string;
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
};

export function AudienceLinkModal({
  deckId,
  isOpen,
  onClose,
  projectId
}: AudienceLinkModalProps) {
  const [audienceAccessMode, setAudienceAccessMode] =
    useState<PresentationAccessMode>("passcode");
  const [audiencePasscode, setAudiencePasscode] = useState("");
  const [audienceDurationDays, setAudienceDurationDays] = useState(14);
  const [audienceSession, setAudienceSession] =
    useState<PresentationSession | null>(null);
  const [audienceUrl, setAudienceUrl] = useState("");
  const [audienceQrDataUrl, setAudienceQrDataUrl] = useState("");
  const [audienceLinkError, setAudienceLinkError] = useState("");
  const [isAudienceLinkLoading, setIsAudienceLinkLoading] = useState(false);
  const [isAudienceCloseConfirming, setIsAudienceCloseConfirming] =
    useState(false);
  const [audienceNowMs, setAudienceNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setAudienceNowMs(Date.now());
    const timerId = window.setInterval(() => setAudienceNowMs(Date.now()), 60_000);

    return () => window.clearInterval(timerId);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isCancelled = false;
    setAudienceLinkError("");
    setIsAudienceCloseConfirming(false);
    setIsAudienceLinkLoading(true);
    void fetchCurrentAudienceAccessSession(projectId, deckId)
      .then(async (payload) => {
        if (isCancelled) {
          return;
        }

        setAudienceSession(payload.session);
        const nextAudienceUrl = payload.audienceUrl
          ? resolveAbsoluteAudienceUrl(payload.audienceUrl)
          : "";
        setAudienceUrl(nextAudienceUrl);
        setAudienceQrDataUrl(nextAudienceUrl ? await createQrDataUrl(nextAudienceUrl) : "");
      })
      .catch((error) => {
        if (!isCancelled) {
          setAudienceLinkError(toAudienceLinkErrorMessage(error));
          setAudienceSession(null);
          setAudienceUrl("");
          setAudienceQrDataUrl("");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsAudienceLinkLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [deckId, isOpen, projectId]);

  function closeModal() {
    setIsAudienceCloseConfirming(false);
    onClose();
  }

  function updateAudiencePasscode(value: string) {
    setAudiencePasscode(value.replace(/\D/g, "").slice(0, 4));
  }

  async function handleCreateAudienceLink() {
    if (
      (audienceAccessMode === "passcode" && !/^\d{4}$/.test(audiencePasscode)) ||
      isAudienceLinkLoading
    ) {
      setAudienceLinkError("4자리 숫자 비밀번호를 입력해 주세요.");
      return;
    }

    setIsAudienceLinkLoading(true);
    setAudienceLinkError("");

    try {
      const payload = await createAudienceAccessSession({
        accessMode: audienceAccessMode,
        deckId,
        durationDays: audienceDurationDays,
        ...(audienceAccessMode === "passcode"
          ? { passcode: audiencePasscode }
          : {}),
        projectId,
        sessionId: audienceSession?.sessionId
      });
      if (!payload.audienceUrl) {
        throw new Error("청중 링크를 활성화하지 못했습니다.");
      }
      const nextAudienceUrl = resolveAbsoluteAudienceUrl(payload.audienceUrl);
      setAudienceSession(payload.session);
      setAudienceUrl(nextAudienceUrl);
      setAudienceQrDataUrl(await createQrDataUrl(nextAudienceUrl));
      setAudiencePasscode("");
      setIsAudienceCloseConfirming(false);
    } catch (error) {
      setAudienceLinkError(toAudienceLinkErrorMessage(error));
    } finally {
      setIsAudienceLinkLoading(false);
    }
  }

  async function handleCloseAudienceLink() {
    if (!audienceSession || isAudienceLinkLoading) {
      return;
    }

    setIsAudienceLinkLoading(true);
    setAudienceLinkError("");

    try {
      const disabledSession = await closeAudienceAccessSession({
        projectId,
        sessionId: audienceSession.sessionId
      });
      setAudienceSession(disabledSession);
      setAudienceUrl("");
      setAudienceQrDataUrl("");
      setIsAudienceCloseConfirming(false);
    } catch (error) {
      setAudienceLinkError(toAudienceLinkErrorMessage(error));
      setIsAudienceCloseConfirming(false);
    } finally {
      setIsAudienceLinkLoading(false);
    }
  }

  async function handleCopyAudienceUrl() {
    if (!audienceUrl || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(audienceUrl);
  }

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="audience-link-modal-backdrop redesign-dark"
      role="presentation"
      onMouseDown={closeModal}
    >
      <section
        aria-label="청중 링크와 QR"
        aria-modal="true"
        className="audience-link-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>청중 링크/QR</strong>
            <span>현재 덱의 발표 세션과 청중 입장 방식을 설정합니다.</span>
          </div>
          <button
            className="audience-link-close-button"
            type="button"
            aria-label="청중 링크 모달 닫기"
            onClick={closeModal}
          >
            <X size={16} />
          </button>
        </header>
        {audienceSession && audienceUrl ? (
          <section className="audience-link-current">
            <div className="audience-link-status-row">
              <span
                className={`audience-link-status audience-link-status-${audienceSession.status}`}
              >
                {audienceSession.status === "live" ? "입장 열림" : "시작 대기"}
              </span>
              <span>{audienceSession.accessMode === "passcode" ? "비밀번호 필요" : "공개 링크"}</span>
            </div>
            <div className="audience-link-qr-frame">
              {audienceQrDataUrl ? (
                <img alt="청중 입장 QR 코드" src={audienceQrDataUrl} />
              ) : (
                <Share2 size={28} />
              )}
            </div>
            <div className="audience-link-expiry-summary">
              <strong>
                {formatAudienceTimeRemaining(audienceSession.expiresAt, audienceNowMs)}
              </strong>
              <span>만료 {formatAudienceExpiresAt(audienceSession.expiresAt)}</span>
            </div>
            <label className="audience-link-url-field">
              <span>주소 영역</span>
              <input readOnly value={audienceUrl} />
            </label>
            <div className="audience-link-actions">
              <button
                type="button"
                onClick={() => void handleCopyAudienceUrl()}
                disabled={!audienceUrl}
              >
                복사
              </button>
              <button
                className="audience-link-session-close"
                type="button"
                onClick={() => setIsAudienceCloseConfirming(true)}
                disabled={isAudienceLinkLoading || audienceSession.status === "ended"}
              >
                청중 링크 닫기
              </button>
              <button className="audience-link-modal-dismiss" type="button" onClick={closeModal}>
                닫기
              </button>
            </div>
          </section>
        ) : null}
        {isAudienceCloseConfirming ? (
          <div
            className="audience-link-confirm-backdrop"
            role="presentation"
            onMouseDown={() => setIsAudienceCloseConfirming(false)}
          >
            <section
              aria-label="세션 닫기 확인"
              aria-modal="true"
              className="audience-link-confirm-modal"
              role="alertdialog"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <strong>청중 링크를 닫을까요?</strong>
              <p>
                현재 청중 입장 링크와 QR만 비활성화됩니다. 발표자 companion
                세션은 유지됩니다.
              </p>
              <div className="audience-link-confirm-actions">
                <button
                  type="button"
                  onClick={() => setIsAudienceCloseConfirming(false)}
                  disabled={isAudienceLinkLoading}
                >
                  취소
                </button>
                <button
                  className="audience-link-confirm-danger"
                  type="button"
                  onClick={() => void handleCloseAudienceLink()}
                  disabled={isAudienceLinkLoading}
                >
                  {isAudienceLinkLoading ? "닫는 중" : "청중 링크 닫기"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
        {!audienceUrl ? (
          <section className="audience-link-create">
            <label className="audience-expiry-field">
              <span>입장 방식</span>
              <select
                value={audienceAccessMode}
                onChange={(event) =>
                  setAudienceAccessMode(event.target.value as PresentationAccessMode)
                }
              >
                <option value="passcode">4자리 비밀번호</option>
                <option value="public">공개 링크</option>
              </select>
            </label>
            {audienceAccessMode === "passcode" ? (
              <label>
                <span>입장 비밀번호</span>
                <div className="audience-pin-inputs" aria-label="4자리 입장 비밀번호">
                  <input
                    aria-label="4자리 입장 비밀번호"
                    inputMode="numeric"
                    maxLength={4}
                    pattern="[0-9]*"
                    type="text"
                    value={audiencePasscode}
                    onChange={(event) => updateAudiencePasscode(event.target.value)}
                  />
                  {[0, 1, 2, 3].map((index) => (
                    <span key={index} aria-hidden="true">
                      {audiencePasscode[index] ?? ""}
                    </span>
                  ))}
                </div>
              </label>
            ) : null}
            <label className="audience-expiry-field">
              <span>링크 유효기간</span>
              <select
                value={audienceDurationDays}
                onChange={(event) => setAudienceDurationDays(Number(event.target.value))}
              >
                <option value={1}>1일</option>
                <option value={7}>7일</option>
                <option value={14}>14일</option>
                <option value={30}>30일</option>
              </select>
            </label>
            <button
              className="audience-link-primary"
              type="button"
              onClick={() => void handleCreateAudienceLink()}
              disabled={isAudienceLinkLoading}
            >
              {isAudienceLinkLoading ? "처리 중..." : "QR코드 생성"}
            </button>
          </section>
        ) : null}
        {audienceLinkError ? (
          <p className="audience-link-error" role="alert">
            {audienceLinkError}
          </p>
        ) : null}
      </section>
    </div>,
    document.body
  );
}
