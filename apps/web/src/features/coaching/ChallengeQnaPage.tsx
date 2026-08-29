import {
  IconArrowLeft,
  IconBook,
  IconChevronRight,
  IconBulb,
  IconMicrophone,
  IconSend,
  IconSquare,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { OrbitButton, OrbitStatus } from "../../components/ui";
import {
  advanceChallengeQna,
  createChallengeQna,
  getChallengeQna,
  revealChallengeAssistance,
  submitTextAnswer,
  submitVoiceAnswer,
  type ChallengeQnaView,
} from "./challengeQnaApi";
import { useFocusedPracticeAudio, type FocusedPracticeCapture } from "./useFocusedPracticeAudio";
import "./challenge-qna.css";

export function ChallengeQnaPage(props: { previewView?: ChallengeQnaView; projectId: string; sourceFullRunId: string }) {
  const storageKey = `orbit.qna.${props.sourceFullRunId}`;
  const requestStorageKey = `${storageKey}.request`;
  const [view, setView] = useState<ChallengeQnaView | null>(props.previewView ?? null);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewRecording, setPreviewRecording] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const guideButton = useRef<HTMLButtonElement | null>(null);
  const audio = useFocusedPracticeAudio(120_000);
  const active = view?.questions.find((item) => item.order === view.session.activeQuestionOrder);
  const activeAttempts = view?.attempts.filter((item) => item.questionId === active?.questionId) ?? [];
  const result = activeAttempts.at(-1);

  useEffect(() => {
    if (props.previewView) return;
    let cancelled = false;
    void (async () => {
      try {
        let id = sessionStorage.getItem(storageKey);
        let requestId = sessionStorage.getItem(requestStorageKey);
        if (!requestId) {
          requestId = crypto.randomUUID();
          sessionStorage.setItem(requestStorageKey, requestId);
        }
        const next = id
          ? await getChallengeQna(id)
          : await createChallengeQna(props.projectId, props.sourceFullRunId, requestId);
        if (!id) {
          id = next.session.qnaSessionId;
          sessionStorage.setItem(storageKey, id);
        }
        if (!cancelled) { setView(next); setError(""); }
      } catch (cause) {
        if (!cancelled) setError(toChallengeQnaUserMessage(cause));
      }
    })();
    return () => { cancelled = true; };
  }, [props.projectId, props.sourceFullRunId, reloadKey]);

  useEffect(() => {
    if (props.previewView) return;
    if (!view || !["preparing", "ready", "active"].includes(view.session.status)) return;
    const pending = view.session.status === "preparing"
      || view.attempts.some((item) => ["queued", "processing"].includes(item.status));
    if (!pending) return;
    const timer = window.setInterval(() => {
      void getChallengeQna(view.session.qnaSessionId).then(setView).catch((cause) => setError(message(cause)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [view?.session.qnaSessionId, view?.session.status, view?.attempts.map((item) => item.status).join(",")]);

  async function sendCapture(capture: FocusedPracticeCapture) {
    if (!view || !active) return;
    setBusy(true);
    try {
      await submitVoiceAnswer(view.session.qnaSessionId, active, capture);
      setView(await getChallengeQna(view.session.qnaSessionId));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (props.previewView) return;
    if (!audio.automaticCapture) return;
    const capture = audio.automaticCapture;
    audio.clearAutomaticCapture();
    void sendCapture(capture);
  }, [audio.automaticCapture]);

  async function submit() {
    if (!view || !active) return;
    setError("");
    if (props.previewView) {
      if (mode === "voice" && !previewRecording) { setPreviewRecording(true); return; }
      if (mode === "voice") setPreviewRecording(false);
      setView({
        ...view,
        attempts: [...view.attempts, {
          answerAttemptId: `preview-answer-${view.attempts.length + 1}`,
          questionId: active.questionId,
          status: "succeeded",
          clarity: "clear",
          audienceFit: "appropriate",
          conceptOutcomes: [],
        } as any],
      });
      setText("");
      return;
    }
    if (mode === "voice") {
      if (!audio.recording) {
        await audio.start();
        return;
      }
      await sendCapture(await audio.stop());
      return;
    }
    if (!text.trim()) return;
    setBusy(true);
    try {
      await submitTextAnswer(view.session.qnaSessionId, active, text);
      setText("");
      setView(await getChallengeQna(view.session.qnaSessionId));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function reveal(level: "concept-hint" | "slide-hint" | "full-guide") {
    if (!view || !active) return;
    if (props.previewView) {
      if (level === "full-guide") setDrawer(true);
      return;
    }
    setView(await revealChallengeAssistance(view.session.qnaSessionId, active.questionId, active.revision, level));
    if (level === "full-guide") setDrawer(true);
  }

  async function next() {
    if (!view) return;
    if (props.previewView) { setView({ ...view, attempts: [] }); setDrawer(false); return; }
    const session = await advanceChallengeQna(view.session.qnaSessionId);
    if (session.status === "completed") {
      sessionStorage.removeItem(storageKey);
      sessionStorage.removeItem(requestStorageKey);
      window.location.href = `/rehearsal/${encodeURIComponent(props.projectId)}/plan/${encodeURIComponent(props.sourceFullRunId)}`;
      return;
    }
    setView(await getChallengeQna(view.session.qnaSessionId));
    setDrawer(false);
  }

  if (!view) {
    return <div className="redesign-page qna-page"><section className="qna-loading" role={error ? "alert" : "status"}>{error ? <><OrbitStatus tone="warning">준비 실패</OrbitStatus><h1>도전 질문을 준비하지 못했습니다.</h1><p>{error}</p><div><OrbitButton onClick={() => { sessionStorage.removeItem(storageKey); setError(""); setReloadKey((value) => value + 1); }}>다시 시도</OrbitButton><a href={`/rehearsal/${encodeURIComponent(props.projectId)}/plan/${encodeURIComponent(props.sourceFullRunId)}`}>연습 계획으로 돌아가기</a></div></> : <><OrbitStatus tone="lilac">질문 준비 중</OrbitStatus><h1>발표를 바탕으로 질문을 만들고 있습니다.</h1></>}</section></div>;
  }

  const isVoiceRecording = props.previewView ? previewRecording : audio.recording;
  const resultFeedback = active && result?.status === "succeeded"
    ? getChallengeAnswerFeedback(active.questionType, result.clarity, result.audienceFit)
    : null;

  return (
    <div className="redesign-page qna-page">
      <div className="qna-breadcrumb"><a href={`/rehearsal/${encodeURIComponent(props.projectId)}/plan/${encodeURIComponent(props.sourceFullRunId)}`}><IconArrowLeft size={17} /> 연습 계획</a><span>/</span><strong>도전 Q&amp;A</strong></div>
      <section className="qna-shell">
        <header>
          <div><p className="redesign-eyebrow">도전 Q&amp;A</p><h1>질문 하나에 집중해 답해 보세요.</h1><p>실제 청중이 물을 만한 질문을 발표 근거로 연습합니다.</p></div>
          <OrbitStatus tone={result?.status === "succeeded" ? "success" : "lilac"}>{view.session.activeQuestionOrder ?? 0} / {view.session.source.questionCount}</OrbitStatus>
        </header>
        {error ? <p className="qna-error" role="alert">{error}</p> : null}
        {active ? (
          <>
            <article className="qna-question">
              <small>{getChallengeQuestionMetaLabel(active.questionType, active.difficulty)}</small>
              <h2>{active.questionText}</h2>
              {active.answerGuide?.supportState === "insufficient" ? <p className="qna-warning">승인된 근거가 부족합니다. 참고자료를 추가하거나 주장을 좁혀 주세요.</p> : null}
            </article>
            <nav className="qna-assistance" aria-label="답변 도움">
              <button onClick={() => void reveal("concept-hint")} type="button"><IconBulb size={17} />개념 힌트</button>
              <button onClick={() => void reveal("slide-hint")} type="button"><IconBook size={17} />장표 근거</button>
              {activeAttempts.length ? <button ref={guideButton} onClick={() => void reveal("full-guide")} type="button">전체 가이드</button> : <span>전체 가이드는 첫 답변 후 열립니다.</span>}
            </nav>
            {active.conceptHints.length ? <aside className="qna-hint" aria-live="polite">포함할 개념: {active.conceptHints.join(", ")}</aside> : null}
            <section className="qna-answer" aria-label="답변 입력">
              <div role="tablist" aria-label="답변 방식">
                <button role="tab" aria-selected={mode === "voice"} onClick={() => setMode("voice")} type="button">음성</button>
                <button role="tab" aria-selected={mode === "text"} onClick={() => setMode("text")} type="button">텍스트</button>
              </div>
              {mode === "text" ? (
                <div className="qna-text-answer"><textarea aria-label="답변" value={text} maxLength={8000} onChange={(event) => setText(event.target.value)} placeholder="결론, 근거, 다음 행동 순서로 답해 보세요." /><OrbitButton disabled={busy || !text.trim()} icon={<IconSend size={18} />} onClick={() => void submit()}>답변 제출</OrbitButton></div>
              ) : (
                <div className="qna-voice-answer"><span><IconMicrophone size={24} /></span><div><strong>{isVoiceRecording ? "녹음 중입니다." : "음성 답변이 기본이에요."}</strong><p>{isVoiceRecording ? "최대 2분 뒤 자동으로 멈춥니다." : "준비되면 녹음을 시작하세요."}</p></div><OrbitButton disabled={busy} icon={isVoiceRecording ? <IconSquare size={18} /> : <IconMicrophone size={18} />} onClick={() => void submit()}>{isVoiceRecording ? "녹음 끝내기" : "음성 답변 시작"}</OrbitButton></div>
              )}
            </section>
            {resultFeedback ? (
              <section className="qna-result" aria-live="polite">
                <span><IconChevronRight size={22} /></span>
                <div><h2>답변 피드백</h2><h3>{resultFeedback.headline}</h3><p>청중 적합성: {resultFeedback.audienceFit}</p></div>
                <OrbitButton icon={<IconChevronRight size={18} />} onClick={() => void next()}>{view.session.activeQuestionOrder === view.session.source.questionCount ? "질문 연습 마치기" : "다음 질문"}</OrbitButton>
              </section>
            ) : null}
            {drawer && active.answerGuide ? <GuideDrawer guide={active.answerGuide} onClose={() => { setDrawer(false); guideButton.current?.focus(); }} /> : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

function GuideDrawer(props: { guide: any; onClose: () => void }) {
  const close = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
      if (event.key === "Tab") {
        const root = close.current?.closest("[role=dialog]");
        const focusable = root?.querySelectorAll<HTMLElement>("button,[href],textarea,input,[tabindex]:not([tabindex='-1'])");
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  return <div className="qna-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}><div className="qna-drawer" role="dialog" aria-modal="true" aria-labelledby="guide-title"><button ref={close} className="qna-drawer-close" aria-label="가이드 닫기" onClick={props.onClose} type="button"><IconX /></button><p className="redesign-eyebrow">답변 가이드</p><h2 id="guide-title">답변 구조 가이드</h2><ol>{props.guide.suggestedStructure.map((item: string) => <li key={item}>{item}</li>)}</ol><h3>반드시 포함할 개념</h3><ul>{props.guide.mustIncludeConcepts.map((item: any) => <li key={item.conceptId}>{item.label}</li>)}</ul>{props.guide.remediation ? <p className="qna-warning">{props.guide.remediation.message}</p> : null}</div></div>;
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다.";
}

export function toChallengeQnaUserMessage(cause: unknown) {
  const detail = message(cause);
  if (/not enabled|비활성|forbidden|403/i.test(detail)) {
    return "이 프로젝트에서는 도전 Q&A를 사용할 수 없습니다. 전체 리허설로 연습해 주세요.";
  }
  return "질문 생성 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function getChallengeQuestionMetaLabel(questionType: string, difficulty: string) {
  const questionTypeLabels: Record<string, string> = {
    clarification: "명확화",
    evidence: "근거 확인",
    objection: "반론 대응",
    decision: "의사결정",
  };
  const difficultyLabels: Record<string, string> = {
    standard: "기본",
    challenging: "심화",
  };
  return `${questionTypeLabels[questionType] ?? questionType} · ${difficultyLabels[difficulty] ?? difficulty}`;
}

export function getChallengeAnswerFeedback(
  questionType: string,
  clarity: string | null,
  audienceFit: string | null,
) {
  const clearHeadlines: Record<string, string> = {
    clarification: "설명이 명확해요. 핵심 용어의 범위를 한 문장으로 고정해 보세요.",
    evidence: "근거가 명확해요. 검증 기준을 한 문장으로 덧붙여 보세요.",
    objection: "반론 대응이 분명해요. 수용 조건과 한계를 함께 말해 보세요.",
    decision: "결정 요청이 명확해요. 담당자와 시점을 붙여 마무리해 보세요.",
  };
  const audienceFitLabels: Record<string, string> = {
    appropriate: "청중 수준에 잘 맞습니다.",
    "too-technical": "전문 용어를 줄이고 청중의 판단 언어로 바꿔 보세요.",
    "too-vague": "수치·사례·결정 기준 중 하나를 더 구체적으로 제시해 보세요.",
    unmeasured: "청중 적합성을 측정하지 못했습니다.",
  };

  const headline = clarity === "clear"
    ? clearHeadlines[questionType] ?? "결론이 명확해요. 질문에 맞는 판단 기준을 한 가지 더 붙여 보세요."
    : clarity === "unmeasured"
      ? "답변을 분석하지 못했습니다. 핵심 결론과 근거를 다시 한 번 말해 보세요."
      : "핵심 결론을 먼저 말하고 근거를 한 가지로 좁혀 보세요.";

  return {
    headline,
    audienceFit: audienceFitLabels[audienceFit ?? ""]
      ?? audienceFit
      ?? "청중 적합성을 측정하지 못했습니다.",
  };
}
