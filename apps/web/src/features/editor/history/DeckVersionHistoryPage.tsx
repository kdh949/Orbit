import type { DeckSnapshot, DeckSnapshotDetail, DeckSnapshotReason } from "@orbit/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconClock,
  IconFileText,
  IconHistory,
  IconRefresh,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  OrbitButton,
  OrbitDialog,
  OrbitStatus,
  type OrbitStatusTone,
} from "../../../components/ui";
import { fetchProjectDeck } from "../../rehearsal/keywords/keywordEditorApi";
import { ReadOnlySlideCanvas } from "../../slides/rendering";
import { fetchDeckSnapshot, fetchDeckSnapshots, restoreDeckSnapshot } from "./deckSnapshotApi";
import "./deck-version-history.css";

const reasonLabels: Record<DeckSnapshotReason, string> = {
  "patch-applied": "편집 내용 저장",
  "deck-replaced": "덱 전체 교체",
  "auto-save": "자동 저장",
  "snapshot-restore": "이전 버전 복원",
};

export function DeckVersionHistoryPage(props: { projectId: string }) {
  const queryClient = useQueryClient();
  const snapshotsQuery = useQuery({
    queryKey: ["deck-snapshots", props.projectId],
    queryFn: () => fetchDeckSnapshots(props.projectId),
    retry: false,
  });
  const deckQuery = useQuery({
    queryKey: ["deck-history-preview", props.projectId],
    queryFn: () => fetchProjectDeck(props.projectId),
    retry: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoredVersion, setRestoredVersion] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedId && snapshotsQuery.data?.[0]) {
      setSelectedId(snapshotsQuery.data[0].snapshotId);
    }
  }, [selectedId, snapshotsQuery.data]);

  const selected = useMemo(
    () => snapshotsQuery.data?.find((item) => item.snapshotId === selectedId) ?? snapshotsQuery.data?.[0],
    [selectedId, snapshotsQuery.data],
  );
  const selectedSnapshotId = selected?.snapshotId;
  const snapshotQuery = useQuery({
    queryKey: ["deck-snapshot", props.projectId, selectedSnapshotId],
    queryFn: () => {
      if (!selectedSnapshotId) throw new Error("선택한 버전이 없습니다.");
      return fetchDeckSnapshot(props.projectId, selectedSnapshotId);
    },
    enabled: Boolean(selectedSnapshotId),
    retry: false,
  });

  async function restoreSelected() {
    if (!selected) return;
    setRestoring(true);
    setError("");
    try {
      const result = await restoreDeckSnapshot(props.projectId, selected.snapshotId);
      setRestoredVersion(result.restoredSnapshot.version);
      setConfirming(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["deck", props.projectId] }),
        queryClient.invalidateQueries({ queryKey: ["deck-history-preview", props.projectId] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        snapshotsQuery.refetch(),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "선택한 버전을 복원하지 못했습니다.");
    } finally {
      setRestoring(false);
    }
  }

  if (snapshotsQuery.isLoading || deckQuery.isLoading) {
    return <HistoryState title="버전 기록을 불러오고 있어요." />;
  }
  if (snapshotsQuery.isError || deckQuery.isError) {
    return <HistoryState error title="버전 기록을 불러오지 못했어요." />;
  }

  const currentDeck = deckQuery.data?.deck;
  const snapshots = snapshotsQuery.data ?? [];
  const currentVersion = currentDeck?.version;

  return (
    <div className="redesign-page deck-history-page">
      <div className="deck-history-breadcrumb">
        <a href={`/project/${encodeURIComponent(props.projectId)}`}>
          <IconArrowLeft aria-hidden="true" size={17} /> 에디터
        </a>
        <span>/</span>
        <strong>버전 기록</strong>
      </div>

      <section className="deck-history-heading">
        <div>
          <p className="redesign-eyebrow">Version history</p>
          <h1>이전 작업을 확인하고 안전하게 복원하세요.</h1>
          <p>자동 저장과 주요 변경 시점의 덱 버전을 비교합니다.</p>
        </div>
        <OrbitStatus tone={restoredVersion ? "success" : "neutral"}>
          {restoredVersion ? `버전 ${restoredVersion} 복원됨` : `현재 버전 ${currentDeck?.version ?? "-"}`}
        </OrbitStatus>
      </section>

      {error ? <p className="deck-history-error" role="alert">{error}</p> : null}
      <div className="deck-history-layout">
        <aside className="deck-history-list">
          <header>
            <div><h2>저장 기록</h2><span>{snapshots.length}개 버전</span></div>
            <button aria-label="새로고침" onClick={() => void snapshotsQuery.refetch()} type="button"><IconRefresh size={18} /></button>
          </header>
          {snapshots.length ? snapshots.map((snapshot) => (
            <button
              aria-pressed={snapshot.snapshotId === selected?.snapshotId}
              key={snapshot.snapshotId}
              onClick={() => { setSelectedId(snapshot.snapshotId); setRestoredVersion(null); }}
              type="button"
            >
              <span><IconClock aria-hidden="true" size={18} /></span>
              <div><small>{formatSnapshotDate(snapshot.createdAt)}</small><strong>버전 {snapshot.version} · {reasonLabels[snapshot.reason]}</strong></div>
              <OrbitStatus tone={snapshotTone(snapshot, currentVersion)}>{snapshotLabel(snapshot, currentVersion)}</OrbitStatus>
            </button>
          )) : <div className="deck-history-empty"><IconHistory size={28} /><strong>아직 저장된 버전이 없어요.</strong><span>편집 내용을 저장하면 이곳에 복원 지점이 생깁니다.</span></div>}
        </aside>

        <section className="deck-history-preview">
          {selected ? (
            <>
              <header>
                <div><small>선택한 복원 지점</small><h2>버전 {selected.version} · {reasonLabels[selected.reason]}</h2></div>
                <OrbitButton disabled={restoring || selected.version === currentVersion} icon={<IconRefresh size={18} />} onClick={() => setConfirming(true)}>
                  {selected.version === currentVersion ? "현재 버전" : "이 버전 복원"}
                </OrbitButton>
              </header>
              <div className="deck-history-version-card">
                {snapshotQuery.isLoading ? (
                  <div className="deck-history-preview-state" role="status">버전 미리보기를 불러오는 중이에요.</div>
                ) : snapshotQuery.isError ? (
                  <div className="deck-history-preview-state" role="alert">
                    <span>선택한 버전을 불러오지 못했어요.</span>
                    <OrbitButton onClick={() => void snapshotQuery.refetch()} size="compact" variant="secondary">다시 시도</OrbitButton>
                  </div>
                ) : snapshotQuery.data ? (
                  <DeckSnapshotCanvasPreview snapshot={snapshotQuery.data} />
                ) : null}
                <dl>
                  <div><dt>변경 유형</dt><dd>{reasonLabels[selected.reason]}</dd></div>
                  <div><dt>저장 시각</dt><dd>{formatSnapshotDate(selected.createdAt)}</dd></div>
                  <div><dt>덱 ID</dt><dd>{selected.deckId}</dd></div>
                </dl>
              </div>
              <footer><IconFileText aria-hidden="true" size={17} /><span>서버는 과거 버전의 메타데이터만 노출합니다. 복원하면 현재 작업은 유지된 채 선택한 버전이 에디터의 현재 덱이 됩니다.</span></footer>
            </>
          ) : <div className="deck-history-empty"><IconHistory size={28} /><strong>확인할 버전을 선택하세요.</strong></div>}
        </section>
      </div>

      <OrbitDialog
        description={selected ? `버전 ${selected.version}의 내용으로 현재 덱을 복원합니다.` : undefined}
        footer={<><OrbitButton onClick={() => setConfirming(false)} variant="secondary">취소</OrbitButton><OrbitButton disabled={restoring} onClick={() => void restoreSelected()}>{restoring ? "복원 중" : "복원하기"}</OrbitButton></>}
        onClose={() => setConfirming(false)}
        open={confirming}
        title="이 버전을 복원할까요?"
      >
        <p className="deck-history-dialog-note">현재 작업은 사라지지 않고 복원 직전 상태로 보존됩니다.</p>
      </OrbitDialog>
    </div>
  );
}

