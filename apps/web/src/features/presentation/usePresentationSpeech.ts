import type { Slide } from "@orbit/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createSpeechTracker,
  type SpeechTracker,
} from "../rehearsal/speech/speechTracker";
import type { SpeechTrackerSnapshot } from "../rehearsal/speech/speechTrackingEvents";
import { createLiveSttPort } from "../rehearsal/stt/liveSttEngineRegistry";
import type { LiveSttPort, LiveSttResult } from "../rehearsal/stt/liveSttPort";
import { normalizeLiveSttBiasPhrases } from "../rehearsal/stt/liveSttPort";
import { fetchLiveSttRuntimeConfig } from "../rehearsal/stt/liveSttRuntimeConfig";
import {
  applyTranscriptRevision,
  createTranscriptRevisionState,
  type TranscriptRevisionState,
} from "../rehearsal/speech/transcriptRevisionState";
import {
  applyTranscriptEvidence,
  createTranscriptEvidenceState,
  type TranscriptEvidenceKind,
  type TranscriptEvidenceState,
} from "../rehearsal/speech/transcriptEvidenceState";

type PresentationSpeechState = {
  error: string | null;
  lastTranscriptActivityAtMs: number | null;
  latestTranscript: string;
  latestTranscriptConfidence: number | null;
  snapshot: SpeechTrackerSnapshot | null;
  status: "idle" | "starting" | "listening" | "paused" | "stopped" | "error";
  transcript: string;
  wordsPerMinute: number;
};

export type PresentationSpeechTranscriptEvent = {
  actionEvidenceKind: TranscriptEvidenceKind;
  actionNewSegment: string;
  actionPreviousTranscript: string;
  actionTranscript: string;
  isActionDispatchable: boolean;
  newSegment: string;
  previousTranscript: string;
  result: LiveSttResult;
  slide: Slide;
  transcript: string;
};

const initialState: PresentationSpeechState = {
  error: null,
  lastTranscriptActivityAtMs: null,
  latestTranscript: "",
  latestTranscriptConfidence: null,
  snapshot: null,
  status: "idle",
  transcript: "",
  wordsPerMinute: 0,
};

