import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { semanticCueSchema, type SemanticCue } from "@orbit/shared";

import { getE5EmbeddingService } from "../e5EmbeddingService";
import { createBrowserTransformersSemanticCueNliProvider } from "../browserSemanticCueNliProvider";
import {
  createSemanticCueEmbeddingIndex,
  type SemanticCueEmbeddingIndex
} from "../semanticCueEmbeddingIndex";
import type { SemanticCueNliProvider } from "../semanticCueNliProvider";
import {
  createSemanticCueRuntime,
  type SemanticCueRuntimeResult
} from "../semanticCueRuntime";
import {
  semanticCueRuntimeConfig,
  type SemanticCueRuntimeConfig
} from "../semanticCueRuntimeConfig";
import {
  defaultSemanticCueCombinerConfig,
  type SemanticCueCombinerConfig
} from "../semanticCueScoreCombiner";
import { createLiveSttPort } from "../../stt/liveSttEngineRegistry";
import type { LiveSttEngineId, LiveSttPort } from "../../../../runtime/speech/stt/liveSttPort";
import { semanticCueLabPresets } from "./semanticCueLabPresets";

const NLI_MODEL_ID = "MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli";
const STORAGE_PREFIX = "orbit.semanticCueLab.v1";
const cueArraySchema = semanticCueSchema.array().min(1);

type EmbeddingMode = "manual" | "real";
type NliMode = "off" | "manual" | "real";

type ManualCueScores = {
  retrieval: number;
  entailment: number;
  contradiction: number;
};

type EvaluationEntry = {
  id: number;
  at: string;
  transcript: string;
  durationMs: number;
  result: SemanticCueRuntimeResult;
  error?: string;
};

type SttEngineOption = { id: LiveSttEngineId; label: string };

const sttEngineOptions: SttEngineOption[] = [
  { id: "web-speech", label: "Web Speech (다운로드 없음)" },
  { id: "sherpa", label: "Sherpa (온디바이스)" },
  { id: "moonshine", label: "Moonshine (온디바이스)" },
  { id: "openai-realtime", label: "OpenAI Realtime (API 필요)" }
];

