type OverallSpeakingRateInput = {
  metrics: {
    charactersPerMinute: number | null;
    measurements: {
      charactersPerMinute: {
        measurementState: "measured" | "unmeasured";
      };
    };
  };
  slideInsights: Array<{
    speakingRate: {
      activeSpeechSeconds: number;
      characterCount: number;
      charactersPerSecond: number | null;
      measurementState: "measured" | "unmeasured";
      reasonCode: string | null;
    };
  }>;
};

export type OverallSpeakingRate = {
  charactersPerMinute: number | null;
  slideCount: number;
  source: "overall" | "slide-average" | "unavailable";
};

export function resolveOverallSpeakingRate(
  report: OverallSpeakingRateInput,
): OverallSpeakingRate {
  if (
    report.metrics.measurements.charactersPerMinute.measurementState ===
      "measured" &&
    report.metrics.charactersPerMinute !== null
  ) {
    return {
      charactersPerMinute: Math.round(report.metrics.charactersPerMinute),
      slideCount: 0,
      source: "overall",
    };
  }

  const slideRates = report.slideInsights.flatMap(({ speakingRate }) => {
    if (
      speakingRate.measurementState === "measured" &&
      speakingRate.charactersPerSecond !== null
    ) {
      return [Math.round(speakingRate.charactersPerSecond * 60)];
    }

    if (
      speakingRate.measurementState === "unmeasured" &&
      speakingRate.reasonCode === "BASELINE_UNAVAILABLE" &&
      speakingRate.activeSpeechSeconds > 0 &&
      speakingRate.characterCount > 0
    ) {
      return [
        Math.round(
          (speakingRate.characterCount / speakingRate.activeSpeechSeconds) * 60,
        ),
      ];
    }

    return [];
  });

  if (slideRates.length === 0) {
    return {
      charactersPerMinute: null,
      slideCount: 0,
      source: "unavailable",
    };
  }

  return {
    charactersPerMinute: Math.round(
      slideRates.reduce((sum, rate) => sum + rate, 0) / slideRates.length,
    ),
    slideCount: slideRates.length,
    source: "slide-average",
  };
}
