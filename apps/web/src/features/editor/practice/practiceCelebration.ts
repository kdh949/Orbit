import {
  isWithinTargetRange,
  slidePracticeMetricTargets,
  type SlidePracticeReportRecord,
} from "@orbit/shared/slide-practice";

export type PracticeCelebrationOutcome = {
  great: boolean;
  noFiller: boolean;
};

export function practiceCelebrationOutcome(
  report: SlidePracticeReportRecord,
): PracticeCelebrationOutcome {
  const noFiller = report.reportVersion === 3
    && report.quality.state === "measured"
    && report.voice.activeSpeechMs >= slidePracticeMetricTargets.activeSpeechMinimumMs
    && report.fillers.totalCount === 0
    && report.fillers.details.every((filler) => filler.count === 0);
  const voice = report.voice;
  const great = noFiller
    && voice.syllablesPerSecond !== null
    && isWithinTargetRange(
      voice.syllablesPerSecond,
      slidePracticeMetricTargets.syllablesPerSecond,
    )
    && voice.loudnessDb !== null
    && isWithinTargetRange(voice.loudnessDb, slidePracticeMetricTargets.loudnessDb)
    && voice.loudnessMadDb !== null
    && voice.loudnessMadDb <= slidePracticeMetricTargets.loudnessMadDbMaximum
    && isWithinTargetRange(voice.pauseRatio, slidePracticeMetricTargets.pauseRatio)
    && voice.pitchSpanHz !== null
    && isWithinTargetRange(voice.pitchSpanHz, slidePracticeMetricTargets.pitchSpanHz);
  return { great, noFiller };
}

export function practiceCelebrationAnimationSession(input: {
  consumedSessionId: string | null;
  latestSessionId: string | null;
  triggerSessionId: string | null;
}) {
  if (
    !input.triggerSessionId
    || input.triggerSessionId !== input.latestSessionId
    || input.triggerSessionId === input.consumedSessionId
  ) {
    return null;
  }
  return input.triggerSessionId;
}
