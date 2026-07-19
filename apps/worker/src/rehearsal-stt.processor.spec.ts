import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTranscriptionPronunciationContext,
  processRehearsalSttJob,
} from "./rehearsal-stt.processor";

const payload = {
  jobId: "job-1",
  projectId: "project-a",
  runId: "run-a",
  deckId: "deck-a",
  audioFileId: "file-audio",
};

const assetRow = {
  file_id: "file-audio",
  project_id: "project-a",
  storage_key: "projects/project-a/assets/file-audio/rehearsal.webm",
  mime_type: "audio/webm",
  original_name: "rehearsal.webm",
  purpose: "rehearsal-audio",
  status: "uploaded",
};

describe("buildTranscriptionPronunciationContext", () => {
  it("selects active high-confidence aliases within the provider budget", () => {
    const context = buildTranscriptionPronunciationContext({
      pronunciationLexicon: {
        schemaVersion: 1,
        generatorVersion: "test",
        deckId: "deck-a",
        deckVersion: 1,
        sourceHash: "0123456789abcdef",
        entries: [
          {
            id: "pron_openai",
            sourceText: "OpenAI",
            normalizedSource: "openai",
            canonicalText: "OpenAI",
            canonicalKey: "openai",
            category: "product",
            aliases: [
              {
                text: "오픈에이아이",
                normalizedText: "오픈에이아이",
                origin: "static",
                confidence: 1,
                enabled: true,
              },
              {
                text: "낮은신뢰도",
                normalizedText: "낮은신뢰도",
                origin: "llm",
                confidence: 0.4,
                enabled: true,
              },
            ],
            confidence: 1,
            status: "active",
            scriptOccurrences: [{ slideId: "slide_1", start: 0, end: 6 }],
          },
        ],
      },
    });

    expect(context).toEqual([{ source: "OpenAI", aliases: ["오픈에이아이"] }]);
  });
});

const deckRow = {
  version: 1,
  deck_json: {
    deckId: "deck_a",
    projectId: "project-a",
    title: "deck",
    version: 1,
    metadata: {
      language: "ko",
      locale: "ko-KR",
      sourceType: "manual",
    },
    theme: {
      accentColor: "#2563eb",
      backgroundColor: "#ffffff",
      textColor: "#111827",
      fontFamily: "Pretendard",
      typography: {
        titleFontFamily: "Pretendard",
        bodyFontFamily: "Pretendard",
        titleSize: 32,
        bodySize: 18,
      },
    },
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "slide",
        estimatedSeconds: 60,
        notes: "",
        style: {},
        elements: [],
        animations: [],
        actions: [],
        keywords: [
          {
            keywordId: "kw_1",
            text: "ORBIT",
            synonyms: ["오르빗"],
            abbreviations: [],
          },
        ],
      },
      {
        slideId: "slide_2",
        order: 2,
        title: "next slide",
        estimatedSeconds: 60,
        notes: "",
        style: {},
        elements: [],
        animations: [],
        keywords: [],
      },
    ],
  },
};

const volumeAnalysisFixture = {
  metricDefinitionVersion: 1,
  measurementState: "measured",
  reasonCode: null,
  averageDbfs: -22.4,
  baselineDbfs: -21.8,
  variationDb: 8.3,
  activeRatio: 0.76,
  issueSegments: [],
};

const unmeasuredVolumeAnalysisFixture = {
  metricDefinitionVersion: 1,
  measurementState: "unmeasured",
  reasonCode: "ANALYSIS_FAILED",
  averageDbfs: null,
  baselineDbfs: null,
  variationDb: null,
  activeRatio: null,
  issueSegments: [],
};

const silenceAnalysisFixture = {
  metricDefinitionVersion: 1,
  measurementState: "measured",
  reasonCode: null,
  detector: "silero-vad",
  detectorVersion: "6.2.1",
  speechThreshold: 0.5,
  minimumSilenceMs: 250,
  longSilenceMs: 1000,
  analysisWindowStartSeconds: 0.2,
  analysisWindowEndSeconds: 89.8,
  totalSilenceSeconds: 1.2,
  silenceRatio: 0.0134,
  longSilenceCount: 1,
  detectedSegmentCount: 1,
  segmentsTruncated: false,
  segments: [
    {
      category: "long",
      startSeconds: 1,
      endSeconds: 2.2,
      durationSeconds: 1.2,
    },
  ],
};

const unmeasuredSilenceAnalysisFixture = {
  metricDefinitionVersion: 1,
  measurementState: "unmeasured",
  reasonCode: "ANALYSIS_FAILED",
  detector: "silero-vad",
  detectorVersion: "6.2.1",
  speechThreshold: 0.5,
  minimumSilenceMs: 250,
  longSilenceMs: 1000,
  analysisWindowStartSeconds: null,
  analysisWindowEndSeconds: null,
  totalSilenceSeconds: null,
  silenceRatio: null,
  longSilenceCount: null,
  detectedSegmentCount: null,
  segmentsTruncated: false,
  segments: [],
};

