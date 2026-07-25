import { deckSchema, type Deck, type SemanticCue } from "@orbit/shared";
import { useMemo, useState, type ChangeEvent } from "react";

import type { SemanticCueNliProvider } from "../speech/semanticCueNliProvider";
import { SemanticCueCandidateTable } from "./SemanticCueCandidateTable";
import { SemanticCueEventTimeline } from "./SemanticCueEventTimeline";
import { SemanticCueFailureControls } from "./SemanticCueFailureControls";
import { SemanticCueModePreview } from "./SemanticCueModePreview";
import { SemanticCuePipelinePanel } from "./SemanticCuePipelinePanel";
import { semanticCueLabPageStyles } from "./semanticCueLabStyles";
import {
  createSemanticCueLabFixtureDeck,
  semanticCueLabFixtures
} from "./semanticCueLabFixtures";
import {
  createLabMockProvider,
  parseDeckInput,
  runLabEvaluation,
  runLabFixtures,
  serializeLabInput,
  serializeLabSnapshot,
  serializeLabTimeline,
  type LabEvaluationResult,
  type LabFailureInjection,
  type LabFixtureResult,
  type LabProviderChoice,
  type LabTranscriptSegment
} from "./semanticCueLabModel";

type DraftSegment = {
  text: string;
  isFinal: boolean;
  startMs: string;
  endMs: string;
  confidence: string;
};

const emptyDraft: DraftSegment = {
  text: "",
  isFinal: true,
  startMs: "0",
  endMs: "2000",
  confidence: ""
};

