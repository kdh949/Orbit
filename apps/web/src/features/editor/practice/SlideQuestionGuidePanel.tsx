import {
  slideQuestionGuideTextHashInput,
  type Deck,
  type Slide,
  type SlideQuestionGuide,
} from "@orbit/shared";
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";

import { OrbitButton } from "../../../components/ui";
import { fetchLiveSttRuntimeConfig } from "../../rehearsal/stt/liveSttRuntimeConfig";
import { fetchDeck } from "../shell/api/deckPersistenceApi";
import {
  createSlideQuestionGuide,
  getSlideQuestionGuide,
  listSlideQuestionGuides,
  sha256Canonical,
  waitForSlideQuestionGuideJob,
} from "./slideQuestionGuideApi";
import type { AutoSlideQuestionGuideStatus } from "./useAutoSlideQuestionGuides";

export type SlideQuestionGuideRuntimeState =
  | "checking"
  | "enabled"
  | "disabled"
  | "unavailable";

export function SlideQuestionGuidePanel(props: {
  autoStatus: AutoSlideQuestionGuideStatus;
  canGenerate: boolean;
  projectId: string;
  deck: Deck;
  slide: Slide | null;
  refreshToken: number;
  flushPendingSaves: () => Promise<void>;
}) {
  const [guide, setGuide] = useState<SlideQuestionGuide | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "generating" | "error">("idle");
  const [message, setMessage] = useState("");
  const [runtimeState, setRuntimeState] = useState<SlideQuestionGuideRuntimeState>("checking");
  const [runtimeConfigRequest, setRuntimeConfigRequest] = useState(0);
  const slideQuestionGuidesEnabled = runtimeState === "enabled"
    ? true
    : runtimeState === "checking"
      ? null
      : false;

  useEffect(() => {
    let active = true;
    setRuntimeState("checking");
    void resolveSlideQuestionGuideRuntimeState().then((nextState) => {
      if (active) setRuntimeState(nextState);
    });
    return () => { active = false; };
  }, [runtimeConfigRequest]);

  useEffect(() => {
    let active = true;
    if (slideQuestionGuidesEnabled !== true) {
      setGuide(null);
      setStatus("idle");
      return () => { active = false; };
    }
    if (!props.slide) {
      setGuide(null);
      return;
    }
    setStatus("loading");
    const slide = props.slide;
    void Promise.all([
      listSlideQuestionGuides({
        projectId: props.projectId,
        deckId: props.deck.deckId,
        slideId: slide.slideId,
      }),
      sha256Canonical(slideQuestionGuideTextHashInput(slide)),
    ]).then(([guides, slideContentHash]) => {
      if (!active) return;
      const current = findCurrentSlideQuestionGuide(guides, slideContentHash);
      setGuide(current);
      setSelectedQuestionId(getInitialQuestionId(current));
      setStatus("idle");
    }).catch(() => {
      if (active) setStatus("error");
    });
    return () => { active = false; };
  }, [props.deck.deckId, props.projectId, props.refreshToken, props.slide, slideQuestionGuidesEnabled]);

  async function generate() {
    if (!props.canGenerate || !props.slide || slideQuestionGuidesEnabled !== true) return;
    setStatus("generating");
    setMessage("");
    try {
      await props.flushPendingSaves();
      const serverDeck = await fetchDeck(props.projectId);
      if (!serverDeck.slides.some((slide) => slide.slideId === props.slide?.slideId)) {
        throw new Error("현재 슬라이드가 서버 덱에 없습니다.");
      }
      const created = await createSlideQuestionGuide({
        projectId: props.projectId,
        deckId: serverDeck.deckId,
        slideId: props.slide.slideId,
        expectedDeckVersion: serverDeck.version,
      });
      await waitForSlideQuestionGuideJob(created.job.jobId);
      const next = await getSlideQuestionGuide(props.projectId, created.guideId);
      setGuide(next);
      setSelectedQuestionId(getInitialQuestionId(next));
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "예상 질문 생성에 실패했습니다.");
    }
  }

  const renderGenerateButton = (insideGuide = false) => (
    <OrbitButton
      className="editor-question-guide-generate-button"
      disabled={isSlideQuestionGuideGenerationDisabled({
        autoStatus: props.autoStatus,
        canGenerate: props.canGenerate,
        hasSlide: Boolean(props.slide),
        slideQuestionGuidesEnabled,
        status,
      })}
      onClick={() => void generate()}
      size="compact"
      variant={insideGuide ? "secondary" : "primary"}
    >
      {props.autoStatus === "generating"
        ? "질문 생성 중…"
        : runtimeState === "checking"
          ? "질문 생성 준비 중…"
          : runtimeState === "unavailable"
            ? "설정 확인 필요"
          : status === "generating"
            ? "공식 자료 검색 중…"
            : guide
              ? "다시 생성"
              : "질문 생성"}
    </OrbitButton>
  );

  return (
    <div className="editor-question-guide-panel">
      {runtimeState === "disabled" ? <p className="editor-practice-message">이 환경에서는 슬라이드별 예상 질문 기능을 사용할 수 없습니다.</p> : null}
      {runtimeState === "unavailable" ? (
        <div aria-live="polite" className="editor-question-guide-runtime-error">
          <p className="editor-practice-message">예상 질문 설정을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
          <OrbitButton
            onClick={() => setRuntimeConfigRequest((current) => current + 1)}
            size="compact"
            variant="secondary"
          >
            설정 다시 확인
          </OrbitButton>
        </div>
      ) : null}
      {message ? <p className="editor-practice-message">{message}</p> : null}
      {props.autoStatus === "failed" && !guide ? <p className="editor-practice-message">자동 질문 생성에 실패했습니다. 질문 생성 버튼으로 다시 시도해 주세요.</p> : null}
      {guide && guide.items.length > 0 ? (
        <SlideQuestionGuideCarousel
          action={renderGenerateButton(true)}
          guide={guide}
          selectedQuestionId={selectedQuestionId}
          onSelect={setSelectedQuestionId}
        />
      ) : status === "loading" ? (
        <p className="editor-dock-empty">이전 질문을 불러오는 중…</p>
      ) : (
        <>
          <div className="editor-question-guide-actions">{renderGenerateButton()}</div>
          <p className="editor-dock-empty">질문을 생성하면 이곳에서 바로 연습할 수 있습니다.</p>
        </>
      )}
    </div>
  );
}