describe("processRehearsalSttJob", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("transcribes, analyzes, stores results, and retains the raw audio", async () => {
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([deckRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([jobRow("running", 85, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        jobRow(
          "succeeded",
          100,
          {
            transcriptRetained: true,
            transcript: null,
            report: {
              reportId: "report_run-a",
              transcriptRetained: true,
              transcript: null,
            },
            rawAudioDeletedAt: null,
          },
          null,
        ),
      ])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              projectId: "project-a",
              fileId: "file-audio",
              transcript: "안녕하세요 ORBIT 발표입니다",
              language: "ko-KR",
              provider: "fake",
              model: "fake-transcriber",
              volumeAnalysis: volumeAnalysisFixture,
              silenceAnalysis: silenceAnalysisFixture,
              durationSeconds: 90,
              segments: [{ text: "안녕하세요 ORBIT 발표입니다" }],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              wordsPerMinute: 120,
              fillerWordCount: 1,
              longSilenceCount: 1,
              keywordCoverage: 0.5,
              speedSamples: [
                { startSecond: 0, endSecond: 3.5, wordsPerMinute: 120 },
              ],
              fillerWordDetails: [{ word: "음", count: 1 }],
              missedKeywords: [
                { slideId: "slide_1", keywordId: "kw_1", text: "ORBIT" },
              ],
              slideInsights: [
                {
                  slideId: "slide_1",
                  fillerWordCount: 1,
                  longSilenceCount: 1,
                  speakingRate: {
                    metricDefinitionVersion: 1,
                    measurementState: "measured",
                    reasonCode: null,
                    charactersPerSecond: 4.62,
                    baselineCharactersPerSecond: 4.24,
                    relativeRateRatio: 1.0896,
                    paceCategory: "similar",
                    activeSpeechSeconds: 12.4,
                    characterCount: 57,
                  },
                },
              ],
              aiSummary: {
                headline: "도입부 핵심 메시지가 약했습니다.",
                paragraphs: [
                  "발표 흐름은 안정적이었지만 ORBIT 키워드가 빠졌습니다.",
                  "다음 연습에서는 도입부 핵심 문장을 고정하세요.",
                ],
              },
              coaching: { status: "succeeded", summary: "clear" },
            }),
          ),
        ),
    );
    const silenceEvents = vi.fn();
    const speakingRateEvents = vi.fn();

    const job = await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
      undefined,
      undefined,
      silenceEvents,
      speakingRateEvents,
    );

    expect(job.status).toBe("succeeded");
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/audio/transcribe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8000/rehearsal/analyze",
      expect.objectContaining({ method: "POST" }),
    );
    expect(storage.removeObject).not.toHaveBeenCalled();
    expect(silenceEvents).toHaveBeenCalledWith({
      event: "rehearsal.silence_analysis.completed",
      projectId: "project-a",
      runId: "run-a",
      jobId: "job-1",
      measurementState: "measured",
      longSilenceCount: 1,
      totalSilenceSeconds: 1.2,
      silenceRatio: 0.0134,
      reasonCode: null,
      segments: silenceAnalysisFixture.segments,
    });
    expect(speakingRateEvents).toHaveBeenCalledWith({
      event: "rehearsal.slide_speaking_rate.completed",
      projectId: "project-a",
      runId: "run-a",
      jobId: "job-1",
      measuredSlideCount: 1,
      slowerSlideCount: 0,
      similarSlideCount: 1,
      fasterSlideCount: 0,
      unmeasuredSlideCount: 0,
    });
    const analyzeRequest = JSON.parse(
      String(
        (vi.mocked(fetch).mock.calls[1]?.[1] as RequestInit | undefined)?.body,
      ),
    );
    expect(analyzeRequest.language).toBe("ko-KR");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("report_json"),
      expect.arrayContaining([
        expect.stringContaining('"reportId":"report_run-a"'),
        expect.stringContaining(
          '"volumeAnalysis":{"metricDefinitionVersion":1,"measurementState":"measured"',
        ),
        expect.stringContaining(
          '"speedSamples":[{"startSecond":0,"endSecond":3.5,"wordsPerMinute":120}]',
        ),
        expect.stringContaining(
          '"missedKeywords":[{"slideId":"slide_1","keywordId":"kw_1","text":"ORBIT"}]',
        ),
        expect.stringContaining(
          '"utteranceOutcomes":[{"slideId":"slide_1","kind":"paraphrased","sentenceId":"sentence_1","similarity":0.93}]',
        ),
        expect.stringContaining(
          '"semanticCueDecisions":[{"slideId":"slide_1","cueId":"scue_intro_1"',
        ),
        expect.stringContaining(
          '"slideTimings":[{"slideId":"slide_1","targetSeconds":60,"actualSeconds":45}]',
        ),
        expect.stringContaining(
          '"speakingRate":{"metricDefinitionVersion":1',
        ),
        expect.stringContaining('"paceCategory":"similar"'),
        true,
      ]),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE jobs"),
      expect.arrayContaining([
        "job-1",
        "succeeded",
        100,
        "리포트 생성 완료",
        expect.objectContaining({
          transcriptRetained: true,
          segmentCount: 1,
          rawAudioDeletedAt: null,
          report: expect.objectContaining({
            reportId: "report_run-a",
            transcriptRetained: true,
            transcript: null,
            aiSummary: {
              headline: "도입부 핵심 메시지가 약했습니다.",
              paragraphs: [
                "발표 흐름은 안정적이었지만 ORBIT 키워드가 빠졌습니다.",
                "다음 연습에서는 도입부 핵심 문장을 고정하세요.",
              ],
            },
            fillerWordDetails: [{ word: "음", count: 1 }],
            silenceAnalysis: silenceAnalysisFixture,
            semanticCueDecisions: [
              expect.objectContaining({
                slideId: "slide_1",
                cueId: "scue_intro_1",
                label: "covered",
              }),
            ],
          }),
        }),
        null,
      ]),
    );
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO storage_deletion_outbox"),
      ),
    ).toBe(false);
  });

  it("fails without deleting raw audio when transcript artifact storage fails", async () => {
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([deckRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([
        jobRow(
          "failed",
          65,
          null,
          {
            code: "REHEARSAL_TRANSCRIPT_STORAGE_FAILED",
            message: "Rehearsal transcript artifact storage failed."
          }
        )
      ]);
    const storage = createStorage();
    vi.mocked(storage.putObject).mockRejectedValueOnce(
      new Error("transcript storage unavailable")
    );
    const events = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runId: "run-a",
            projectId: "project-a",
            fileId: "file-audio",
            transcript: "전사 저장 실패 테스트",
            language: "ko",
            provider: "fake",
            model: "fake-transcriber",
            volumeAnalysis: volumeAnalysisFixture,
            silenceAnalysis: silenceAnalysisFixture,
            durationSeconds: 3,
            segments: [{ text: "전사 저장 실패 테스트" }]
          })
        )
      )
    );

    const job = await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
      undefined,
      undefined,
      undefined,
      undefined,
      events
    );

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("REHEARSAL_TRANSCRIPT_STORAGE_FAILED");
    expect(storage.removeObject).toHaveBeenCalledWith(
      "rehearsals/2026-07-16/project-a/run-a/transcript.json"
    );
    expect(storage.removeObject).not.toHaveBeenCalledWith(assetRow.storage_key);
    expect(events).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: "rehearsal.transcript_artifacts.started",
        artifactCount: 2
      })
    );
    expect(events).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: "rehearsal.transcript_artifacts.failed",
        errorCode: "REHEARSAL_TRANSCRIPT_STORAGE_FAILED"
      })
    );
  });

  it("replays patch-only deck updates and normalizes analyze keyword DTOs", async () => {
    const updatedKeywordPatchOperations = [
      {
        type: "replace_keywords",
        slideId: "slide_1",
        keywords: [
          {
            keywordId: "kw_1",
            text: "LATEST",
            synonyms: ["최신"],
            abbreviations: [],
            requiredOccurrenceIds: [],
          },
        ],
      },
    ];
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([{ ...deckRow, version: 1 }])
      .mockResolvedValueOnce([
        {
          project_id: "project-a",
          deck_id: "deck-a",
          before_version: 1,
          after_version: 2,
          source: "user",
          operations: updatedKeywordPatchOperations,
        },
      ])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([jobRow("running", 85, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        jobRow(
          "succeeded",
          100,
          {
            transcriptRetained: true,
            transcript: null,
            report: {
              reportId: "report_run-a",
              transcriptRetained: true,
              transcript: null,
            },
            rawAudioDeletedAt: null,
          },
          null,
        ),
      ])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runId: "run-a",
            projectId: "project-a",
            fileId: "file-audio",
            transcript: "안녕하세요 LATEST 발표입니다",
            language: "ko-KR",
            provider: "fake",
            model: "fake-transcriber",
            volumeAnalysis: volumeAnalysisFixture,
            silenceAnalysis: silenceAnalysisFixture,
            durationSeconds: 3.5,
            segments: [{ text: "안녕하세요 LATEST 발표입니다" }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runId: "run-a",
            wordsPerMinute: 120,
            fillerWordCount: 0,
            longSilenceCount: 1,
            keywordCoverage: 1,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
    );

    const analyzeCall = fetchMock.mock.calls[1];
    const analyzeBody = JSON.parse(String(analyzeCall?.[1]?.body));
    expect(analyzeBody.deckKeywords).toEqual([
      {
        slideId: "slide_1",
        keywordId: "kw_1",
        text: "LATEST",
        synonyms: ["최신"],
        abbreviations: [],
        required: true,
      },
    ]);
  });

  it("uses the immutable run snapshot without reading the edited live deck", async () => {
    const snapshot = evaluationSnapshot();
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow(runMetaRow().meta_json, snapshot)])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([jobRow("running", 85, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("succeeded", 100, {}, null)])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    const events = vi.fn();
    const transcriptCache = {
      set: vi.fn(async () => undefined),
      setSemanticEvidence: vi.fn(async () => undefined),
      getSemanticEvidence: vi.fn(async () => null),
      close: vi.fn(async () => undefined),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runId: "run-a",
            projectId: "project-a",
            fileId: "file-audio",
            transcript: "snapshot keyword를 설명했습니다",
            language: "ko-KR",
            provider: "fake",
            model: "fake-transcriber",
            volumeAnalysis: volumeAnalysisFixture,
            silenceAnalysis: silenceAnalysisFixture,
            durationSeconds: 90,
            segments: [
              {
                text: "snapshot keyword를 설명했습니다",
                startSeconds: 0,
                endSeconds: 3.5,
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runId: "run-a",
            wordsPerMinute: 120,
            fillerWordCount: 0,
            longSilenceCount: 1,
            keywordCoverage: 1,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            semanticEvaluation: {
              state: "succeeded",
              measurementMode: "basic",
              reasons: [],
              retryable: false,
            },
            semanticCueOutcomes: [semanticOutcome()],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
      transcriptCache,
      events,
    );

    const transcribeBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    );
    expect(transcribeBody.pronunciationContext).toEqual([
      { source: "SNAPSHOT", aliases: ["스냅샷"] },
    ]);
    const analyzeBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(analyzeBody.pronunciationContext).toEqual([
      { source: "SNAPSHOT", aliases: ["스냅샷"] },
    ]);
    expect(analyzeBody.deckKeywords).toEqual([
      {
        slideId: "slide_1",
        keywordId: "kw_snapshot",
        text: "SNAPSHOT",
        synonyms: ["고정 키워드"],
        abbreviations: [],
        required: true,
      },
    ]);
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("FROM decks")),
    ).toBe(false);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://localhost:8000/rehearsal/analyze-semantic-cues",
      expect.objectContaining({ method: "POST" }),
    );
    const semanticBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(semanticBody).toMatchObject({
      runId: "run-a",
      evaluationSnapshot: snapshot,
      segments: [
        {
          startMs: 0,
          endMs: 3500,
          text: "snapshot keyword를 설명했습니다",
        },
      ],
      slideTimeline: [
        { slideId: "slide_1", enteredAtMs: 0, exitedAtMs: 45000 },
        { slideId: "slide_2", enteredAtMs: 45000 },
      ],
    });
    expect(semanticBody.provisionalDecisions[0]).toMatchObject({
      cueId: "scue_intro_1",
      label: "covered",
    });
    expect(events).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: "rehearsal.semantic_evaluation.started",
      }),
    );
    expect(transcriptCache.setSemanticEvidence).toHaveBeenCalledWith("run-a", {
      segments: [
        {
          startMs: 0,
          endMs: 3500,
          text: "snapshot keyword를 설명했습니다",
        },
      ],
    });
    expect(events).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: "rehearsal.semantic_evaluation.succeeded",
        reasons: [],
      }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("report_json"),
      expect.arrayContaining([
        expect.stringContaining(
          '"slideTimings":[{"slideId":"slide_1","targetSeconds":75,"actualSeconds":45}]',
        ),
        expect.stringContaining(
          '"semanticEvaluation":{"state":"succeeded","measurementMode":"basic","reasons":[],"retryable":false}',
        ),
        expect.stringContaining(
          '"semanticCueOutcomes":[{"slideId":"slide_1","cueId":"scue_snapshot"',
        ),
      ]),
    );
  });

  it("semantic endpoint 실패에도 delivery report와 reason 있는 unmeasured outcome을 저장한다", async () => {
    const snapshot = evaluationSnapshot();
    snapshot.slides[0]!.keywords = [];
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow(runMetaRow().meta_json, snapshot)])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([jobRow("running", 85, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("succeeded", 100, {}, null)])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    const events = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              projectId: "project-a",
              fileId: "file-audio",
              transcript: "전달 분석은 정상 완료됐습니다",
              language: "ko-KR",
              provider: "fake",
              model: "fake-transcriber",
              volumeAnalysis: volumeAnalysisFixture,
              silenceAnalysis: silenceAnalysisFixture,
              durationSeconds: 10,
              segments: [
                {
                  text: "전달 분석은 정상 완료됐습니다",
                  startSeconds: 0,
                  endSeconds: 3,
                },
              ],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              wordsPerMinute: 120,
              fillerWordCount: 0,
              longSilenceCount: 1,
              keywordCoverage: 0,
              coaching: { status: "succeeded", summary: "delivery ok" },
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response("semantic unavailable", { status: 503 }),
        ),
    );

    const job = await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
      undefined,
      events,
    );

    expect(job.status).toBe("succeeded");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("report_json"),
      expect.arrayContaining([
        expect.stringContaining(
          '"coaching":{"status":"succeeded","summary":"delivery ok"',
        ),
        expect.stringContaining(
          '"keywordCoverageMeasurement":{"state":"unmeasured","reason":"no-keywords"}',
        ),
        expect.stringContaining(
          '"semanticEvaluation":{"state":"unavailable","measurementMode":"none","reasons":["server_evaluation_failed"],"retryable":true}',
        ),
        expect.stringContaining(
          '"status":"unmeasured","measurementMode":"none","fallbackUsed":true,"fallbackReason":"server_evaluation_failed","unmeasuredReason":"server_evaluation_failed"',
        ),
        expect.not.stringContaining('"status":"missed"'),
      ]),
    );
    expect(events).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: "rehearsal.semantic_evaluation.started",
        runId: "run-a",
        cueCount: 1,
        slideCount: 2,
      }),
    );
    expect(events).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        event: "rehearsal.semantic_evaluation.partial",
        reasons: ["server_evaluation_failed"],
      }),
    );
    expect(JSON.stringify(events.mock.calls)).not.toContain(
      "전달 분석은 정상 완료됐습니다",
    );
    expect(JSON.stringify(events.mock.calls)).not.toContain("고정된 cue 의미");
  });

  it("semantic endpoint 실패 시 transcript capability reason을 provider 오류보다 우선한다", async () => {
    const meta = runMetaRow().meta_json;
    const { job, query } = await runSnapshotJobWithSemanticResponse(
      new Response("semantic unavailable", { status: 503 }),
      {
        ...meta,
        semanticCapabilityEvents: [
          {
            eventId: "transcript-incomplete-1",
            capability: "transcript_evidence",
            fromState: "available",
            toState: "degraded",
            reason: "transcript_incomplete",
            measurementMode: "none",
            retryable: false,
            slideId: "slide_1",
            cueIds: ["scue_snapshot"],
            at: "2026-06-27T00:00:04.000Z",
          },
        ],
      },
    );

    expect(job.status).toBe("succeeded");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("report_json"),
      expect.arrayContaining([
        expect.stringContaining('"reasons":["transcript_incomplete"]'),
        expect.stringContaining('"unmeasuredReason":"transcript_incomplete"'),
        expect.not.stringContaining(
          '"fallbackReason":"server_evaluation_failed"',
        ),
      ]),
    );
  });

  it("shared 계약과 다른 semantic response를 canonical outcome으로 저장하지 않는다", async () => {
    const { job, query } = await runSnapshotJobWithSemanticResponse(
      new Response(
        JSON.stringify({
          semanticEvaluation: {
            state: "succeeded",
            measurementMode: "basic",
            reasons: [],
            retryable: false,
          },
          semanticCueOutcomes: [{ ...semanticOutcome(), cueRevision: 8 }],
        }),
      ),
    );

    expect(job.status).toBe("succeeded");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("report_json"),
      expect.arrayContaining([
        expect.stringContaining(
          '"unmeasuredReason":"server_evaluation_failed"',
        ),
        expect.not.stringContaining('"cueRevision":8'),
      ]),
    );
  });

  it("builds slide timings from replayed deck patches", async () => {
    const addedSlide = {
      slideId: "slide_3",
      order: 3,
      title: "patched slide",
      estimatedSeconds: 30,
      notes: "",
      style: {},
      elements: [],
      animations: [],
      actions: [],
      keywords: [],
    };
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([
        runRow({
          recordingDurationSeconds: 90,
          slideTimeline: [
            { slideId: "slide_1", enteredAt: "2026-06-27T00:00:00.000Z" },
            { slideId: "slide_3", enteredAt: "2026-06-27T00:00:20.000Z" },
            { slideId: "slide_2", enteredAt: "2026-06-27T00:00:50.000Z" },
          ],
          missedKeywords: [],
          adviceEvents: [],
        }),
      ])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([deckRow])
      .mockResolvedValueOnce([
        {
          project_id: "project-a",
          deck_id: "deck-a",
          before_version: 1,
          after_version: 2,
          source: "user",
          operations: [{ type: "add_slide", slide: addedSlide }],
        },
      ])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([jobRow("running", 85, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        jobRow(
          "succeeded",
          100,
          {
            transcriptRetained: true,
            transcript: null,
            report: {
              reportId: "report_run-a",
              transcriptRetained: true,
              transcript: null,
            },
            rawAudioDeletedAt: null,
          },
          null,
        ),
      ])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              projectId: "project-a",
              fileId: "file-audio",
              transcript: "안녕하세요 ORBIT 발표입니다",
              language: "ko-KR",
              provider: "fake",
              model: "fake-transcriber",
              volumeAnalysis: volumeAnalysisFixture,
              silenceAnalysis: silenceAnalysisFixture,
              durationSeconds: 90,
              segments: [{ text: "안녕하세요 ORBIT 발표입니다" }],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              wordsPerMinute: 120,
              fillerWordCount: 0,
              longSilenceCount: 1,
              keywordCoverage: 1,
            }),
          ),
        ),
    );

    await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("report_json"),
      expect.arrayContaining([
        expect.stringContaining(
          '"slideTimings":[{"slideId":"slide_1","targetSeconds":60,"actualSeconds":20},{"slideId":"slide_3","targetSeconds":30,"actualSeconds":30},{"slideId":"slide_2","targetSeconds":60,"actualSeconds":40}]',
        ),
      ]),
    );
  });

  it("does not re-add client-side missed keywords that transcript analysis matched", async () => {
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([
        runRow({
          slideTimeline: [],
          missedKeywords: [{ slideId: "slide_1", keywordId: "kw_1" }],
          adviceEvents: [],
        }),
      ])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([deckRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([jobRow("running", 85, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("succeeded", 100, {}, null)])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              projectId: "project-a",
              fileId: "file-audio",
              transcript: "안녕하세요 ORBIT 발표입니다",
              language: "ko-KR",
              provider: "fake",
              model: "fake-transcriber",
              volumeAnalysis: volumeAnalysisFixture,
              silenceAnalysis: silenceAnalysisFixture,
              durationSeconds: 10,
              segments: [{ text: "안녕하세요 ORBIT 발표입니다" }],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              wordsPerMinute: 120,
              fillerWordCount: 0,
              longSilenceCount: 1,
              keywordCoverage: 1,
              missedKeywords: [],
            }),
          ),
        ),
    );

    await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("report_json"),
      expect.arrayContaining([expect.stringContaining('"missedKeywords":[]')]),
    );
  });

  it("marks the job failed before scheduling raw audio cleanup when STT fails", async () => {
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([deckRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([
        jobRow("failed", 10, null, {
          code: "PYTHON_WORKER_STT_FAILED",
          message: "bad audio",
        }),
      ])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad audio", { status: 500 })),
    );

    const job = await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("PYTHON_WORKER_STT_FAILED");
    expect(storage.removeObject).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO storage_deletion_outbox"),
      expect.arrayContaining(["project-a", "file-audio", assetRow.storage_key]),
    );
  });

  it("marks the job failed before scheduling raw audio cleanup when analysis fails", async () => {
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([deckRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([
        jobRow("failed", 60, null, {
          code: "PYTHON_WORKER_ANALYZE_FAILED",
          message: "analysis unavailable",
        }),
      ])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              projectId: "project-a",
              fileId: "file-audio",
              transcript: "안녕하세요 ORBIT 발표입니다",
              language: "ko-KR",
              provider: "fake",
              model: "fake-transcriber",
              volumeAnalysis: volumeAnalysisFixture,
              silenceAnalysis: silenceAnalysisFixture,
              durationSeconds: 3.5,
              segments: [{ text: "안녕하세요 ORBIT 발표입니다" }],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response("analysis unavailable", { status: 500 }),
        ),
    );

    const job = await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("PYTHON_WORKER_ANALYZE_FAILED");
    expect(storage.removeObject).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO storage_deletion_outbox"),
      expect.arrayContaining(["project-a", "file-audio", assetRow.storage_key]),
    );
  });

  it("rejects an analysis response whose long silence count differs from VAD", async () => {
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([deckRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([
        jobRow("failed", 60, null, {
          code: "PYTHON_WORKER_ANALYZE_FAILED",
          message:
            "Python worker long silence count does not match silence analysis.",
        }),
      ])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              projectId: "project-a",
              fileId: "file-audio",
              transcript: "안녕하세요 ORBIT 발표입니다",
              language: "ko-KR",
              provider: "fake",
              model: "fake-transcriber",
              volumeAnalysis: volumeAnalysisFixture,
              silenceAnalysis: silenceAnalysisFixture,
              durationSeconds: 3.5,
              segments: [{ text: "안녕하세요 ORBIT 발표입니다" }],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              wordsPerMinute: 120,
              fillerWordCount: 0,
              longSilenceCount: 2,
              keywordCoverage: 1,
              speedSamples: [],
              fillerWordDetails: [],
              missedKeywords: [],
              slideInsights: [],
            }),
          ),
        ),
    );

    const job = await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(job.error).toEqual({
      code: "PYTHON_WORKER_ANALYZE_FAILED",
      message:
        "Python worker long silence count does not match silence analysis.",
    });
    expect(storage.removeObject).not.toHaveBeenCalled();
  });

  it("preserves STT success and reports an unmeasured silence analysis", async () => {
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([deckRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([jobRow("running", 85, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("succeeded", 100, {}, null)])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              projectId: "project-a",
              fileId: "file-audio",
              transcript: "hello",
              language: "ko-KR",
              provider: "fake",
              model: "fake",
              volumeAnalysis: unmeasuredVolumeAnalysisFixture,
              silenceAnalysis: unmeasuredSilenceAnalysisFixture,
              durationSeconds: 1,
              segments: [],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              wordsPerMinute: 60,
              fillerWordCount: 0,
              longSilenceCount: null,
              keywordCoverage: 0,
            }),
          ),
        ),
    );
    const silenceEvents = vi.fn();

    const job = await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
      undefined,
      undefined,
      silenceEvents,
    );

    expect(job.status).toBe("succeeded");
    expect(silenceEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "rehearsal.silence_analysis.unmeasured",
        measurementState: "unmeasured",
        reasonCode: "ANALYSIS_FAILED",
        longSilenceCount: null,
        segments: [],
      }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("report_json"),
      expect.arrayContaining([
        expect.stringContaining(
          '"volumeAnalysis":{"metricDefinitionVersion":1,"measurementState":"unmeasured","reasonCode":"ANALYSIS_FAILED"',
        ),
      ]),
    );
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO storage_deletion_outbox"),
      ),
    ).toBe(false);
  });

  it("marks the job failed before scheduling cleanup when report validation fails", async () => {
    const query = createQueryMock()
      .mockResolvedValueOnce([jobRow("running", 10, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([assetRow])
      .mockResolvedValueOnce([deckRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([jobRow("running", 30, null, null)])
      .mockResolvedValueOnce([jobRow("running", 65, null, null)])
      .mockResolvedValueOnce([jobRow("running", 85, null, null)])
      .mockResolvedValueOnce([runRow()])
      .mockResolvedValueOnce([
        jobRow("failed", 85, null, {
          code: "REHEARSAL_REPORT_INVALID",
          message: "Invalid report",
        }),
      ])
      .mockResolvedValueOnce([]);
    const storage = createStorage();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              projectId: "project-a",
              fileId: "file-audio",
              transcript: "안녕하세요 ORBIT 발표입니다",
              language: "ko-KR",
              provider: "fake",
              model: "fake-transcriber",
              volumeAnalysis: volumeAnalysisFixture,
              silenceAnalysis: silenceAnalysisFixture,
              durationSeconds: 3.5,
              segments: [{ text: "안녕하세요 ORBIT 발표입니다" }],
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              runId: "run-a",
              wordsPerMinute: 120,
              fillerWordCount: 1,
              longSilenceCount: 1,
              keywordCoverage: 1,
              coaching: { status: "failed", summary: "bad coaching state" },
            }),
          ),
        ),
    );

    const job = await processRehearsalSttJob(
      createDataSource(query),
      storage,
      "http://localhost:8000",
      payload,
    );

    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("REHEARSAL_REPORT_INVALID");
    expect(storage.removeObject).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO storage_deletion_outbox"),
      expect.arrayContaining(["project-a", "file-audio", assetRow.storage_key]),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE rehearsal_runs"),
      expect.arrayContaining([
        "run-a",
        "failed",
        null,
        expect.objectContaining({ code: "REHEARSAL_REPORT_INVALID" }),
        null,
      ]),
    );
  });
});

