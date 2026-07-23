import type {
  DeckExportFormat,
  DeckExportRequest,
  PresentationSession
} from "@orbit/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { OrbitButton, OrbitDialog } from "../../../../components/ui";
import { activityApi } from "../../../activity-slides/api/activityApi";
import { activityQueryKeys } from "../../../activity-slides/model/activityQueryKeys";

export function DeckExportDialog(props: {
  deckId: string;
  errorMessage: string;
  initialFormat: DeckExportFormat;
  onClose: () => void;
  onExport: (input: DeckExportRequest) => Promise<boolean>;
  open: boolean;
  pending: boolean;
  pptxDisabledReason?: string;
  projectId: string;
  statusMessage: string;
}) {
  const [format, setFormat] = useState<DeckExportFormat>(() =>
    resolveAvailableExportFormat(props.initialFormat, props.pptxDisabledReason)
  );
  const [presentationSessionId, setPresentationSessionId] = useState("");
  const sessions = useQuery({
    enabled: props.open,
    queryKey: activityQueryKeys.sessionList(props.projectId, props.deckId),
    queryFn: () => activityApi.listSessions(props.projectId, props.deckId),
    staleTime: 15_000
  });

  useEffect(() => {
    if (!props.open) return;
    setFormat(
      resolveAvailableExportFormat(
        props.initialFormat,
        props.pptxDisabledReason
      )
    );
    setPresentationSessionId("");
  }, [props.initialFormat, props.open, props.pptxDisabledReason]);

  if (!props.open) return null;

  const submit = async () => {
    if (props.pending) return;
    const succeeded = await props.onExport(
      createDeckExportRequest(format, presentationSessionId)
    );
    if (succeeded) props.onClose();
  };

  return (
    <OrbitDialog
      className="orbit-deck-export-dialog"
      description="파일 형식과 포함할 발표 세션 결과를 선택합니다."
      footer={(
        <>
          <OrbitButton disabled={props.pending} onClick={props.onClose} variant="secondary">
            취소
          </OrbitButton>
          <OrbitButton
            disabled={
              props.pending ||
              (format === "pptx" && Boolean(props.pptxDisabledReason))
            }
            onClick={() => void submit()}
          >
            {props.pending ? "내보내는 중..." : "내보내기"}
          </OrbitButton>
        </>
      )}
      onClose={props.onClose}
      open
      title="프레젠테이션 내보내기"
    >
      <fieldset className="deck-export-format-options">
        <legend>파일 형식</legend>
        <label>
          <input
            checked={format === "pptx"}
            disabled={Boolean(props.pptxDisabledReason)}
            name="deck-export-format"
            onChange={() => setFormat("pptx")}
            type="radio"
            value="pptx"
          />
          <span><strong>PPTX</strong><small>PowerPoint 프레젠테이션</small></span>
        </label>
        {props.pptxDisabledReason ? (
          <p className="deck-export-dialog-message" role="status">
            {props.pptxDisabledReason}
          </p>
        ) : null}
        <label>
          <input
            checked={format === "png"}
            name="deck-export-format"
            onChange={() => setFormat("png")}
            type="radio"
            value="png"
          />
          <span><strong>PNG ZIP</strong><small>모든 장표를 PNG로 묶은 ZIP</small></span>
        </label>
      </fieldset>

      <label className="deck-export-session-field">
        <span>발표 세션 결과</span>
        <select
          aria-label="내보낼 발표 세션"
          disabled={sessions.isLoading || props.pending}
          onChange={(event) => setPresentationSessionId(event.currentTarget.value)}
          value={presentationSessionId}
        >
          <option value="">포함하지 않음</option>
          {(sessions.data?.sessions ?? []).map((session) => (
            <option key={session.sessionId} value={session.sessionId}>
              {sessionExportOptionLabel(session)}
            </option>
          ))}
        </select>
        <small>선택하지 않으면 연결 결과 장표에 세션 결과를 포함하지 않습니다.</small>
      </label>

      {sessions.isError ? (
        <p className="deck-export-dialog-message" role="alert">
          발표 세션 목록을 불러오지 못했습니다. 세션 결과 없이 내보낼 수 있습니다.
        </p>
      ) : null}
      {props.errorMessage ? (
        <p className="deck-export-dialog-message is-error" role="alert">
          {props.errorMessage}
        </p>
      ) : props.statusMessage ? (
        <p className="deck-export-dialog-message" role="status">
          {props.statusMessage}
        </p>
      ) : null}
    </OrbitDialog>
  );
}

function resolveAvailableExportFormat(
  initialFormat: DeckExportFormat,
  pptxDisabledReason: string | undefined
): DeckExportFormat {
  return initialFormat === "pptx" && pptxDisabledReason
    ? "png"
    : initialFormat;
}

export function createDeckExportRequest(
  format: DeckExportFormat,
  presentationSessionId: string
): DeckExportRequest {
  return {
    format,
    ...(presentationSessionId ? { presentationSessionId } : {})
  };
}

export function sessionExportOptionLabel(
  session: Pick<PresentationSession, "createdAt" | "sessionId" | "status">
): string {
  const date = new Date(session.createdAt).toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit"
  });
  const status =
    session.status === "live"
      ? "진행 중"
      : session.status === "ended"
        ? "종료"
        : "예약";
  return `${date} · ${status} · ${session.sessionId.slice(-8)}`;
}
