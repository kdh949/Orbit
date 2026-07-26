import type { Deck, Slide } from "@orbit/shared/deck";
import type { SlideTranscriptSnapshot } from "@orbit/shared/rehearsals";
import { useRef, useState } from "react";
import {
  createRehearsalCommandConfirmationState,
  type RehearsalCommandConfirmationState,
} from "../rehearsalCommands";
import {
  createLiveKeywordOccurrenceState,
  createLiveTranscriptBuffer,
  evaluateLiveTranscript,
  renderLiveTranscriptBuffer,
  type LiveKeywordOccurrenceState,
  type LiveTranscriptAnalysis,
  type LiveTranscriptBuffer,
} from "../../../runtime/speech/tracking/liveTranscriptAnalysis";

export function useRehearsalSpeechTracking() {
  const [keywordState, setKeywordState] =
    useState<LiveTranscriptAnalysis | null>(null);
  const [sessionTranscript, setSessionTranscript] = useState("");
  const transcriptBufferRef = useRef<LiveTranscriptBuffer>(
    createLiveTranscriptBuffer(),
  );
  const sessionTranscriptBufferRef = useRef<LiveTranscriptBuffer>(
    createLiveTranscriptBuffer(),
  );
  const slideTranscriptSnapshotsRef = useRef<SlideTranscriptSnapshot[]>([]);
  const slideTranscriptVisitVersionsRef = useRef(new Map<string, number>());
  const activeSlideTranscriptVisitRef = useRef<{
    slideId: string;
    slideNum: number;
    visitedAt: string;
    visitedVer: number;
  } | null>(null);
  const keywordStateRef = useRef<LiveTranscriptAnalysis | null>(null);
  const keywordOccurrenceStateRef = useRef<LiveKeywordOccurrenceState | null>(
    null,
  );
  const commandConfirmationRef = useRef<RehearsalCommandConfirmationState>(
    createRehearsalCommandConfirmationState(),
  );

  function setCurrentKeywordState(next: LiveTranscriptAnalysis | null) {
    keywordStateRef.current = next;
    setKeywordState(next);
  }

  function resetSlideTranscript(slide: Slide | null) {
    transcriptBufferRef.current = createLiveTranscriptBuffer();
    keywordOccurrenceStateRef.current = slide
      ? createLiveKeywordOccurrenceState(slide.slideId)
      : null;
    commandConfirmationRef.current = createRehearsalCommandConfirmationState();
    setCurrentKeywordState(slide ? evaluateLiveTranscript(slide, "") : null);
  }

  function resetSessionTranscript() {
    sessionTranscriptBufferRef.current = createLiveTranscriptBuffer();
    setSessionTranscript("");
  }

  function beginSlideTranscriptVisit(
    slide: Slide,
    slideIndex: number,
    visitedAt = new Date().toISOString(),
  ) {
    const visitedVer =
      (slideTranscriptVisitVersionsRef.current.get(slide.slideId) ?? 0) + 1;
    slideTranscriptVisitVersionsRef.current.set(slide.slideId, visitedVer);
    activeSlideTranscriptVisitRef.current = {
      slideId: slide.slideId,
      slideNum: slideIndex + 1,
      visitedAt,
      visitedVer,
    };
  }

  function captureSlideTranscriptSnapshot(
    reason: SlideTranscriptSnapshot["reason"],
    capturedAt = new Date().toISOString(),
  ) {
    const activeVisit = activeSlideTranscriptVisitRef.current;
    if (!activeVisit) {
      return;
    }

    slideTranscriptSnapshotsRef.current.push({
      ...activeVisit,
      transcript: renderLiveTranscriptBuffer(
        sessionTranscriptBufferRef.current,
      ),
      capturedAt,
      reason,
    });
    activeSlideTranscriptVisitRef.current = null;
  }

  function resetSlideTranscriptSnapshots(activeDeck: Deck, slideIndex: number) {
    slideTranscriptSnapshotsRef.current = [];
    slideTranscriptVisitVersionsRef.current = new Map();
    activeSlideTranscriptVisitRef.current = null;
    const slide = activeDeck.slides[slideIndex];
    if (slide) {
      beginSlideTranscriptVisit(slide, slideIndex);
    }
  }

  function transitionSlideTranscriptVisit(slide: Slide, slideIndex: number) {
    const activeVisit = activeSlideTranscriptVisitRef.current;
    if (!activeVisit || activeVisit.slideId === slide.slideId) {
      return;
    }
    captureSlideTranscriptSnapshot("slide-change");
    beginSlideTranscriptVisit(slide, slideIndex);
  }

  return {
    beginSlideTranscriptVisit,
    captureSlideTranscriptSnapshot,
    commandConfirmationRef,
    getSessionTranscript: () =>
      renderLiveTranscriptBuffer(sessionTranscriptBufferRef.current),
    getSlideTranscriptSnapshots: () => slideTranscriptSnapshotsRef.current,
    keywordOccurrenceStateRef,
    keywordState,
    keywordStateRef,
    resetSessionTranscript,
    resetSlideTranscript,
    resetSlideTranscriptSnapshots,
    sessionTranscript,
    sessionTranscriptBufferRef,
    setCurrentKeywordState,
    setSessionTranscript,
    transcriptBufferRef,
    transitionSlideTranscriptVisit,
  };
}