function createQueryMock() {
  return vi.fn(
    async (sql: string, params?: unknown[]): Promise<unknown[] | undefined> => {
      if (sql.includes("UPDATE jobs")) {
        const [
          jobId = "job-1",
          status = "running",
          progress = 0,
          message = String(status),
          result = null,
          error = null,
        ] = Array.isArray(params) ? params : [];

        return [
          jobRow(
            status as "running" | "succeeded" | "failed",
            typeof progress === "number" ? progress : 0,
            isRecord(result) ? result : null,
            isJobError(error) ? error : null,
            typeof message === "string"
              ? message
              : (String(status) as "running" | "succeeded" | "failed"),
            typeof jobId === "string" && jobId ? jobId : "job-1",
          ),
        ];
      }

      if (sql.includes("UPDATE rehearsal_runs")) {
        return [runRow()];
      }

      if (sql.includes("UPDATE project_assets")) {
        return [];
      }

      return undefined;
    },
  );
}

function createStorage() {
  return {
    getSignedReadUrl: vi.fn(async () => "http://localhost:9000/rehearsal.webm"),
    headObject: vi.fn(async () => null),
    putObject: vi.fn(async (value) => ({
      key: value.key,
      url: `http://localhost:9000/${value.key}`,
      contentType: value.contentType,
      purpose: value.purpose,
      size:
        typeof value.body === "string" ? value.body.length : value.body.byteLength,
    })),
    removeObject: vi.fn(async () => undefined),
  } as unknown as Pick<
    StoragePort,
    "getSignedReadUrl" | "headObject" | "putObject" | "removeObject"
  >;
}