export function usePresentationSpeech(
  projectId?: string,
  onSlideTranscriptEvent?: (event: PresentationSpeechTranscriptEvent) => void,
) {
  const [state, setState] = useState(initialState);
  const portRef = useRef<LiveSttPort | null>(null);
  const trackerRef = useRef<SpeechTracker | null>(null);
  const slideRef = useRef<Slide | null>(null);
  const startedAtRef = useRef(0);
  const accumulatedListeningMsRef = useRef(0);
  const finalWordCountRef = useRef(0);
  const transcriptRef = useRef("");
  const slideTranscriptRef = useRef("");
  const inFlightSlideTranscriptRef = useRef("");
  const latestSlideTranscriptBeforeRef = useRef("");
  const latestSlideTranscriptAfterRef = useRef("");
  const latestSlideTranscriptSegmentRef = useRef("");
  const latestSlideTranscriptSequenceRef = useRef(0);
  const latestActionTranscriptBeforeRef = useRef("");
  const latestActionTranscriptAfterRef = useRef("");
  const latestActionTranscriptSegmentRef = useRef("");
  const latestActionTranscriptDispatchableRef = useRef(false);
  const slideTranscriptRevisionRef = useRef<TranscriptRevisionState>(
    createTranscriptRevisionState(),
  );
  const slideTranscriptEvidenceRef = useRef<TranscriptEvidenceState>(
    createTranscriptEvidenceState(),
  );
  const unsubscribersRef = useRef<Array<() => void>>([]);
  const onSlideTranscriptEventRef = useRef(onSlideTranscriptEvent);
  onSlideTranscriptEventRef.current = onSlideTranscriptEvent;

  const enterSlide = useCallback((slide: Slide) => {
    slideRef.current = slide;
    slideTranscriptRef.current = "";
    inFlightSlideTranscriptRef.current = "";
    latestSlideTranscriptBeforeRef.current = "";
    latestSlideTranscriptAfterRef.current = "";
    latestSlideTranscriptSegmentRef.current = "";
    latestSlideTranscriptSequenceRef.current = 0;
    latestActionTranscriptBeforeRef.current = "";
    latestActionTranscriptAfterRef.current = "";
    latestActionTranscriptSegmentRef.current = "";
    latestActionTranscriptDispatchableRef.current = false;
    slideTranscriptRevisionRef.current = createTranscriptRevisionState();
    slideTranscriptEvidenceRef.current = createTranscriptEvidenceState();
    trackerRef.current = createSpeechTracker({
      keywords: slide.keywords,
      slideId: slide.slideId,
      speakerNotes: slide.speakerNotes,
    });
    setState((current) => ({
      ...current,
      latestTranscript: "",
      latestTranscriptConfidence: null,
      snapshot: trackerRef.current?.snapshot() ?? null,
    }));
    void Promise.resolve(
      portRef.current?.updateBiasPhrases(buildPresentationBiasPhrases(slide)),
    ).catch(() => undefined);
  }, []);

  const stopPort = useCallback(async () => {
    const port = portRef.current;
    portRef.current = null;
    const unsubscribers = unsubscribersRef.current.splice(0);
    if (port) {
      await port.stop().catch(() => undefined);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      await Promise.resolve(port.dispose()).catch(() => undefined);
    } else {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    }
  }, []);

  const stop = useCallback(async () => {
    if (portRef.current && startedAtRef.current > 0) {
      accumulatedListeningMsRef.current += Date.now() - startedAtRef.current;
      startedAtRef.current = 0;
    }
    await stopPort();
    setState((current) => ({ ...current, status: "stopped" }));
  }, [stopPort]);

  const startPort = useCallback(
    async (stream: MediaStream, slide: Slide) => {
      const runtimeConfig = await fetchLiveSttRuntimeConfig();
      const port = createLiveSttPort(runtimeConfig.liveSttEngine, {
        projectId,
      });
      portRef.current = port;
      startedAtRef.current = Date.now();
      unsubscribersRef.current = [
        port.onResult((result) => {
          const tracker = trackerRef.current;
          if (!tracker) return;
          const transcriptActivityAtMs = Date.now();
          const transcriptRevision = applyTranscriptRevision(
            slideTranscriptRevisionRef.current,
            result,
          );
          if (transcriptRevision.isStale) return;
          slideTranscriptRevisionRef.current = transcriptRevision.state;
          const transcriptEvidence = applyTranscriptEvidence(
            slideTranscriptEvidenceRef.current,
            result,
          );
          slideTranscriptEvidenceRef.current = transcriptEvidence.state;
          latestActionTranscriptBeforeRef.current = transcriptEvidence.previousTranscript;
          latestActionTranscriptAfterRef.current = transcriptEvidence.currentTranscript;
          latestActionTranscriptSegmentRef.current = transcriptEvidence.newSegment;
          latestActionTranscriptDispatchableRef.current =
            transcriptEvidence.isDispatchable;
          latestSlideTranscriptBeforeRef.current = transcriptRevision.previousTranscript;
          latestSlideTranscriptAfterRef.current = transcriptRevision.currentTranscript;
          latestSlideTranscriptSegmentRef.current = transcriptRevision.newSegment;
          latestSlideTranscriptSequenceRef.current += 1;
          const activeSlide = slideRef.current;
          if (activeSlide) {
            onSlideTranscriptEventRef.current?.({
              actionEvidenceKind: transcriptEvidence.kind,
              actionNewSegment: transcriptEvidence.newSegment,
              actionPreviousTranscript: transcriptEvidence.previousTranscript,
              actionTranscript: transcriptEvidence.currentTranscript,
              isActionDispatchable: transcriptEvidence.isDispatchable,
              newSegment: transcriptRevision.newSegment,
              previousTranscript: transcriptRevision.previousTranscript,
              result,
              slide: activeSlide,
              transcript: transcriptRevision.currentTranscript,
            });
          }
          tracker.acceptResult(result);
          if (result.isFinal) {
            const finalText = result.text.trim();
            inFlightSlideTranscriptRef.current = "";
            if (finalText) {
              transcriptRef.current = [transcriptRef.current, finalText]
                .filter(Boolean)
                .join(" ");
              slideTranscriptRef.current = [
                slideTranscriptRef.current,
                finalText,
              ]
                .filter(Boolean)
                .join(" ");
              finalWordCountRef.current += finalText
                .split(/\s+/)
                .filter(Boolean).length;
            }
          } else {
            inFlightSlideTranscriptRef.current = result.text.trim();
          }
          const activeListeningMs =
            accumulatedListeningMsRef.current +
            Math.max(transcriptActivityAtMs - startedAtRef.current, 0);
          const elapsedMinutes = Math.max(activeListeningMs / 60_000, 1 / 60);
          setState((current) => ({
            ...current,
            lastTranscriptActivityAtMs: transcriptActivityAtMs,
            latestTranscript: result.text,
            latestTranscriptConfidence: result.confidence ?? null,
            snapshot: tracker.snapshot(),
            transcript: transcriptRef.current,
            wordsPerMinute: Math.round(
              finalWordCountRef.current / elapsedMinutes,
            ),
          }));
        }),
        port.onError((error) => {
          setState((current) => ({
            ...current,
            error: error.message || "실시간 음성 인식을 계속할 수 없습니다.",
            status: "error",
          }));
        }),
      ];
      await port.start({
        audioSource: stream,
        biasPhrases: buildPresentationBiasPhrases(slide),
        language: "ko",
      });
      setState((current) => ({ ...current, status: "listening" }));
    },
    [projectId],
  );

  const start = useCallback(
    async (stream: MediaStream, slide: Slide) => {
      await stop();
      enterSlide(slide);
      accumulatedListeningMsRef.current = 0;
      finalWordCountRef.current = 0;
      transcriptRef.current = "";
      setState((current) => ({
        ...current,
        error: null,
        latestTranscript: "",
        latestTranscriptConfidence: null,
        status: "starting",
        transcript: "",
        wordsPerMinute: 0,
      }));
      try {
        await startPort(stream, slide);
      } catch (cause) {
        await stop();
        setState((current) => ({
          ...current,
          error:
            cause instanceof Error
              ? cause.message
              : "실시간 음성 인식을 시작하지 못했습니다.",
          status: "error",
        }));
      }
    },
    [enterSlide, startPort, stop],
  );

  const pause = useCallback(async () => {
    if (portRef.current && startedAtRef.current > 0) {
      accumulatedListeningMsRef.current += Date.now() - startedAtRef.current;
      startedAtRef.current = 0;
    }
    await stopPort();
    setState((current) => ({ ...current, status: "paused" }));
  }, [stopPort]);

  const resume = useCallback(
    async (stream: MediaStream, slide: Slide) => {
      if (portRef.current) {
        return;
      }
      setState((current) => ({ ...current, error: null, status: "starting" }));
      try {
        if (!trackerRef.current) {
          enterSlide(slide);
        }
        await startPort(stream, slide);
      } catch (cause) {
        await stopPort();
        setState((current) => ({
          ...current,
          error:
            cause instanceof Error
              ? cause.message
              : "실시간 음성 인식을 재개하지 못했습니다.",
          status: "error",
        }));
        throw cause;
      }
    },
    [enterSlide, startPort, stopPort],
  );

  useEffect(() => () => void stop(), [stop]);

  return {
    enterSlide,
    getSlideTranscript: () => latestSlideTranscriptAfterRef.current,
    getSlideTranscriptSpan: () => ({
      previousTranscript: latestSlideTranscriptBeforeRef.current,
      transcript: latestSlideTranscriptAfterRef.current,
    }),
    getSlideTranscriptEvent: () => ({
      actionNewSegment: latestActionTranscriptSegmentRef.current,
      actionPreviousTranscript: latestActionTranscriptBeforeRef.current,
      actionTranscript: latestActionTranscriptAfterRef.current,
      isActionDispatchable: latestActionTranscriptDispatchableRef.current,
      newSegment: latestSlideTranscriptSegmentRef.current,
      previousTranscript: latestSlideTranscriptBeforeRef.current,
      sequence: latestSlideTranscriptSequenceRef.current,
      transcript: latestSlideTranscriptAfterRef.current,
    }),
    getTranscript: () => transcriptRef.current,
    pause,
    resume,
    start,
    state,
    stop,
  };
}

function buildPresentationBiasPhrases(slide: Slide) {
  return normalizeLiveSttBiasPhrases([
    ...slide.keywords.flatMap((keyword) => [
      {
        canonicalText: keyword.text,
        keywordId: keyword.keywordId,
        source: "keyword" as const,
        text: keyword.text,
        weight: 1,
      },
      ...keyword.synonyms.map((text) => ({
        canonicalText: keyword.text,
        keywordId: keyword.keywordId,
        source: "synonym" as const,
        text,
        weight: 0.9,
      })),
      ...keyword.abbreviations.map((text) => ({
        canonicalText: keyword.text,
        keywordId: keyword.keywordId,
        source: "abbreviation" as const,
        text,
        weight: 0.9,
      })),
    ]),
    ...(slide.title.trim()
      ? [{ source: "title" as const, text: slide.title, weight: 0.75 }]
      : []),
  ]).slice(0, 32);
}
