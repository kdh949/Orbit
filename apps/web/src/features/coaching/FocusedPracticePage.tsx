import type {
  FocusedPracticeAttempt,
  FocusedPracticeTargetScope,
  PracticePlanResponse,
} from "@orbit/shared/coaching";
import type { Deck } from "@orbit/shared/deck";
import {
  IconArrowLeft,
  IconArrowRight,
  IconMicrophone,
  IconRefresh,
  IconSquare,
} from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { OrbitButton, OrbitStatus } from "../../components/ui";
import { fetchProjectDeck } from "../rehearsal/keywords/keywordEditorApi";
import { fetchPracticePlan } from "./practicePlanApi";
import { completeFocusedSession, createFocusedSession, getFocusedSession, submitFocusedAudio } from "./focusedPracticeApi";
import {
  buildFocusedPracticeTimeline,
  resolveFocusedPracticeDurationGuidance,
  resolveFocusedPracticeSentence,
  resolveFocusedPracticeSlideIds,
  type FocusedPracticeRangeTransition,
} from "./focusedPracticeTarget";
import { useFocusedPracticeAudio, type FocusedPracticeCapture } from "./useFocusedPracticeAudio";
import "./focused-practice.css";

const FocusedSlidePreview = lazy(() => import("./FocusedSlidePreview"));