function createDataSource(query: ReturnType<typeof createQueryMock>): DataSource {
  return {
    query,
    transaction: vi.fn(async (callback) =>
      callback({
        query: vi.fn(async () => [{ run_id: "run-a" }])
      } as never),
    )
  } as unknown as DataSource;
}

function jobRow(
  status: "running" | "succeeded" | "failed",
  progress: number,
  result: Record<string, unknown> | null,
  error: { code: string; message: string } | null,
  message: string = status,
  jobId = "job-1",
) {
  return {
    jobId,
    projectId: "project-a",
    type: "rehearsal-stt",
    status,
    progress,
    message,
    result,
    error,
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:01.000Z",
  };
}

function runRow(
  metaJson: Record<string, unknown> = runMetaRow().meta_json,
  evaluationSnapshot: Record<string, unknown> | null = null,
  semanticEvaluationMode: "full" | "delivery-only" = "full",
) {
  return {
    run_id: "run-a",
    created_at: new Date("2026-07-15T15:30:00.000Z"),
    transcript_json_file_id: null,
    transcript_text_file_id: null,
    transcript_json_status: null,
    transcript_text_status: null,
    meta_json: metaJson,
    evaluation_snapshot_json: evaluationSnapshot,
    semantic_evaluation_mode: semanticEvaluationMode,
  };
}

