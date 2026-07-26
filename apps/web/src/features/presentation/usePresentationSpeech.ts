import type { Slide } from "@orbit/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createSpeechTracker,
  type SpeechTracker,
} from "../rehearsal/speech/speechTracker";
import type { SpeechTrackerSnapshot } from "../rehearsal/speech/speechTrackingEvents";
import { createLiveSttPort } from "../rehearsal/stt/liveSttEngineRegistry";
import type { LiveSttPort } from "../../runtime/speech/stt/liveSttPort";
import { normalizeLiveSttBiasPhrases } from "../../runtime/speech/stt/liveSttPort";
import { fetchLiveSttRuntimeConfig } from "../../runtime/speech/stt/liveSttRuntimeConfig";

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

export function usePresentationSpeech(projectId?: string) {
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
  const unsubscribersRef = useRef<Array<() => void>>([]);

  const enterSlide = useCallback((slide: Slide) => {
    slideRef.current = slide;
    slideTranscriptRef.current = "";
    inFlightSlideTranscriptRef.current = "";
    latestSlideTranscriptBeforeRef.current = "";
    latestSlideTranscriptAfterRef.current = "";
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
          latestSlideTranscriptBeforeRef.current = getSlideTranscriptText({
            committedTranscript: slideTranscriptRef.current,
            draftTranscript: inFlightSlideTranscriptRef.current,
          });
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
          latestSlideTranscriptAfterRef.current = getSlideTranscriptText({
            committedTranscript: slideTranscriptRef.current,
            draftTranscript: inFlightSlideTranscriptRef.current,
          });
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
    getTranscript: () => transcriptRef.current,
    pause,
    resume,
    start,
    state,
    stop,
  };
}

function getSlideTranscriptText(input: {
  committedTranscript: string;
  draftTranscript: string;
}) {
  return [input.committedTranscript, input.draftTranscript]
    .filter(Boolean)
    .join(" ");
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