export function SemanticCueLabPage(props: { initialDeck?: Deck }) {
  const [deck, setDeck] = useState<Deck | null>(props.initialDeck ?? null);
  const [deckText, setDeckText] = useState("");
  const [deckError, setDeckError] = useState<string | null>(null);
  const [deckSource, setDeckSource] = useState<string>(props.initialDeck ? "초기 deck" : "없음");
  const [projectId, setProjectId] = useState("");
  const [slideId, setSlideId] = useState<string>(
    props.initialDeck ? firstCueSlideId(props.initialDeck) : ""
  );
  const [segments, setSegments] = useState<LabTranscriptSegment[]>([]);
  const [draft, setDraft] = useState<DraftSegment>(emptyDraft);
  const [eventsText, setEventsText] = useState("");
  const [providerChoice, setProviderChoice] = useState<LabProviderChoice>("mock");
  const [useRealEmbedding, setUseRealEmbedding] = useState(false);
  const [injections, setInjections] = useState<Set<LabFailureInjection>>(new Set());
  const [browserProvider, setBrowserProvider] = useState<SemanticCueNliProvider | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [result, setResult] = useState<LabEvaluationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [batchResults, setBatchResults] = useState<LabFixtureResult[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [includeSensitive, setIncludeSensitive] = useState(false);

  const slide = useMemo(
    () => deck?.slides.find((candidate) => candidate.slideId === slideId) ?? null,
    [deck, slideId]
  );

  function applyDeck(nextDeck: Deck, source: string) {
    setDeck(nextDeck);
    setDeckSource(source);
    setDeckError(null);
    setResult(null);
    setSlideId(firstCueSlideId(nextDeck));
  }

  function loadFixtureDeck() {
    applyDeck(createSemanticCueLabFixtureDeck(), "기본 fixture deck");
  }

  function validatePastedDeck() {
    const parsed = parseDeckInput(deckText);
    if ("error" in parsed) {
      setDeckError(parsed.error);
      return;
    }
    applyDeck(parsed.deck, "붙여넣은 JSON");
  }

  function handleDeckFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    void file
      .text()
      .then((text) => {
        setDeckText(text);
        const parsed = parseDeckInput(text);
        if ("error" in parsed) {
          setDeckError(parsed.error);
          return;
        }
        applyDeck(parsed.deck, `업로드: ${file.name}`);
      })
      .catch((error) => setDeckError(formatDeckError(error)));
  }

  async function loadProjectDeck() {
    if (!projectId.trim()) {
      setDeckError("projectId를 입력하세요.");
      return;
    }
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId.trim())}/deck`, {
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error(`deck 요청 실패 (${response.status})`);
      }
      const payload = (await response.json()) as { deck: unknown };
      const parsed = deckSchema.parse(payload.deck);
      applyDeck(parsed, `프로젝트 ${projectId.trim()}`);
    } catch (error) {
      setDeckError(formatDeckError(error));
    }
  }

  function addDraftSegment() {
    if (!draft.text.trim()) {
      return;
    }
    const next: LabTranscriptSegment = {
      text: draft.text,
      isFinal: draft.isFinal,
      startMs: Number(draft.startMs) || 0,
      endMs: Number(draft.endMs) || 0,
      ...(draft.confidence.trim() ? { confidence: Number(draft.confidence) } : {})
    };
    setSegments((current) => [...current, next]);
    const nextStart = Number(draft.endMs) || 0;
    setDraft({ ...emptyDraft, startMs: String(nextStart), endMs: String(nextStart + 2000) });
  }

  function loadEventSequence() {
    try {
      const parsed = JSON.parse(eventsText) as unknown;
      const raw = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { segments?: unknown }).segments)
          ? (parsed as { segments: unknown[] }).segments
          : null;
      if (!raw) {
        throw new Error("segments 배열이 필요합니다.");
      }
      const next = raw.map(parseSegment);
      setSegments(next);
      setStatusMessage(`${next.length}개 segment를 불러왔습니다.`);
    } catch (error) {
      setStatusMessage(`event sequence 파싱 실패: ${formatDeckError(error)}`);
    }
  }

  function resetTranscript() {
    setSegments([]);
    setDraft(emptyDraft);
    setEventsText("");
    setResult(null);
  }

  function toggleInjection(injection: LabFailureInjection) {
    setInjections((current) => {
      const next = new Set(current);
      if (next.has(injection)) {
        next.delete(injection);
      } else {
        next.add(injection);
      }
      return next;
    });
  }

  async function loadBrowserProvider() {
    setBrowserLoading(true);
    setBrowserError(null);
    try {
      const [module, flags] = await Promise.all([
        import("../speech/browserSemanticCueNliProvider"),
        import("../speech/semanticCueFeatureFlags")
      ]);
      const modelId = flags.getSemanticCueRuntimeFlags(import.meta.env).modelId;
      const provider = module.createBrowserTransformersSemanticCueNliProvider({ modelId });
      const info = await provider.load();
      if (info.status !== "ready") {
        setBrowserProvider(null);
        setBrowserError(info.error ?? `provider status: ${info.status}`);
        return;
      }
      setBrowserProvider(provider);
      setStatusMessage(`browser NLI provider 준비됨 (${info.modelId ?? "unknown"})`);
    } catch (error) {
      setBrowserProvider(null);
      setBrowserError(error instanceof Error ? error.message : String(error));
    } finally {
      setBrowserLoading(false);
    }
  }

  async function runEvaluation() {
    if (!deck || !slideId) {
      setStatusMessage("deck과 slide를 먼저 선택하세요.");
      return;
    }
    setRunning(true);
    setStatusMessage(null);
    try {
      const injectionList = [...injections];
      const provider = resolveProvider({
        choice: providerChoice,
        injections: injectionList,
        browserProvider
      });
      const evaluation = await runLabEvaluation({
        deck,
        slideId,
        segments,
        injections: injectionList,
        provider,
        nliEnabled: providerChoice !== "none",
        useRealEmbedding,
        ...(providerChoice === "browser" && !browserProvider
          ? { providerLoadError: browserError ?? "browser provider가 로드되지 않았습니다." }
          : {})
      });
      setResult(evaluation);
    } catch (error) {
      setStatusMessage(`평가 실패: ${formatDeckError(error)}`);
    } finally {
      setRunning(false);
    }
  }

  async function runBatch() {
    if (!deck) {
      return;
    }
    const usingFixtureDeck = deck.deckId === "deck_semantic_cue_lab";
    const targetDeck = usingFixtureDeck ? deck : createSemanticCueLabFixtureDeck();
    const results = await runLabFixtures(targetDeck, semanticCueLabFixtures);
    setBatchResults(results);
    if (!usingFixtureDeck) {
      setStatusMessage("batch fixture는 내장 fixture deck으로 실행했습니다.");
    }
  }

  function copy(text: string, label: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setStatusMessage(`${label}을(를) 복사했습니다.`))
      .catch(() => setStatusMessage(`${label} 복사 실패`));
  }

  function download(text: string, filename: string) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="scue-lab" data-testid="semantic-cue-lab-page">
      <style>{semanticCueLabPageStyles}</style>
      <header className="scue-lab-header">
        <h1>Semantic Cue Lab</h1>
        <p className="scue-lab-subtitle">
          개발·QA 전용 · production Semantic Cue/STT/E5/NLI runtime을 그대로 사용합니다.
        </p>
      </header>

      {statusMessage ? (
        <p className="scue-lab-status" data-testid="lab-status">
          {statusMessage}
        </p>
      ) : null}

      <section className="scue-lab-section" aria-label="Deck 입력">
        <h2>1. Deck 입력</h2>
        <div className="scue-lab-row">
          <button type="button" onClick={loadFixtureDeck} data-testid="load-fixture-deck">
            기본 fixture deck
          </button>
          <label className="scue-lab-file">
            JSON 파일 업로드
            <input type="file" accept="application/json,.json" onChange={handleDeckFileUpload} data-testid="deck-file" />
          </label>
          <span className="scue-lab-inline">
            <input
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              placeholder="projectId"
              data-testid="project-id"
            />
            <button type="button" onClick={() => void loadProjectDeck()} data-testid="load-project-deck">
              현재 프로젝트 deck 불러오기
            </button>
          </span>
        </div>
        <textarea
          className="scue-lab-textarea"
          value={deckText}
          onChange={(event) => setDeckText(event.target.value)}
          placeholder="Deck JSON 붙여넣기"
          data-testid="deck-json"
        />
        <div className="scue-lab-row">
          <button type="button" onClick={validatePastedDeck} data-testid="validate-deck">
            검증 및 적용
          </button>
          <span className="scue-lab-meta">현재 deck: {deckSource}</span>
        </div>
        {deckError ? (
          <p className="scue-lab-error" data-testid="deck-error">
            {deckError}
          </p>
        ) : null}
      </section>

      {deck ? (
        <section className="scue-lab-section" aria-label="Slide 선택">
          <h2>2. Slide 선택</h2>
          <select
            value={slideId}
            onChange={(event) => setSlideId(event.target.value)}
            data-testid="slide-select"
          >
            {deck.slides.map((option) => (
              <option key={option.slideId} value={option.slideId}>
                {option.order}. {option.title || option.slideId}
              </option>
            ))}
          </select>
          {slide ? <SlideDetail slide={slide as { slideId: string; title: string; speakerNotes: string; keywords: unknown[]; semanticCues: SemanticCue[] }} /> : null}
        </section>
      ) : null}

      <section className="scue-lab-section" aria-label="Transcript 입력">
        <h2>3. Transcript 입력</h2>
        <div className="scue-lab-segment-form">
          <input
            value={draft.text}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
            placeholder="발화 텍스트"
            data-testid="segment-text"
          />
          <label>
            <input
              type="checkbox"
              checked={draft.isFinal}
              onChange={(event) => setDraft({ ...draft, isFinal: event.target.checked })}
              data-testid="segment-final"
            />
            final
          </label>
          <input
            value={draft.startMs}
            onChange={(event) => setDraft({ ...draft, startMs: event.target.value })}
            placeholder="startMs"
            inputMode="numeric"
            data-testid="segment-start"
          />
          <input
            value={draft.endMs}
            onChange={(event) => setDraft({ ...draft, endMs: event.target.value })}
            placeholder="endMs"
            inputMode="numeric"
            data-testid="segment-end"
          />
          <input
            value={draft.confidence}
            onChange={(event) => setDraft({ ...draft, confidence: event.target.value })}
            placeholder="confidence"
            inputMode="decimal"
            data-testid="segment-confidence"
          />
          <button type="button" onClick={addDraftSegment} data-testid="add-segment">
            segment 추가
          </button>
        </div>

        <ol className="scue-lab-segment-list" data-testid="segment-list">
          {segments.map((segment, index) => (
            <li key={`${segment.startMs}:${index}`}>
              <span className={segment.isFinal ? "scue-lab-final" : "scue-lab-partial"}>
                {segment.isFinal ? "final" : "partial"}
              </span>
              <span>[{segment.startMs}–{segment.endMs}ms]</span>
              <span className="scue-lab-segment-text">{segment.text}</span>
              <button type="button" onClick={() => setSegments((current) => current.filter((_, i) => i !== index))}>
                삭제
              </button>
            </li>
          ))}
        </ol>

        <details className="scue-lab-details">
          <summary>JSON event sequence 불러오기</summary>
          <textarea
            className="scue-lab-textarea"
            value={eventsText}
            onChange={(event) => setEventsText(event.target.value)}
            placeholder='[{"text":"...","isFinal":true,"startMs":0,"endMs":2000}]'
            data-testid="events-json"
          />
          <button type="button" onClick={loadEventSequence} data-testid="load-events">
            불러오기
          </button>
        </details>

        <div className="scue-lab-row">
          <button type="button" onClick={resetTranscript} data-testid="reset-transcript">
            입력 초기화
          </button>
        </div>
      </section>

      <section className="scue-lab-section" aria-label="Provider 및 실행">
        <h2>4. Provider · 실행</h2>
        <div className="scue-lab-row">
          <fieldset className="scue-lab-provider">
            <legend>NLI provider</legend>
            {(["mock", "browser", "none"] as LabProviderChoice[]).map((choice) => (
              <label key={choice}>
                <input
                  type="radio"
                  name="provider"
                  checked={providerChoice === choice}
                  onChange={() => setProviderChoice(choice)}
                  data-testid={`provider-${choice}`}
                />
                {choice}
              </label>
            ))}
          </fieldset>
          <label className="scue-lab-inline">
            <input
              type="checkbox"
              checked={useRealEmbedding}
              onChange={(event) => setUseRealEmbedding(event.target.checked)}
              data-testid="use-real-embedding"
            />
            실제 E5 임베딩 사용
          </label>
        </div>

        {providerChoice === "browser" ? (
          <div className="scue-lab-row" data-testid="browser-provider-controls">
            <button type="button" onClick={() => void loadBrowserProvider()} disabled={browserLoading}>
              {browserLoading ? "browser NLI 로드 중…" : "실제 browser NLI 로드"}
            </button>
            <span className="scue-lab-meta">
              {browserProvider ? "provider ready" : browserError ? `provider unavailable: ${browserError}` : "미로드"}
            </span>
          </div>
        ) : null}

        <SemanticCueFailureControls
          active={injections}
          onToggle={toggleInjection}
          onClear={() => setInjections(new Set())}
        />

        <div className="scue-lab-row">
          <button type="button" className="scue-lab-run" onClick={() => void runEvaluation()} disabled={running} data-testid="run-eval">
            {running ? "평가 중…" : "평가 실행"}
          </button>
        </div>
      </section>

      {result ? (
        <>
          <section className="scue-lab-section" aria-label="판정 파이프라인">
            <h2>5. 판정 파이프라인</h2>
            <SemanticCuePipelinePanel
              steps={result.pipeline}
              nli={result.debugEvent.nli}
              nliSkipDetail={result.pipeline.find((step) => step.id === "nli-result")?.detail ?? ""}
            />
          </section>

          <section className="scue-lab-section" aria-label="Candidate table">
            <h2>6. Candidate table</h2>
            <SemanticCueCandidateTable rows={result.candidateRows} />
          </section>

          <section className="scue-lab-section" aria-label="Action gate">
            <h2>7. Action gate</h2>
            <ActionGate result={result} />
          </section>

          <section className="scue-lab-section" aria-label="모드별 미리보기">
            <h2>8. 모드별 미리보기</h2>
            <SemanticCueModePreview result={result} />
          </section>

          <section className="scue-lab-section" aria-label="Timeline 및 export">
            <h2>9. Timeline · Export</h2>
            <SemanticCueEventTimeline entries={result.timeline} />
            <label className="scue-lab-inline">
              <input
                type="checkbox"
                checked={includeSensitive}
                onChange={(event) => setIncludeSensitive(event.target.checked)}
                data-testid="include-sensitive"
              />
              민감 정보(transcript/premise) 포함 export
            </label>
            <div className="scue-lab-row">
              <button
                type="button"
                data-testid="copy-snapshot"
                onClick={() => copy(serializeLabSnapshot(result, { includeSensitive }), "JSON snapshot")}
              >
                JSON snapshot 복사
              </button>
              <button
                type="button"
                data-testid="export-timeline"
                onClick={() => download(serializeLabTimeline(result), "semantic-cue-lab-timeline.json")}
              >
                Timeline export
              </button>
              <button
                type="button"
                data-testid="export-input"
                onClick={() =>
                  download(
                    serializeLabInput({
                      deckId: deck?.deckId ?? "",
                      slideId,
                      segments,
                      injections: [...injections],
                      provider: providerChoice,
                      includeTranscript: includeSensitive
                    }),
                    "semantic-cue-lab-input.json"
                  )
                }
              >
                테스트 입력 export
              </button>
              <button type="button" data-testid="reset-result" onClick={() => setResult(null)}>
                결과 초기화
              </button>
            </div>
          </section>
        </>
      ) : null}

      <section className="scue-lab-section" aria-label="Batch fixture">
        <h2>10. Batch fixture 테스트</h2>
        <button type="button" onClick={() => void runBatch()} data-testid="run-batch">
          fixture 전체 실행
        </button>
        {batchResults.length > 0 ? (
          <div className="scue-lab-table-scroll">
            <table className="scue-lab-table" data-testid="batch-table">
              <thead>
                <tr>
                  <th>fixture</th>
                  <th>expected</th>
                  <th>actual</th>
                  <th>결과</th>
                  <th>실패 이유</th>
                </tr>
              </thead>
              <tbody>
                {batchResults.map((batch) => (
                  <tr key={batch.fixture.id} data-testid={`batch-row-${batch.fixture.id}`}>
                    <td>{batch.fixture.label}</td>
                    <td>
                      {batch.fixture.expected.status} · {batch.fixture.expected.measurementMode}
                      {batch.fixture.expected.fallbackReason ? ` · ${batch.fixture.expected.fallbackReason}` : ""}
                    </td>
                    <td>
                      {batch.actual.status} · {batch.actual.measurementMode}
                      {batch.actual.fallbackReason ? ` · ${batch.actual.fallbackReason}` : ""}
                    </td>
                    <td className={batch.pass ? "scue-lab-pass" : "scue-lab-fail"}>
                      {batch.pass ? "PASS" : "FAIL"}
                    </td>
                    <td>{batch.failReasons.join("; ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function SlideDetail(props: {
  slide: { slideId: string; title: string; speakerNotes: string; keywords: unknown[]; semanticCues: SemanticCue[] };
}) {
  const { slide } = props;
  return (
    <div className="scue-lab-slide-detail" data-testid="slide-detail">
      <dl className="scue-lab-slide-meta">
        <div>
          <dt>slideId</dt>
          <dd>{slide.slideId}</dd>
        </div>
        <div>
          <dt>title</dt>
          <dd>{slide.title || "—"}</dd>
        </div>
        <div>
          <dt>speakerNotes</dt>
          <dd>{slide.speakerNotes.trim() ? "있음" : "없음"}</dd>
        </div>
        <div>
          <dt>keywords</dt>
          <dd>{slide.keywords.length}</dd>
        </div>
        <div>
          <dt>semanticCues</dt>
          <dd>{slide.semanticCues.length}</dd>
        </div>
      </dl>

      {slide.semanticCues.map((cue) => (
        <article key={cue.cueId} className="scue-lab-cue-card" data-testid={`cue-card-${cue.cueId}`}>
          <header>
            <strong>{cue.cueId}</strong>
            <span className={`scue-lab-cue-tag scue-lab-cue-${cue.reviewStatus}`}>{cue.reviewStatus}</span>
            <span className={`scue-lab-cue-tag scue-lab-cue-${cue.freshness}`}>{cue.freshness}</span>
            <span className="scue-lab-cue-tag">{cue.importance}</span>
          </header>
          <p className="scue-lab-cue-meaning">{cue.reportLabel ?? cue.meaning}</p>
          <ul className="scue-lab-cue-fields">
            <li>candidateKeywords: {formatList(cue.candidateKeywords)}</li>
            <li>aliases: {formatAliases(cue.aliases)}</li>
            <li>requiredConcepts: {formatList(cue.requiredConcepts)}</li>
            <li>nliHypotheses: {formatList(cue.nliHypotheses)}</li>
            <li>qualityWarnings: {formatList(cue.qualityWarnings)}</li>
            <li>targetElementIds: {formatList(cue.targetElementIds)}</li>
          </ul>
        </article>
      ))}
    </div>
  );
}

function ActionGate(props: { result: LabEvaluationResult }) {
  const gate = props.result.actionGate;
  return (
    <div className="scue-lab-action-gate" data-testid="action-gate">
      <div className="scue-lab-gate-flags">
        <span className={gate.autoAdvance ? "ok" : "blocked"}>auto advance: {String(gate.autoAdvance)}</span>
        <span className={gate.reveal ? "ok" : "blocked"}>reveal: {String(gate.reveal)}</span>
        <span className={gate.animation ? "ok" : "blocked"}>animation: {String(gate.animation)}</span>
        <span className={gate.allowed ? "ok" : "blocked"} data-testid="gate-allowed">
          allowed: {String(gate.allowed)}
        </span>
      </div>
      <dl>
        <div>
          <dt>blockedReasons</dt>
          <dd data-testid="gate-blocked-reasons">{gate.blockedReasons.join(", ") || "—"}</dd>
        </div>
        <div>
          <dt>required cue coverage</dt>
          <dd>{gate.requiredCueCoverage}</dd>
        </div>
        <div>
          <dt>minimum dwell</dt>
          <dd>{gate.minimumDwellMs}ms</dd>
        </div>
        <div>
          <dt>cooldown</dt>
          <dd>{gate.cooldownMs}ms</dd>
        </div>
        <div>
          <dt>capability</dt>
          <dd>{gate.capabilityState}</dd>
        </div>
      </dl>
    </div>
  );
}

function resolveProvider(options: {
  choice: LabProviderChoice;
  injections: readonly LabFailureInjection[];
  browserProvider: SemanticCueNliProvider | null;
}): SemanticCueNliProvider | undefined {
  if (options.choice === "none") {
    return undefined;
  }
  if (options.choice === "browser") {
    return options.browserProvider ?? undefined;
  }
  return createLabMockProvider({ injections: options.injections });
}

function parseSegment(value: unknown): LabTranscriptSegment {
  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string") {
    throw new Error("segment.text가 필요합니다.");
  }
  return {
    text: record.text,
    isFinal: Boolean(record.isFinal),
    startMs: Number(record.startMs) || 0,
    endMs: Number(record.endMs) || 0,
    ...(typeof record.confidence === "number" ? { confidence: record.confidence } : {})
  };
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "—";
}

function formatAliases(aliases: Record<string, string[]>): string {
  const entries = Object.entries(aliases);
  if (entries.length === 0) {
    return "—";
  }
  return entries.map(([canonical, values]) => `${canonical} → [${values.join(", ")}]`).join(" · ");
}

function formatDeckError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function firstCueSlideId(deck: Deck): string {
  const cueSlide = deck.slides.find((slide) => slide.semanticCues.length > 0);
  return cueSlide?.slideId ?? deck.slides[0]?.slideId ?? "";
}