function runMetaRow() {
  return {
    meta_json: {
      slideTimeline: [
        { slideId: "slide_1", enteredAt: "2026-06-27T00:00:00.000Z" },
        { slideId: "slide_2", enteredAt: "2026-06-27T00:00:45.000Z" },
      ],
      missedKeywords: [],
      adviceEvents: [],
      utteranceOutcomes: [
        {
          slideId: "slide_1",
          kind: "paraphrased",
          sentenceId: "sentence_1",
          similarity: 0.93,
        },
      ],
      semanticCueDecisions: [
        {
          slideId: "slide_1",
          cueId: "scue_intro_1",
          label: "covered",
          provider: "mock",
          finalScore: 0.91,
          premise: "문제 정의를 설명했습니다.",
          hypothesis: "문제 정의의 핵심 의미를 설명했다",
          reasonCodes: ["semantic-cue-coverage-evidence"],
        },
      ],
      semanticCapabilityEvents: [],
    },
  };
}

function evaluationSnapshot() {
  return {
    deckId: "deck-a",
    deckVersion: 3,
    capturedAt: "2026-06-27T00:00:00.000Z",
    pronunciationLexicon: {
      schemaVersion: 1 as const,
      generatorVersion: "test-v1",
      deckId: "deck-a",
      deckVersion: 3,
      sourceHash: "0123456789abcdef",
      entries: [
        {
          id: "pron_snapshot",
          sourceText: "SNAPSHOT",
          normalizedSource: "snapshot",
          canonicalText: "SNAPSHOT",
          canonicalKey: "snapshot",
          category: "word" as const,
          aliases: [
            {
              text: "스냅샷",
              normalizedText: "스냅샷",
              origin: "domain" as const,
              confidence: 1,
              enabled: true,
            },
          ],
          confidence: 1,
          status: "active" as const,
          scriptOccurrences: [{ slideId: "slide_1", start: 0, end: 8 }],
        },
      ],
    },
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "snapshot slide",
        estimatedSeconds: 75,
        keywords: [
          {
            keywordId: "kw_snapshot",
            text: "SNAPSHOT",
            synonyms: ["고정 키워드"],
            abbreviations: [],
            required: true,
          },
        ],
        semanticCues: [
          {
            cueId: "scue_snapshot",
            slideId: "slide_1",
            meaning: "고정된 cue 의미",
            importance: "core",
            reviewStatus: "approved",
            freshness: "current",
            origin: "manual",
            revision: 7,
            required: true,
            priority: 1,
            candidateKeywords: ["SNAPSHOT"],
            aliases: {},
            requiredConcepts: ["고정 의미"],
            nliHypotheses: ["발표자는 고정 의미를 설명했다"],
            negativeHints: [],
            targetElementIds: [],
            triggerActionIds: [],
          },
        ],
      },
      {
        slideId: "slide_2",
        order: 2,
        title: "next snapshot slide",
        estimatedSeconds: 45,
        keywords: [],
        semanticCues: [],
      },
    ],
  };
}