export function SemanticCueLabApp() {
  const [cueJson, setCueJson] = useState<string>(() =>
    loadString("cues", presetCueJson(0))
  );
  const [transcript, setTranscript] = useState<string>(
    () => semanticCueLabPresets[0]?.transcript ?? ""
  );
  const [runtimeConfig, setRuntimeConfig] = useState<SemanticCueRuntimeConfig>(
    () => loadJson("runtimeConfig", semanticCueRuntimeConfig)
  );
  const [combinerConfig, setCombinerConfig] =
    useState<SemanticCueCombinerConfig>(() =>
      loadJson("combinerConfig", defaultSemanticCueCombinerConfig)
    );
  const [embeddingMode, setEmbeddingMode] = useState<EmbeddingMode>("manual");
  const [nliMode, setNliMode] = useState<NliMode>("manual");
  const [manualScores, setManualScores] = useState<
    Record<string, ManualCueScores>
  >({});
  const [coveredCueIds, setCoveredCueIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [selectedSlideId, setSelectedSlideId] = useState<string>("");
  const [runtimeNonce, setRuntimeNonce] = useState(0);

  const [embeddingStatus, setEmbeddingStatus] = useState("미로드");
  const [realEmbeddingIndex, setRealEmbeddingIndex] =
    useState<SemanticCueEmbeddingIndex | null>(null);
  const [nliStatus, setNliStatus] = useState("미로드");
  const [realNliProvider, setRealNliProvider] =
    useState<SemanticCueNliProvider | null>(null);

  const [sttEngine, setSttEngine] = useState<LiveSttEngineId>("web-speech");
  const [recording, setRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [sttError, setSttError] = useState("");

  const [history, setHistory] = useState<EvaluationEntry[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const manualScoresRef = useRef(manualScores);
  manualScoresRef.current = manualScores;
  const evalSeqRef = useRef(0);
  const entryIdRef = useRef(0);
  const generationRef = useRef(0);
  const sttPortRef = useRef<LiveSttPort | null>(null);
  const sttStreamRef = useRef<MediaStream | null>(null);

  const cueParse = useMemo(() => parseCues(cueJson), [cueJson]);
  const cues: SemanticCue[] = cueParse.ok ? cueParse.cues : [];
  const slideIds = useMemo(
    () => Array.from(new Set(cues.map((cue) => cue.slideId))),
    [cues]
  );
  const activeSlideId =
    slideIds.includes(selectedSlideId) ? selectedSlideId : slideIds[0] ?? "";
  const slideCues = cues.filter((cue) => cue.slideId === activeSlideId);

  useEffect(() => saveString("cues", cueJson), [cueJson]);
  useEffect(() => saveString("runtimeConfig", JSON.stringify(runtimeConfig)), [runtimeConfig]);
  useEffect(
    () => saveString("combinerConfig", JSON.stringify(combinerConfig)),
    [combinerConfig]
  );

  const manualEmbeddingIndex = useMemo<SemanticCueEmbeddingIndex>(
    () => ({
      async prepareSlide(input) {
        return {
          slideId: input.slideId,
          signature: "manual",
          cueCount: input.cues.length,
          vectorCount: 0
        };
      },
      async retrieveScores() {
        return new Map(
          Object.entries(manualScoresRef.current).map(([cueId, scores]) => [
            cueId,
            clamp01(scores.retrieval)
          ])
        );
      }
    }),
    []
  );

  const manualNliProvider = useMemo<SemanticCueNliProvider>(
    () => ({
      async load() {
        return { provider: "mock", status: "ready", modelId: "manual-lab" };
      },
      async evaluate(input) {
        return input.hypotheses.map((hypothesis) => {
          const scores = manualScoresRef.current[hypothesis.cueId];
          const entailmentScore = clamp01(scores?.entailment ?? 0.1);
          const contradictionScore = clamp01(scores?.contradiction ?? 0.1);
          return {
            cueId: hypothesis.cueId,
            hypothesis: hypothesis.hypothesis,
            provider: "mock" as const,
            modelId: "manual-lab",
            latencyMs: 0,
            entailmentScore,
            contradictionScore,
            neutralScore: clamp01(1 - entailmentScore - contradictionScore)
          };
        });
      }
    }),
    []
  );

  const runtime = useMemo(() => {
    const embeddingIndex =
      embeddingMode === "real"
        ? realEmbeddingIndex ?? undefined
        : manualEmbeddingIndex;
    const provider =
      nliMode === "real"
        ? realNliProvider ?? undefined
        : nliMode === "manual"
          ? manualNliProvider
          : undefined;
    return createSemanticCueRuntime({
      enabled: nliMode !== "off",
      deckId: "deck_lab",
      nliMode: "active",
      config: runtimeConfig,
      combinerConfig,
      ...(provider === undefined ? {} : { provider }),
      ...(embeddingIndex === undefined ? {} : { embeddingIndex })
    });
  }, [
    embeddingMode,
    nliMode,
    realEmbeddingIndex,
    realNliProvider,
    manualEmbeddingIndex,
    manualNliProvider,
    runtimeConfig,
    combinerConfig,
    runtimeNonce
  ]);

  const loadRealEmbedding = useCallback(async () => {
    setEmbeddingStatus("E5 모델 로딩 중…");
    try {
      const service = await getE5EmbeddingService((progress) => {
        if (progress.progress !== undefined) {
          setEmbeddingStatus(
            `E5 로딩 ${Math.round(progress.progress)}% (${progress.file ?? ""})`
          );
        }
      });
      setRealEmbeddingIndex(createSemanticCueEmbeddingIndex({ embeddingService: service }));
      setEmbeddingStatus("E5 준비 완료");
    } catch (error) {
      setEmbeddingStatus(`E5 로드 실패: ${describeError(error)}`);
    }
  }, []);

  const loadRealNli = useCallback(async () => {
    setNliStatus("NLI 모델 로딩 중… (최초 1회, 수백 MB)");
    try {
      const provider = createBrowserTransformersSemanticCueNliProvider({
        modelId: NLI_MODEL_ID,
        loadOnEvaluate: true
      });
      const info = await provider.load();
      if (info.status !== "ready") {
        setNliStatus(`NLI 로드 실패: ${info.error ?? info.status}`);
        return;
      }
      setRealNliProvider(provider);
      setNliStatus(`NLI 준비 완료 (${info.device ?? "?"}, ${info.modelId ?? ""})`);
    } catch (error) {
      setNliStatus(`NLI 로드 실패: ${describeError(error)}`);
    }
  }, []);

  const evaluate = useCallback(async () => {
    if (!cueParse.ok || !activeSlideId) {
      return;
    }
    const seq = ++evalSeqRef.current;
    setEvaluating(true);
    const startedAt = performance.now();
    try {
      await runtime.prepareSlide({ slideId: activeSlideId, cues });
      const result = await runtime.evaluateFinalResult({
        deckId: "deck_lab",
        slideId: activeSlideId,
        transcript,
        isFinal: true,
        cues,
        coveredCueIds,
        phraseMatched: false,
        keywordCoverage: 0,
        semanticDecisionReason: "no_match",
        semanticMatchingEnabled: true,
        generation: ++generationRef.current,
        nowMs: Date.now()
      });
      if (seq !== evalSeqRef.current) {
        return;
      }
      pushEntry({
        id: ++entryIdRef.current,
        at: new Date().toLocaleTimeString("ko-KR"),
        transcript,
        durationMs: Math.round(performance.now() - startedAt),
        result
      });
    } catch (error) {
      if (seq !== evalSeqRef.current) {
        return;
      }
      pushEntry({
        id: ++entryIdRef.current,
        at: new Date().toLocaleTimeString("ko-KR"),
        transcript,
        durationMs: Math.round(performance.now() - startedAt),
        result: {
          decisions: [],
          capabilityUpdates: [],
          debugEvent: undefined as never
        },
        error: describeError(error)
      });
    } finally {
      if (seq === evalSeqRef.current) {
        setEvaluating(false);
      }
    }

    function pushEntry(entry: EvaluationEntry) {
      setHistory((entries) => [entry, ...entries].slice(0, 30));
      setSelectedEntryId(entry.id);
    }
  }, [runtime, cueParse.ok, cues, activeSlideId, transcript, coveredCueIds]);

  useEffect(() => {
    if (!transcript.trim()) {
      return;
    }
    const timer = setTimeout(() => void evaluate(), 600);
    return () => clearTimeout(timer);
  }, [transcript, evaluate]);

  const startStt = useCallback(async () => {
    setSttError("");
    try {
      const port = createLiveSttPort(sttEngine);
      sttPortRef.current = port;
      port.onResult((result) => {
        if (result.isFinal) {
          setInterimText("");
          setTranscript((current) =>
            current.trim() ? `${current.trim()} ${result.text}` : result.text
          );
        } else {
          setInterimText(result.text);
        }
      });
      port.onError((error) => {
        setSttError(`${error.code}: ${error.message}`);
      });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sttStreamRef.current = stream;
      await port.start({ language: "ko", audioSource: stream });
      setRecording(true);
    } catch (error) {
      setSttError(describeError(error));
      await stopSttInternal(sttPortRef, sttStreamRef);
      setRecording(false);
    }
  }, [sttEngine]);

  const stopStt = useCallback(async () => {
    await stopSttInternal(sttPortRef, sttStreamRef);
    setRecording(false);
    setInterimText("");
  }, []);

  useEffect(
    () => () => {
      void stopSttInternal(sttPortRef, sttStreamRef);
    },
    []
  );

  const selectedEntry =
    history.find((entry) => entry.id === selectedEntryId) ?? history[0];

  return (
    <div className="lab-root">
      <header className="lab-header">
        <h1>Semantic Cue Lab</h1>
        <p>
          필수 문맥(Semantic Cue) 커버 판별 파이프라인 실험 페이지 — 후보 선택 →
          basic 판정 → NLI → 점수 결합 전 과정을 단계별로 추적합니다. (개발 전용)
        </p>
      </header>

      <div className="lab-columns">
        <section className="lab-panel">
          <h2>1. 필수 문맥(큐) 정의</h2>
          <div className="lab-row">
            {semanticCueLabPresets.map((preset, index) => (
              <button
                key={preset.id}
                type="button"
                title={preset.description}
                onClick={() => {
                  setCueJson(presetCueJson(index));
                  if (preset.transcript) {
                    setTranscript(preset.transcript);
                  }
                  setCoveredCueIds(new Set());
                  setManualScores({});
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <textarea
            className="lab-json"
            value={cueJson}
            spellCheck={false}
            onChange={(event) => setCueJson(event.target.value)}
            rows={16}
          />
          {!cueParse.ok && <p className="lab-error">{cueParse.error}</p>}
          {cueParse.ok && (
            <p className="lab-hint">
              큐 {cues.length}개 · 슬라이드 {slideIds.length}개 파싱 완료
              (reviewStatus=approved, freshness=current인 큐만 후보가 됩니다)
            </p>
          )}

          {slideIds.length > 1 && (
            <label className="lab-field">
              평가 대상 슬라이드
              <select
                value={activeSlideId}
                onChange={(event) => setSelectedSlideId(event.target.value)}
              >
                {slideIds.map((slideId) => (
                  <option key={slideId} value={slideId}>
                    {slideId}
                  </option>
                ))}
              </select>
            </label>
          )}

          {slideCues.length > 0 && (
            <>
              <h3>이미 커버된 큐로 취급</h3>
              <div className="lab-row lab-wrap">
                {slideCues.map((cue) => (
                  <label key={cue.cueId} className="lab-check">
                    <input
                      type="checkbox"
                      checked={coveredCueIds.has(cue.cueId)}
                      onChange={(event) => {
                        setCoveredCueIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) {
                            next.add(cue.cueId);
                          } else {
                            next.delete(cue.cueId);
                          }
                          return next;
                        });
                      }}
                    />
                    {cue.reportLabel ?? cue.cueId}
                  </label>
                ))}
              </div>
            </>
          )}

          <h2>2. 모델 모드</h2>
          <div className="lab-field-grid">
            <label className="lab-field">
              임베딩 (retrieval 점수)
              <select
                value={embeddingMode}
                onChange={(event) => {
                  const mode = event.target.value as EmbeddingMode;
                  setEmbeddingMode(mode);
                  if (mode === "real" && !realEmbeddingIndex) {
                    void loadRealEmbedding();
                  }
                }}
              >
                <option value="manual">수동 점수 입력</option>
                <option value="real">실제 E5 임베딩</option>
              </select>
            </label>
            <label className="lab-field">
              NLI (entailment 판정)
              <select
                value={nliMode}
                onChange={(event) => {
                  const mode = event.target.value as NliMode;
                  setNliMode(mode);
                  if (mode === "real" && !realNliProvider) {
                    void loadRealNli();
                  }
                }}
              >
                <option value="manual">수동 점수 입력</option>
                <option value="real">실제 브라우저 NLI</option>
                <option value="off">끔 (basic 판정만)</option>
              </select>
            </label>
          </div>
          {embeddingMode === "real" && (
            <p className="lab-hint">임베딩: {embeddingStatus}</p>
          )}
          {nliMode === "real" && <p className="lab-hint">NLI: {nliStatus}</p>}

          {(embeddingMode === "manual" || nliMode === "manual") &&
            slideCues.length > 0 && (
              <>
                <h3>수동 점수 (큐별)</h3>
                <table className="lab-table">
                  <thead>
                    <tr>
                      <th>큐</th>
                      {embeddingMode === "manual" && <th>retrieval</th>}
                      {nliMode === "manual" && (
                        <>
                          <th>entailment</th>
                          <th>contradiction</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {slideCues.map((cue) => {
                      const scores = manualScores[cue.cueId] ?? {
                        retrieval: 0,
                        entailment: 0.1,
                        contradiction: 0.1
                      };
                      const update = (patch: Partial<ManualCueScores>) => {
                        setManualScores((current) => ({
                          ...current,
                          [cue.cueId]: { ...scores, ...patch }
                        }));
                      };
                      return (
                        <tr key={cue.cueId}>
                          <td>{cue.reportLabel ?? cue.cueId}</td>
                          {embeddingMode === "manual" && (
                            <td>
                              <ScoreInput
                                value={scores.retrieval}
                                onChange={(value) => update({ retrieval: value })}
                              />
                            </td>
                          )}
                          {nliMode === "manual" && (
                            <>
                              <td>
                                <ScoreInput
                                  value={scores.entailment}
                                  onChange={(value) =>
                                    update({ entailment: value })
                                  }
                                />
                              </td>
                              <td>
                                <ScoreInput
                                  value={scores.contradiction}
                                  onChange={(value) =>
                                    update({ contradiction: value })
                                  }
                                />
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}

          <ConfigPanel
            runtimeConfig={runtimeConfig}
            combinerConfig={combinerConfig}
            onRuntimeConfigChange={setRuntimeConfig}
            onCombinerConfigChange={setCombinerConfig}
          />
        </section>

        <section className="lab-panel">
          <h2>3. 발화 입력</h2>
          <div className="lab-row">
            <select
              value={sttEngine}
              disabled={recording}
              onChange={(event) =>
                setSttEngine(event.target.value as LiveSttEngineId)
              }
            >
              {sttEngineOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {recording ? (
              <button type="button" className="lab-rec" onClick={() => void stopStt()}>
                ■ 마이크 중지
              </button>
            ) : (
              <button type="button" onClick={() => void startStt()}>
                ● 마이크 시작
              </button>
            )}
            <button type="button" onClick={() => setTranscript("")}>
              발화 지우기
            </button>
          </div>
          {sttError && <p className="lab-error">{sttError}</p>}
          <textarea
            className="lab-transcript"
            value={transcript}
            placeholder="발표 발화를 입력하거나 붙여넣으세요. 마이크를 켜면 최종 인식 결과가 여기에 누적됩니다."
            onChange={(event) => setTranscript(event.target.value)}
            rows={6}
          />
          {interimText && <p className="lab-interim">인식 중: {interimText}</p>}
          <div className="lab-row">
            <button
              type="button"
              className="lab-primary"
              disabled={!cueParse.ok || evaluating}
              onClick={() => void evaluate()}
            >
              {evaluating ? "평가 중…" : "지금 평가"}
            </button>
            <button
              type="button"
              title="런타임 내부 covered 누적/NLI 스로틀 상태를 초기화합니다"
              onClick={() => setRuntimeNonce((nonce) => nonce + 1)}
            >
              런타임 리셋
            </button>
            <button type="button" onClick={() => setHistory([])}>
              기록 지우기
            </button>
          </div>

          <h2>4. 판별 결과 추적</h2>
          {history.length === 0 && (
            <p className="lab-hint">아직 평가 기록이 없습니다.</p>
          )}
          {history.length > 0 && (
            <div className="lab-history">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={
                    entry.id === selectedEntry?.id
                      ? "lab-history-item selected"
                      : "lab-history-item"
                  }
                  onClick={() => setSelectedEntryId(entry.id)}
                >
                  <span>#{entry.id}</span> {entry.at} ·{" "}
                  {entry.error
                    ? "오류"
                    : summarizeDecisions(entry.result)}{" "}
                  · {entry.durationMs}ms
                </button>
              ))}
            </div>
          )}
          {selectedEntry && <EvaluationTrace entry={selectedEntry} />}
        </section>
      </div>
    </div>
  );
}

function EvaluationTrace({ entry }: { entry: EvaluationEntry }) {
  if (entry.error) {
    return <p className="lab-error">평가 실패: {entry.error}</p>;
  }
  const event = entry.result.debugEvent;
  return (
    <div className="lab-trace">
      <h3>후보 선택 (candidate selector)</h3>
      {event.candidates.length === 0 ? (
        <p className="lab-hint">후보 없음</p>
      ) : (
        <table className="lab-table">
          <thead>
            <tr>
              <th>큐</th>
              <th>lexical</th>
              <th>concept</th>
              <th>embedding</th>
              <th>NLI 대상</th>
              <th>스킵 사유</th>
            </tr>
          </thead>
          <tbody>
            {event.candidates.map((candidate) => (
              <tr key={candidate.cueId}>
                <td title={candidate.meaning}>{candidate.cueId}</td>
                <td>{candidate.lexicalScore}</td>
                <td>{candidate.conceptCoverage}</td>
                <td>{candidate.embeddingScore}</td>
                <td>{candidate.selectedForNli ? "O" : "-"}</td>
                <td>{candidate.nliSkippedReason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {event.nli && (
        <>
          <h3>
            NLI ({event.nli.provider}
            {event.nli.modelId ? ` · ${event.nli.modelId}` : ""} ·{" "}
            {event.nli.latencyMs}ms)
          </h3>
          <p className="lab-premise">premise: {event.nli.premise}</p>
          <table className="lab-table">
            <thead>
              <tr>
                <th>큐</th>
                <th>가설</th>
                <th>entail</th>
                <th>neutral</th>
                <th>contra</th>
              </tr>
            </thead>
            <tbody>
              {event.nli.hypotheses.map((hypothesis, index) => (
                <tr key={`${hypothesis.cueId}_${index}`}>
                  <td>{hypothesis.cueId}</td>
                  <td>{hypothesis.hypothesis}</td>
                  <td>{round3(hypothesis.entailmentScore)}</td>
                  <td>{round3(hypothesis.neutralScore)}</td>
                  <td>{round3(hypothesis.contradictionScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {event.fallback?.used && (
        <p className="lab-warning">
          폴백 사용됨: {event.fallback.reason} (측정 모드:{" "}
          {event.fallback.measurementMode})
        </p>
      )}

      <h3>최종 판정 (decisions)</h3>
      {entry.result.decisions.length === 0 ? (
        <p className="lab-hint">
          판정 없음 — reasonCodes: {event.decision.reasonCodes.join(", ")}
        </p>
      ) : (
        <table className="lab-table">
          <thead>
            <tr>
              <th>큐</th>
              <th>라벨</th>
              <th>final</th>
              <th>lex</th>
              <th>concept</th>
              <th>embed</th>
              <th>matchedBy</th>
              <th>mode</th>
              <th>사유 코드</th>
            </tr>
          </thead>
          <tbody>
            {entry.result.decisions.map((decision) => (
              <tr key={decision.cueId}>
                <td>{decision.cueId}</td>
                <td>
                  <span className={`lab-label lab-label-${decision.label}`}>
                    {decision.label}
                  </span>
                </td>
                <td>{decision.finalScore}</td>
                <td>{decision.lexicalScore}</td>
                <td>{decision.conceptCoverage}</td>
                <td>{decision.embeddingScore}</td>
                <td>{decision.matchedBy}</td>
                <td>
                  {decision.measurementMode}
                  {decision.fallbackUsed ? " (fallback)" : ""}
                </td>
                <td>{decision.reasonCodes.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {entry.result.capabilityUpdates.length > 0 && (
        <details>
          <summary>capability 전이 ({entry.result.capabilityUpdates.length})</summary>
          <pre className="lab-pre">
            {JSON.stringify(entry.result.capabilityUpdates, null, 2)}
          </pre>
        </details>
      )}
      <details>
        <summary>디버그 이벤트 원본 JSON</summary>
        <pre className="lab-pre">{JSON.stringify(event, null, 2)}</pre>
      </details>
    </div>
  );
}

type ConfigFieldDescriptor = {
  path: string[];
  label: string;
  step?: number;
};

const runtimeConfigFields: ConfigFieldDescriptor[] = [
  { path: ["candidateWeights", "lexical"], label: "가중치: lexical" },
  { path: ["candidateWeights", "conceptCoverage"], label: "가중치: concept" },
  { path: ["candidateWeights", "retrieval"], label: "가중치: retrieval" },
  { path: ["candidateWeights", "importance"], label: "가중치: importance" },
  { path: ["candidateEligibility", "lexical"], label: "후보 자격: lexical ≥" },
  { path: ["candidateEligibility", "retrieval"], label: "후보 자격: retrieval ≥" },
  { path: ["maxCandidates"], label: "최대 후보 수", step: 1 },
  { path: ["maxNliCandidates"], label: "최대 NLI 후보 수", step: 1 },
  { path: ["maxHypothesesPerCue"], label: "큐당 최대 가설 수", step: 1 },
  { path: ["maxNliTokens"], label: "NLI premise 최대 토큰", step: 8 },
  { path: ["nliTimeoutMs"], label: "NLI 타임아웃(ms)", step: 100 },
  { path: ["nliThrottleMs"], label: "NLI 스로틀(ms)", step: 100 },
  { path: ["basicCoveredRetrieval"], label: "basic covered: retrieval ≥" },
  { path: ["basicPartialScore"], label: "basic partial: score ≥" },
  { path: ["basicPartialConceptCoverage"], label: "basic partial: concept ≥" }
];

const combinerConfigFields: ConfigFieldDescriptor[] = [
  { path: ["weights", "lexical"], label: "결합 가중치: lexical" },
  { path: ["weights", "conceptCoverage"], label: "결합 가중치: concept" },
  { path: ["weights", "embedding"], label: "결합 가중치: embedding" },
  { path: ["weights", "entailment"], label: "결합 가중치: entailment" },
  { path: ["contradictionThreshold"], label: "contradicted: contra ≥" },
  { path: ["coveredFinalScore"], label: "covered: final ≥" },
  { path: ["coveredEntailment"], label: "covered: entail ≥" },
  { path: ["partialFinalScore"], label: "partial: final ≥" },
  { path: ["entailmentFloorThreshold"], label: "entail 바닥 보정 발동 ≥" },
  { path: ["entailmentFloorScore"], label: "entail 바닥 보정 최소 final" },
  { path: ["entailmentReasonThreshold"], label: "사유 코드: entail ≥" },
  { path: ["conceptReasonThreshold"], label: "사유 코드: concept ≥" },
  { path: ["lexicalReasonThreshold"], label: "사유 코드: lexical ≥" },
  { path: ["embeddingReasonThreshold"], label: "사유 코드: embedding ≥" }
];

function ConfigPanel(props: {
  runtimeConfig: SemanticCueRuntimeConfig;
  combinerConfig: SemanticCueCombinerConfig;
  onRuntimeConfigChange: (config: SemanticCueRuntimeConfig) => void;
  onCombinerConfigChange: (config: SemanticCueCombinerConfig) => void;
}) {
  return (
    <details className="lab-config" open>
      <summary>
        <h2>파라미터 튜닝</h2>
      </summary>
      <div className="lab-row">
        <button
          type="button"
          onClick={() => {
            props.onRuntimeConfigChange(structuredClone(semanticCueRuntimeConfig));
            props.onCombinerConfigChange(
              structuredClone(defaultSemanticCueCombinerConfig)
            );
          }}
        >
          프로덕션 기본값으로 리셋
        </button>
      </div>
      <h3>후보 선택 / basic 판정</h3>
      <div className="lab-field-grid">
        {runtimeConfigFields.map((field) => (
          <NumberField
            key={field.path.join(".")}
            descriptor={field}
            value={readPath(props.runtimeConfig, field.path)}
            defaultValue={readPath(semanticCueRuntimeConfig, field.path)}
            onChange={(value) =>
              props.onRuntimeConfigChange(
                writePath(props.runtimeConfig, field.path, value)
              )
            }
          />
        ))}
      </div>
      <h3>점수 결합기 (NLI 이후)</h3>
      <div className="lab-field-grid">
        {combinerConfigFields.map((field) => (
          <NumberField
            key={field.path.join(".")}
            descriptor={field}
            value={readPath(props.combinerConfig, field.path)}
            defaultValue={readPath(defaultSemanticCueCombinerConfig, field.path)}
            onChange={(value) =>
              props.onCombinerConfigChange(
                writePath(props.combinerConfig, field.path, value)
              )
            }
          />
        ))}
      </div>
    </details>
  );
}

function NumberField(props: {
  descriptor: ConfigFieldDescriptor;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  const changed = props.value !== props.defaultValue;
  return (
    <label className={changed ? "lab-field lab-field-changed" : "lab-field"}>
      {props.descriptor.label}
      {changed && <span className="lab-changed-mark"> ✱</span>}
      <input
        type="number"
        step={props.descriptor.step ?? 0.01}
        value={props.value}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value)) {
            props.onChange(value);
          }
        }}
      />
    </label>
  );
}

function ScoreInput(props: { value: number; onChange: (value: number) => void }) {
  return (
    <span className="lab-score-input">
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <input
        type="number"
        min={0}
        max={1}
        step={0.01}
        value={props.value}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value)) {
            props.onChange(clamp01(value));
          }
        }}
      />
    </span>
  );
}

type CueParseResult =
  | { ok: true; cues: SemanticCue[] }
  | { ok: false; error: string };

function parseCues(json: string): CueParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return { ok: false, error: `JSON 파싱 실패: ${describeError(error)}` };
  }
  const parsed = cueArraySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `스키마 오류: ${issue?.path.join(".") ?? ""} — ${issue?.message ?? "unknown"}`
    };
  }
  return { ok: true, cues: parsed.data };
}

function summarizeDecisions(result: SemanticCueRuntimeResult) {
  if (result.decisions.length === 0) {
    return `판정 없음 (${result.debugEvent.decision.reasonCodes.join(",")})`;
  }
  return result.decisions
    .map((decision) => `${decision.cueId}=${decision.label}`)
    .join(", ");
}

async function stopSttInternal(
  portRef: { current: LiveSttPort | null },
  streamRef: { current: MediaStream | null }
) {
  const port = portRef.current;
  portRef.current = null;
  if (port) {
    try {
      await port.stop();
    } catch {
      // ignore
    }
    try {
      await port.dispose();
    } catch {
      // ignore
    }
  }
  const stream = streamRef.current;
  streamRef.current = null;
  stream?.getTracks().forEach((track) => track.stop());
}

function presetCueJson(index: number) {
  const preset = semanticCueLabPresets[index] ?? semanticCueLabPresets[0];
  return JSON.stringify(preset?.cues ?? [], null, 2);
}

function readPath(target: unknown, path: string[]): number {
  let current: unknown = target;
  for (const key of path) {
    current = (current as Record<string, unknown>)[key];
  }
  return current as number;
}

function writePath<T>(target: T, path: string[], value: number): T {
  const clone = structuredClone(target) as Record<string, unknown>;
  let cursor: Record<string, unknown> = clone;
  for (const key of path.slice(0, -1)) {
    cursor = cursor[key] as Record<string, unknown>;
  }
  const lastKey = path[path.length - 1];
  if (lastKey !== undefined) {
    cursor[lastKey] = value;
  }
  return clone as T;
}

function loadString(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveString(key: string, value: string) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}.${key}`, value);
  } catch {
    // ignore
  }
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}.${key}`);
    if (!raw) {
      return structuredClone(fallback);
    }
    return { ...structuredClone(fallback), ...(JSON.parse(raw) as T) };
  } catch {
    return structuredClone(fallback);
  }
}

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
