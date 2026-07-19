import {
  slideQuestionGuideTextHashInput,
  type Deck,
  type Slide,
  type SlideQuestionGuide,
} from "@orbit/shared";
import { useEffect, useState } from "react";

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
  const [slideQuestionGuidesEnabled, setSlideQuestionGuidesEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void fetchLiveSttRuntimeConfig().then((runtimeConfig) => {
      if (active) setSlideQuestionGuidesEnabled(runtimeConfig.slideQuestionGuidesEnabled);
    }).catch(() => {
      if (active) setSlideQuestionGuidesEnabled(false);
    });
    return () => { active = false; };
  }, []);

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

  return (
    <div className="editor-question-guide-panel">
      <div className="editor-question-guide-actions">
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
          variant="primary"
        >
          {props.autoStatus === "generating"
            ? "질문 생성 중…"
            : slideQuestionGuidesEnabled === null
              ? "질문 생성 준비 중…"
              : status === "generating"
                ? "공식 자료 검색 중…"
                : guide
                  ? "다시 생성"
                  : "질문 생성"}
        </OrbitButton>
      </div>
      {slideQuestionGuidesEnabled === false ? <p className="editor-practice-message">이 환경에서는 슬라이드별 예상 질문 기능을 사용할 수 없습니다.</p> : null}
      {message ? <p className="editor-practice-message">{message}</p> : null}
      {props.autoStatus === "failed" && !guide ? <p className="editor-practice-message">자동 질문 생성에 실패했습니다. 질문 생성 버튼으로 다시 시도해 주세요.</p> : null}
      {guide && guide.items.length > 0 ? (
        <SlideQuestionGuideCarousel
          guide={guide}
          selectedQuestionId={selectedQuestionId}
          onSelect={setSelectedQuestionId}
        />
      ) : status === "loading" ? (
        <p className="editor-dock-empty">이전 질문을 불러오는 중…</p>
      ) : (
        <p className="editor-dock-empty">질문을 생성하면 이곳에서 바로 연습할 수 있습니다.</p>
      )}
    </div>
  );
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
  guide: SlideQuestionGuide;
  selectedQuestionId: string | null;
  onSelect: (questionId: string) => void;
}) {
  const selectedIndex = Math.max(
    0,
    props.guide.items.findIndex((item) => item.questionId === props.selectedQuestionId),
  );
  const selected = props.guide.items[selectedIndex] ?? props.guide.items[0];
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
      <nav aria-label="예상 질문 이동" className="editor-question-carousel-nav">
        <button
          aria-label="이전 질문"
          disabled={selectedIndex === 0}
          type="button"
          onClick={() => move(-1)}
        >
          <span aria-hidden="true">←</span>
        </button>
        <span aria-live="polite">
          <strong>Q{selectedIndex + 1}</strong>
          <small>{selectedIndex + 1} / {props.guide.items.length}</small>
        </span>
        <button
          aria-label="다음 질문"
          disabled={selectedIndex === props.guide.items.length - 1}
          type="button"
          onClick={() => move(1)}
        >
          <span aria-hidden="true">→</span>
        </button>
      </nav>
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
              <strong>추천 답변</strong>
              <p>{selected.suggestedAnswer?.summary}</p>
              <ol>{selected.suggestedAnswer?.structure.map((step) => <li key={step}>{step}</li>)}</ol>
              {selected.suggestedAnswer?.caveats.map((caveat) => <p className="editor-question-caveat" key={caveat}>{caveat}</p>)}
            </section>
          </>
        )}
        <OfficialSourceLinks sources={officialSources} />
      </article>
    </div>
  );
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