function semanticOutcome() {
  return {
    slideId: "slide_1",
    cueId: "scue_snapshot",
    cueRevision: 7,
    cueMeaningSnapshot: "고정된 cue 의미",
    reportLabelSnapshot: "고정된 cue 의미",
    importance: "core",
    status: "covered",
    confidence: 1,
    matchedBy: "lexical",
    measurementMode: "basic",
    fallbackUsed: false,
    evidence: {
      excerpt: "snapshot keyword를 설명했습니다",
      startMs: 0,
      endMs: 3500,
    },
    coveredConcepts: ["고정 의미"],
    missingConcepts: [],
  };
}

async function runSnapshotJobWithSemanticResponse(
  semanticResponse: Response,
  metaJson: Record<string, unknown> = runMetaRow().meta_json,
) {
  const snapshot = evaluationSnapshot();
  const query = createQueryMock()
    .mockResolvedValueOnce([jobRow("running", 10, null, null)])
    .mockResolvedValueOnce([runRow(metaJson, snapshot)])
    .mockResolvedValueOnce([assetRow])
    .mockResolvedValueOnce([jobRow("running", 30, null, null)])
    .mockResolvedValueOnce([jobRow("running", 65, null, null)])
    .mockResolvedValueOnce([jobRow("running", 85, null, null)])
    .mockResolvedValueOnce([runRow()])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([jobRow("succeeded", 100, {}, null)])
    .mockResolvedValueOnce([]);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runId: "run-a",
            projectId: "project-a",
            fileId: "file-audio",
            transcript: "snapshot keyword를 설명했습니다",
            language: "ko-KR",
            provider: "fake",
            model: "fake-transcriber",
            volumeAnalysis: volumeAnalysisFixture,
            silenceAnalysis: silenceAnalysisFixture,
            durationSeconds: 10,
            segments: [
              {
                text: "snapshot keyword를 설명했습니다",
                startSeconds: 0,
                endSeconds: 3,
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runId: "run-a",
            wordsPerMinute: 120,
            fillerWordCount: 0,
            longSilenceCount: 1,
            keywordCoverage: 1,
          }),
        ),
      )
      .mockResolvedValueOnce(semanticResponse),
  );
  const job = await processRehearsalSttJob(
    createDataSource(query),
    createStorage(),
    "http://localhost:8000",
    payload,
  );
  return { job, query };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJobError(
  value: unknown,
): value is { code: string; message: string } {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    typeof value.message === "string"
  );
}
