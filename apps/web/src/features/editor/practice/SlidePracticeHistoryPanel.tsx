import { type Deck, type Slide } from "@orbit/shared/deck";
import {
  slideQuestionGuideTextHashInput,
  type SlidePracticeReportRecord,
} from "@orbit/shared/slide-practice";
import { useEffect, useRef, useState } from "react";

import { PracticeResult } from "./SlidePracticePanel";
import { PracticeTrendDashboard } from "./PracticeTrendDashboard";
import { practiceCelebrationAnimationSession } from "./practiceCelebration";
import { listSlidePracticeReports } from "./slidePracticeApi";
import { sha256Canonical } from "./slideQuestionGuideApi";

export function SlidePracticeHistoryPanel(props: {
  celebrationSessionId: string | null;
  projectId: string;
  deck: Deck;
  slide: Slide | null;
  refreshToken: number;
  onCelebrationConsumed: (sessionId: string) => void;
}) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retryToken, setRetryToken] = useState(0);
  const [slideContentHash, setSlideContentHash] = useState<string | null>(null);
  const [comparableReports, setComparableReports] = useState<SlidePracticeReportRecord[]>([]);
  const [latestReport, setLatestReport] = useState<SlidePracticeReportRecord | null>(null);
  const [animationSessionId, setAnimationSessionId] = useState<string | null>(null);
  const consumedCelebrationRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setState("loading");
    if (!props.slide) {
      setSlideContentHash(null);
      setComparableReports([]);
      setLatestReport(null);
      setAnimationSessionId(null);
      setState("ready");
      return () => { active = false; };
    }
    void sha256Canonical(slideQuestionGuideTextHashInput(props.slide)).then(async (hash) => {
      const [comparable, latest] = await Promise.all([
        listSlidePracticeReports({
          projectId: props.projectId,
          deckId: props.deck.deckId,
          slideId: props.slide?.slideId,
          slideContentHash: hash,
          limit: 5,
        }),
        listSlidePracticeReports({
          projectId: props.projectId,
          deckId: props.deck.deckId,
          slideId: props.slide?.slideId,
          limit: 1,
        }),
      ]);
      if (!active) return;
      setSlideContentHash(hash);
      setComparableReports(comparable.reports);
      const latestReport = latest.reports[0] ?? null;
      setLatestReport(latestReport);
      const nextAnimationSessionId = practiceCelebrationAnimationSession({
        consumedSessionId: consumedCelebrationRef.current,
        latestSessionId: latestReport?.practiceSessionId ?? null,
        triggerSessionId: props.celebrationSessionId,
      });
      setAnimationSessionId(nextAnimationSessionId);
      if (nextAnimationSessionId) {
        consumedCelebrationRef.current = nextAnimationSessionId;
        props.onCelebrationConsumed(nextAnimationSessionId);
      }
      setState("ready");
    }).catch(() => {
      if (active) setState("error");
    });
    return () => { active = false; };
  }, [
    props.deck.deckId,
    props.projectId,
    props.refreshToken,
    props.slide,
    retryToken,
  ]);

  if (state === "loading") return <p className="editor-dock-empty">연습 기록을 불러오는 중…</p>;
  if (state === "error") return (
    <div className="editor-dock-empty editor-practice-history-error" role="alert">
      <p>연습 기록을 불러오지 못했습니다.</p>
      <button type="button" onClick={() => setRetryToken((current) => current + 1)}>다시 시도</button>
    </div>
  );
  if (!props.slide) return <p className="editor-dock-empty">연습할 슬라이드를 선택해 주세요.</p>;
  if (!slideContentHash) return <p className="editor-dock-empty">슬라이드 비교 기준을 만들지 못했습니다.</p>;
  return (
    <PracticeHistoryContent
      animationSessionId={animationSessionId}
      comparableReports={comparableReports}
      latestReport={latestReport}
      slideContentHash={slideContentHash}
    />
  );
}

export function PracticeHistoryContent(props: {
  animationSessionId?: string | null;
  comparableReports: readonly SlidePracticeReportRecord[];
  latestReport: SlidePracticeReportRecord | null;
  slideContentHash: string;
}) {
  const latestReport = props.latestReport;
  const latestIsComparable = latestReport?.reportVersion === 3
    && latestReport.metricDefinitionVersion === 3
    && latestReport.slideContentHash === props.slideContentHash;

  return (
    <div className="editor-practice-history">
      <PracticeTrendDashboard
        animationSessionId={props.animationSessionId}
        reports={props.comparableReports}
        slideContentHash={props.slideContentHash}
      />
      {latestReport ? (
        <details className="editor-practice-current-detail">
          <summary>
            <span>이번 회차 상세</span>
            <time dateTime={latestReport.createdAt}>{new Date(latestReport.createdAt).toLocaleString("ko-KR")}</time>
          </summary>
          {!latestIsComparable ? (
            <p className="editor-practice-legacy-notice">이전 슬라이드 내용으로 연습한 기록</p>
          ) : null}
          <section aria-label="최근 연습 결과" className="editor-practice-history-detail latest">
            <PracticeResult report={latestReport} />
          </section>
        </details>
      ) : null}
    </div>
  );
}