export async function resolveSlideQuestionGuideRuntimeState(
  fetchRuntimeConfig: () => Promise<{ slideQuestionGuidesEnabled: boolean }> = fetchLiveSttRuntimeConfig,
): Promise<Exclude<SlideQuestionGuideRuntimeState, "checking">> {
  try {
    const runtimeConfig = await fetchRuntimeConfig();
    return runtimeConfig.slideQuestionGuidesEnabled ? "enabled" : "disabled";
  } catch {
    return "unavailable";
  }
}

export function isSlideQuestionGuideGenerationDisabled(input: {
  autoStatus: AutoSlideQuestionGuideStatus;
  canGenerate: boolean;
  hasSlide: boolean;
  slideQuestionGuidesEnabled: boolean | null;
  status: "idle" | "loading" | "generating" | "error";
}) {
  return !input.canGenerate ||
    !input.hasSlide ||
    input.status === "generating" ||
    input.autoStatus === "generating" ||
    input.slideQuestionGuidesEnabled !== true;
}

export function getInitialQuestionId(guide: SlideQuestionGuide | null) {
  return guide?.items[0]?.questionId ?? null;
}

export function findCurrentSlideQuestionGuide(
  guides: SlideQuestionGuide[],
  slideContentHash: string,
) {
  return guides.find((candidate) => candidate.slideContentHash === slideContentHash) ?? null;
}