function DeckSnapshotCanvasPreview(props: { snapshot: DeckSnapshotDetail }) {
  const shell = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  const { deck } = props.snapshot;
  const slide = deck.slides[0];

  useEffect(() => {
    const target = shell.current;
    if (!target || !slide) return;

    const update = () => {
      if (target.clientWidth <= 0) return;
      setScale(target.clientWidth / deck.canvas.width);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => observer.disconnect();
  }, [deck, slide]);

  if (!slide) {
    return <div className="deck-history-preview-state">이 버전에는 표시할 슬라이드가 없습니다.</div>;
  }

  return (
    <div
      aria-label={`버전 ${props.snapshot.version} 첫 슬라이드 미리보기`}
      className="deck-history-slide-preview"
      ref={shell}
      style={{ aspectRatio: `${deck.canvas.width} / ${deck.canvas.height}` }}
    >
      {scale > 0 ? (
        <ReadOnlySlideCanvas deck={deck} scale={scale} slide={slide} />
      ) : null}
    </div>
  );
}

function HistoryState(props: { error?: boolean; title: string }) {
  return <div className="redesign-page deck-history-page"><section className="deck-history-state" role={props.error ? "alert" : "status"}><IconHistory size={30} /><h1>{props.title}</h1><a href="/project">프로젝트로 돌아가기</a></section></div>;
}

export function snapshotTone(snapshot: DeckSnapshot, currentVersion?: number): OrbitStatusTone {
  if (snapshot.version === currentVersion) return "lilac";
  if (snapshot.reason === "snapshot-restore") return "warning";
  return "neutral";
}

export function snapshotLabel(snapshot: DeckSnapshot, currentVersion?: number) {
  if (snapshot.version === currentVersion) return "현재 버전";
  if (snapshot.reason === "snapshot-restore") return "복원 지점";
  return "자동 저장";
}

function formatSnapshotDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