export function FocusedPracticePage(props: {
  goalId: string;
  preview?: { attempts: FocusedPracticeAttempt[]; deck: Deck; plan: Extract<PracticePlanResponse, { status: "ready" }>; stabilized?: boolean };
  projectId: string;
  sourceFullRunId: string;
}) {
  const sessionStorageKey = `orbit.focused.${props.goalId}`;
  const requestStorageKey = `${sessionStorageKey}.request`;
  const [plan, setPlan] = useState<Extract<PracticePlanResponse, { status: "ready" }> | null>(props.preview?.plan ?? null);
  const [deck, setDeck] = useState<Deck | null>(props.preview?.deck ?? null);
  const [sessionId, setSessionId] = useState(() => props.preview ? "preview-session" : sessionStorage.getItem(sessionStorageKey));
  const [attempts, setAttempts] = useState<FocusedPracticeAttempt[]>(props.preview?.attempts ?? []); const [stabilized, setStabilized] = useState(props.preview?.stabilized ?? false);
  const [status, setStatus] = useState(props.preview ? "연습 가능" : "준비 중"); const [error, setError] = useState("");
  const [compatibilityState, setCompatibilityState] = useState<"current" | "stale">("current");
  const [rangeSlideIndex, setRangeSlideIndex] = useState(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  const rangeTransitionsRef = useRef<FocusedPracticeRangeTransition[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(props.preview ? "ready" : "loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const audio = useFocusedPracticeAudio();

  useEffect(() => { if (props.preview) return; void (async () => {
    try {
      setLoadState("loading"); setError(""); setStatus("준비 중");
      const nextPlan = await fetchPracticePlan(props.projectId, props.sourceFullRunId);
      if (nextPlan.status !== "ready") throw new Error("연습 계획이 준비되지 않았습니다.");
      setPlan(nextPlan);
      void fetchProjectDeck(props.projectId).then((response) => setDeck(response.deck)).catch(() => undefined);
      let id = sessionId;
      if (!id) {
        let requestId = sessionStorage.getItem(requestStorageKey);
        if (!requestId) { requestId = crypto.randomUUID(); sessionStorage.setItem(requestStorageKey, requestId); }
        const session = await createFocusedSession(props.projectId, nextPlan, props.goalId, requestId);
        id = session.practiceSessionId; sessionStorage.setItem(sessionStorageKey, id); setSessionId(id);
      }
      const current = await getFocusedSession(id);
      const isStale = current.session.compatibilityState === "stale";
      setAttempts(current.attempts);
      setStabilized(current.stabilization.find((item) => item.goalId === props.goalId)?.stabilized ?? false);
      setCompatibilityState(current.session.compatibilityState);
      setStatus(isStale ? "연습 대상 변경됨" : "연습 가능");
      setError(isStale ? "발표 자료가 바뀌어 이 연습 목표는 오래된 상태입니다. 새 전체 리허설에서 목표를 다시 만들어 주세요." : "");
      setLoadState("ready");
    } catch (cause) { sessionStorage.removeItem(sessionStorageKey); setSessionId(null); setError(cause instanceof Error ? cause.message : "부분 연습을 준비하지 못했습니다."); setLoadState("error"); }
  })(); }, [props.goalId, props.projectId, props.sourceFullRunId, reloadKey]);
  const goal = plan?.goals.find((item) => item.goalId === props.goalId);
  const targetScope = goal?.targetScope ?? null;
  const resolvedSlideIds = deck && targetScope ? resolveFocusedPracticeSlideIds(deck, targetScope) : [];
  const activeSlideId = targetScope?.type === "slide-range"
    ? resolvedSlideIds[rangeSlideIndex]
    : resolvedSlideIds[0];
  const activeSlide = deck?.slides.find((slide) => slide.slideId === activeSlideId);
  const practiceTranscript = deck && targetScope && activeSlide
    ? targetScope.type === "sentence"
      ? resolveFocusedPracticeSentence(deck, targetScope)
      : activeSlide.speakerNotes.trim()
    : null;
  const processing = attempts.some((attempt) => ["uploading", "queued", "processing"].includes(attempt.status));
  const durationGuidance = deck && targetScope
    ? resolveFocusedPracticeDurationGuidance(deck, targetScope)
    : null;

  async function submitCapture(capture: FocusedPracticeCapture) {
    setElapsedSeconds(Math.max(0, Math.round(capture.durationMs / 1000)));
    if (!targetScope) throw new Error("부분 연습 범위가 없습니다.");
    if (targetScope.type === "slide-range" && rangeTransitionsRef.current.length !== resolvedSlideIds.length) {
      throw new Error("모든 연속 장표로 전환한 뒤 녹음을 끝내 주세요.");
    }
    setStatus("업로드 중");
    const timeline = buildFocusedPracticeTimeline(
      targetScope,
      resolvedSlideIds,
      capture.durationMs,
      rangeTransitionsRef.current,
    );
    await submitFocusedAudio(sessionId!, capture.blob, capture.durationMs, timeline); setStatus("분석 중");
    const poll = window.setInterval(() => { void getFocusedSession(sessionId!).then((value) => {
      setAttempts(value.attempts); setCompatibilityState(value.session.compatibilityState);
      if (value.session.compatibilityState === "stale") {
        window.clearInterval(poll); setStatus("연습 대상 변경됨");
        setError("발표 자료가 바뀌어 이 연습 목표는 오래된 상태입니다. 새 전체 리허설에서 목표를 다시 만들어 주세요.");
        return;
      }
      const active = value.attempts.at(-1);
      if (active && ["succeeded", "failed", "cancelled"].includes(active.status)) { window.clearInterval(poll); setStatus("다시 연습 가능"); setStabilized(value.stabilization.find((item) => item.goalId === props.goalId)?.stabilized ?? false); }
    }).catch((cause: unknown) => { window.clearInterval(poll); setError(cause instanceof Error ? cause.message : "분석 상태를 불러오지 못했습니다."); }); }, 1000);
  }

  useEffect(() => {
    if (!audio.automaticCapture || !sessionId || !goal) return;
    const capture = audio.automaticCapture;
    audio.clearAutomaticCapture();
    setStatus("5분 제한으로 녹음을 끝냈습니다.");
    void submitCapture(capture).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "녹음을 처리하지 못했습니다.");
      setStatus("다시 시도");
    });
  }, [audio.automaticCapture, goal, sessionId]);

  async function toggleRecording() {
    try {
      if (props.preview) {
        if (status !== "녹음 중") { prepareRecordingTarget(); setStatus("녹음 중"); return; }
        setAttempts((current) => [...current, {
          attemptId: `preview-attempt-${current.length + 1}`,
          attemptNumber: current.length + 1,
          status: "succeeded",
          result: current.length ? "passed" : "needs-retry",
          durationMs: 16_000,
        } as FocusedPracticeAttempt]);
        setStatus("다시 연습 가능");
        return;
      }
      if (!audio.recording) { await audio.start(); prepareRecordingTarget(); setStatus("녹음 중"); return; }
      const capture = await audio.stop();
      await submitCapture(capture);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "녹음을 처리하지 못했습니다."); setStatus("다시 시도"); }
  }

  function prepareRecordingTarget() {
    setElapsedSeconds(0);
    setRangeSlideIndex(0);
    recordingStartedAtRef.current = performance.now();
    rangeTransitionsRef.current = targetScope?.type === "slide-range" && resolvedSlideIds[0]
      ? [{ slideId: resolvedSlideIds[0], enteredAtMs: 0 }]
      : [];
  }

  function advanceRangeSlide() {
    if (targetScope?.type !== "slide-range" || recordingStartedAtRef.current === null) return;
    const nextSlideId = resolvedSlideIds[rangeSlideIndex + 1];
    if (!nextSlideId) return;
    rangeTransitionsRef.current.push({
      slideId: nextSlideId,
      enteredAtMs: Math.max(0, Math.round(performance.now() - recordingStartedAtRef.current)),
    });
    setRangeSlideIndex((index) => index + 1);
  }

  const isRecording = props.preview ? status === "녹음 중" : audio.recording;
  const rangeIncomplete = isRecording && targetScope?.type === "slide-range" && rangeSlideIndex < resolvedSlideIds.length - 1;

  useEffect(() => {
    if (!isRecording || recordingStartedAtRef.current === null) return;
    const update = () => setElapsedSeconds(Math.max(
      0,
      Math.floor((performance.now() - recordingStartedAtRef.current!) / 1000),
    ));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  if (loadState === "error") {
    return <div className="redesign-page focused-practice-page"><section className="focused-practice-shell"><p className="redesign-eyebrow">집중 연습</p><h1>집중 연습을 준비하지 못했습니다.</h1><p className="focused-practice-error" role="alert">{error}</p><footer><OrbitButton onClick={() => setReloadKey((value) => value + 1)} icon={<IconRefresh size={18} />}>다시 시도</OrbitButton><a href={`/rehearsal/${encodeURIComponent(props.projectId)}/plan/${encodeURIComponent(props.sourceFullRunId)}`}>연습 계획으로 돌아가기</a></footer></section></div>;
  }

  return <div className="redesign-page focused-practice-page">
    <div className="focused-practice-breadcrumb"><a href={`/rehearsal/${encodeURIComponent(props.projectId)}/plan/${encodeURIComponent(props.sourceFullRunId)}`}><IconArrowLeft size={17} /> 연습 계획</a><span>/</span><strong>집중 연습</strong></div>
    <section className="focused-practice-shell">
      <header><div><p className="redesign-eyebrow">집중 연습</p><h1>한 구간만 짧게 반복하세요.</h1></div><OrbitStatus tone={stabilized ? "success" : "lilac"}>{stabilized ? "연습에서 안정화됨" : status}</OrbitStatus></header>
      {error ? <p role="alert" className="focused-practice-error">{error}</p> : null}
      {activeSlide && targetScope ? <header className="focused-practice-slide-heading">
        <small>{targetLabel(targetScope, rangeSlideIndex, resolvedSlideIds.length)}</small>
        <h2>{activeSlide.title}</h2>
      </header> : null}
      <div className={`focused-practice-layout${deck && targetScope && activeSlideId ? "" : " no-preview"}`}>
        {deck && targetScope && activeSlideId ? <div className="focused-practice-visual-stage">
          <FocusedTargetPreview
            deck={deck}
            preview={Boolean(props.preview)}
            slideId={activeSlideId}
          />
          <aside className="focused-practice-controls" aria-label="연습 제어">
            <small>이번 연습</small>
            <strong>{goal?.successCondition ?? "성공 기준을 불러오는 중입니다."}</strong>
            {durationGuidance ? <div className="focused-practice-duration-guidance">
              <span>권장 연습 시간 · {durationGuidance.targetLabel}</span>
              <strong>{durationGuidance.seconds}초</strong>
              <p>30~60초 안에서 짧게 반복하세요.</p>
            </div> : null}
            <span className="focused-practice-timer-label">진행 시간</span>
            <time className="focused-practice-timer">{formatPracticeTimer(elapsedSeconds)}</time>
            <p>{isRecording ? "자막을 끝까지 읽은 뒤 녹음을 끝내 주세요." : "현재 장표와 아래 자막을 보며 연습합니다."}</p>
            {rangeIncomplete ? <OrbitButton variant="quiet" icon={<IconArrowRight size={18} />} onClick={advanceRangeSlide}>다음 장표로 전환</OrbitButton> : null}
            <div className="focused-practice-control-actions">
              <OrbitButton disabled={!sessionId || processing || compatibilityState === "stale" || !deck || !targetScope || resolvedSlideIds.length === 0 || rangeIncomplete} icon={isRecording ? <IconSquare size={18} /> : attempts.length ? <IconRefresh size={18} /> : <IconMicrophone size={18} />} onClick={() => void toggleRecording()}>{isRecording ? "녹음 끝내기" : attempts.length ? "한 번 더 연습" : "녹음 시작"}</OrbitButton>
              <OrbitButton variant="quiet" disabled={!sessionId || isRecording || processing} onClick={() => props.preview ? setStatus("연습 완료") : void completeFocusedSession(sessionId!).then(() => { sessionStorage.removeItem(sessionStorageKey); sessionStorage.removeItem(requestStorageKey); window.location.href = `/rehearsal/${encodeURIComponent(props.projectId)}/plan/${encodeURIComponent(props.sourceFullRunId)}`; })}>연습 마치기</OrbitButton>
            </div>
          </aside>
        </div> : null}
        <article className="focused-practice-transcript">
          <small>읽어야 할 자막</small>
          <p>{practiceTranscript || "이 장표에 등록된 발표 대본이 없습니다."}</p>
        </article>
      </div>
      <section className="focused-attempt-history" aria-label="반복 결과">
        <header><h2>반복 기록</h2><span>{attempts.length}회 시도</span></header>
        {attempts.length === 0 ? <p>아직 반복 기록이 없습니다. 첫 녹음을 시작해 보세요.</p> : attempts.map((attempt) => {
          const copy = attemptStatusCopy(attempt);
          return <div key={attempt.attemptId}>
            <span>{attempt.attemptNumber}회</span>
            <strong>{copy.label}</strong>
            <small>{copy.description}</small>
            <time>{attempt.durationMs ? `${Math.max(1, Math.round(attempt.durationMs / 1000))}초` : "-"}</time>
          </div>;
        })}
      </section>
    </section>
  </div>;
}

function FocusedTargetPreview(props: {
  deck: Deck;
  preview: boolean;
  slideId: string;
}) {
  if (props.preview) return <FocusedPreviewSlideCard deck={props.deck} slideId={props.slideId} />;
  return <Suspense fallback={<FocusedPreviewSlideCard deck={props.deck} slideId={props.slideId} />}><FocusedSlidePreview deck={props.deck} slideId={props.slideId} /></Suspense>;
}

function FocusedPreviewSlideCard(props: { deck: Deck; slideId: string }) {
  const slide = props.deck.slides.find((candidate) => candidate.slideId === props.slideId);
  if (!slide) return null;
  return <section className="focused-slide-preview focused-slide-preview-fallback" aria-label={`${slide.title} 장표 미리보기`}><div><span>{String(slide.order).padStart(2, "0")} · FOCUS</span><strong>{slide.title}</strong><p>이 장표의 핵심 메시지와 근거를 짧게 반복합니다.</p></div></section>;
}

function targetLabel(targetScope: FocusedPracticeTargetScope, activeIndex: number, totalSlides: number) {
  if (targetScope.type === "sentence") return `문장 연습 · ${targetScope.sentenceIndex + 1}번째 문장`;
  if (targetScope.type === "slide-range") return `연속 장표 · ${activeIndex + 1}/${totalSlides}`;
  if (targetScope.type === "opening") return "도입부 연습";
  if (targetScope.type === "closing") return "마무리 연습";
  return "현재 장표";
}

function formatPracticeTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function attemptStatusCopy(attempt: FocusedPracticeAttempt) {
  if (attempt.status === "uploading") {
    return { label: "업로드 중", description: "녹음 파일을 업로드하고 있습니다." };
  }
  if (attempt.status === "queued") {
    return { label: "분석 대기", description: "분석 작업이 시작되기를 기다리고 있습니다." };
  }
  if (attempt.status === "processing") {
    return { label: "분석 중", description: "음성을 텍스트로 변환하고 결과를 분석하고 있습니다." };
  }
  if (attempt.status === "failed") {
    return { label: "분석 실패", description: "분석 요청을 처리하지 못했습니다. 다시 녹음해 주세요." };
  }
  if (attempt.status === "cancelled") {
    return { label: "분석 취소", description: "분석이 취소되었습니다. 다시 시도해 주세요." };
  }
  if (attempt.result === "passed") {
    return { label: "통과", description: "성공 기준을 안정적으로 충족했어요." };
  }
  if (attempt.result === "unmeasured") {
    return { label: "측정 불가", description: "분석할 수 있는 음성 근거가 부족합니다." };
  }
  return { label: "다시 연습", description: "성공 기준에 맞춰 같은 구간을 다시 연습해 보세요." };
}