export function SlideQuestionGuideCarousel(props: {
  action?: ReactNode;
  guide: SlideQuestionGuide;
  selectedQuestionId: string | null;
  onSelect: (questionId: string) => void;
}) {
  const selectedIndex = Math.max(
    0,
    props.guide.items.findIndex((item) => item.questionId === props.selectedQuestionId),
  );
  const selected = props.guide.items[selectedIndex] ?? props.guide.items[0];
  const [answerExpanded, setAnswerExpanded] = useState(false);
  useEffect(() => setAnswerExpanded(false), [selected?.questionId]);
  if (!selected) return null;
  const officialSources = uniqueOfficialSources(
    Array.from(selected.sourceRefs).filter((source) => source.kind === "web"),
  );
  const move = (offset: -1 | 1) => {
    const nextQuestionId = getAdjacentQuestionId(
      props.guide,
      selected.questionId,
      offset,
    );
    if (nextQuestionId) props.onSelect(nextQuestionId);
  };
  const suggestedAnswer = selected.suggestedAnswer;
  const answerSummary = suggestedAnswer?.summary ?? "";
  const hasSuggestedAnswer = answerSummary.trim().length > 0;
  const answerPreview = hasSuggestedAnswer
    ? getSuggestedAnswerPreview(answerSummary, 96)
    : "추천 답변을 불러오지 못했습니다. 다시 생성해 주세요.";
  const keyPoints = suggestedAnswer?.structure.slice(0, 3) ?? [];
  return (
    <div
      aria-label="예상 질문 탐색"
      className="editor-question-guide-content carousel"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        }
      }}
      role="region"
      tabIndex={0}
    >
      <header className="editor-question-carousel-toolbar">
        <div aria-live="polite" className="editor-question-carousel-progress">
          <strong>Q{selectedIndex + 1} / {props.guide.items.length}</strong>
          <span aria-hidden="true" className="editor-question-carousel-dots">
            {props.guide.items.map((item, index) => (
              <i className={index === selectedIndex ? "active" : ""} key={item.questionId} />
            ))}
          </span>
        </div>
        <nav aria-label="예상 질문 이동" className="editor-question-carousel-nav">
          <button
            aria-label="이전 질문"
            disabled={selectedIndex === 0}
            type="button"
            onClick={() => move(-1)}
          >
            <IconChevronLeft aria-hidden="true" size={16} stroke={2} />
            <span>이전</span>
          </button>
          <button
            aria-label="다음 질문"
            disabled={selectedIndex === props.guide.items.length - 1}
            type="button"
            onClick={() => move(1)}
          >
            <span>다음</span>
            <IconChevronRight aria-hidden="true" size={16} stroke={2} />
          </button>
        </nav>
        {props.action ? <div className="editor-question-carousel-action">{props.action}</div> : null}
      </header>
      <article aria-live="polite">
        <h4>{selected.questionText}</h4>
        {selected.supportState === "insufficient" ? (
          <div className="editor-question-remediation">
            <strong>근거가 부족합니다</strong>
            <p>{selected.remediation?.message}</p>
            <ul>{selected.remediation?.actions.map((action) => <li key={action}>{action}</li>)}</ul>
          </div>
        ) : (
          <>
            <div className="editor-question-concepts"><strong>핵심 개념</strong>{selected.keyConcepts.map((concept) => <span key={concept.label}>{concept.label}</span>)}</div>
            <section className="editor-question-answer" aria-label="추천 답변">
              <header>
                <div className="editor-question-answer-heading">
                  <strong>추천 답변 요약</strong>
                  <span>AI 추천</span>
                </div>
                {hasSuggestedAnswer ? (
                  <button
                    aria-controls={`question-answer-${selected.questionId}`}
                    aria-expanded={answerExpanded}
                    className="editor-question-answer-toggle"
                    type="button"
                    onClick={() => setAnswerExpanded((current) => !current)}
                  >
                    {answerExpanded ? "답변 접기" : "전체 답변 보기"}
                    {answerExpanded
                      ? <IconChevronUp aria-hidden="true" size={16} stroke={2} />
                      : <IconChevronDown aria-hidden="true" size={16} stroke={2} />}
                  </button>
                ) : null}
              </header>
              <div id={`question-answer-${selected.questionId}`}>
                <p className={hasSuggestedAnswer ? undefined : "editor-question-answer-empty"}>
                  {answerExpanded ? answerSummary : answerPreview}
                </p>
                {answerExpanded ? suggestedAnswer?.caveats.map((caveat) => <p className="editor-question-caveat" key={caveat}>{caveat}</p>) : null}
                {answerExpanded ? <OfficialSourceLinks sources={officialSources} /> : null}
              </div>
              {keyPoints.length > 0 ? (
                <section aria-label="답변 핵심 포인트" className="editor-question-key-points">
                  <strong>핵심 포인트</strong>
                  <ul>
                    {keyPoints.map((point) => (
                      <li key={point}>
                        <IconCheck aria-hidden="true" size={16} stroke={2} />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </section>
          </>
        )}
        {selected.supportState === "insufficient" ? <OfficialSourceLinks sources={officialSources} /> : null}
      </article>
    </div>
  );
}

export function getSuggestedAnswerPreview(summary: string, maxLength = 120) {
  const normalized = summary.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  const sentenceEnd = normalized.slice(0, maxLength + 1).search(/[.!?](?:\s|$)/);
  if (sentenceEnd >= 0) return normalized.slice(0, sentenceEnd + 1);
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

export function getAdjacentQuestionId(
  guide: SlideQuestionGuide,
  selectedQuestionId: string,
  offset: -1 | 1,
) {
  const selectedIndex = guide.items.findIndex(
    (item) => item.questionId === selectedQuestionId,
  );
  if (selectedIndex < 0) return null;
  return guide.items[selectedIndex + offset]?.questionId ?? null;
}

type OfficialWebSource = {
  kind: "web";
  sourceId: string;
  url: string;
  title: string;
  authority: "official";
  contentHash: string;
  retrievedAt: string;
};

export function OfficialSourceLinks({ sources }: { sources: OfficialWebSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="editor-question-sources">
      <strong>공식 출처</strong>
      <ul>
        {sources.map((source) => (
          <li key={source.sourceId}>
            <a href={source.url} rel="noopener noreferrer" target="_blank">{source.title}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function uniqueOfficialSources(sources: OfficialWebSource[]) {
  return Array.from(new Map(sources.map((source) => [source.sourceId, source])).values());
}
