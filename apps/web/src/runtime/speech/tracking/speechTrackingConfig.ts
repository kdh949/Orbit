export const speechTrackingAdviceEventTypes = [
  "pace-too-fast",
  "pace-too-slow",
  "slide-overtime"
] as const;

export type AdviceEventType = (typeof speechTrackingAdviceEventTypes)[number];

export type HybridCoverageConfig = {
  sentenceWeight: number;
  wordWeight: number;
  correctionWindow: number;
};

export type PaceAdviceConfig = {
  slowWpm: number;
  fastWpm: number;
  movingAverageWindowMs: number;
};

export type CandidateScoringConfig = {
  keywordOrNumericTokenBonus: number;
  preferredWordCountBonus: number;
  averageSyllableLengthBonus: number;
  positionDiversityBonus: number;
};

export type SpeechTrackingConfig = {
  particleStopwords: readonly string[];
  phraseCandidateLimit: number;
  diceThreshold: number;
  matchingTailCharacters: number;
  hybridCoverage: HybridCoverageConfig;
  paceAdvice: PaceAdviceConfig;
  adviceReentryCooldownMs: number;
  biasPhraseBudget: number;
  commonPhraseBlacklist: readonly string[];
  candidateScoring: CandidateScoringConfig;
};

export type SpeechTrackingConfigOverride = Partial<
  Omit<
    SpeechTrackingConfig,
    "hybridCoverage" | "paceAdvice" | "candidateScoring"
  >
> & {
  hybridCoverage?: Partial<HybridCoverageConfig>;
  paceAdvice?: Partial<PaceAdviceConfig>;
  candidateScoring?: Partial<CandidateScoringConfig>;
};

// P3-D# 결정값은 여러 모듈이 공유하므로 한 곳에서만 기본값을 관리한다.
export const defaultSpeechTrackingConfig: SpeechTrackingConfig = Object.freeze({
  particleStopwords: Object.freeze([
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "의",
    "에",
    "에서",
    "에게",
    "께",
    "한테",
    "으로",
    "로",
    "와",
    "과",
    "랑",
    "이랑",
    "하고",
    "도",
    "만",
    "까지",
    "부터",
    "조차",
    "마저",
    "밖에",
    "처럼",
    "보다",
    "같이",
    "마다",
    "나",
    "이나",
    "든",
    "이든",
    "요"
  ]),
  phraseCandidateLimit: 3,
  diceThreshold: 0.75,
  matchingTailCharacters: 40,
  hybridCoverage: Object.freeze({
    sentenceWeight: 0.7,
    wordWeight: 0.3,
    correctionWindow: 0.1
  }),
  paceAdvice: Object.freeze({
    slowWpm: 85,
    fastWpm: 130,
    movingAverageWindowMs: 30000
  }),
  adviceReentryCooldownMs: 15000,
  biasPhraseBudget: 48,
  commonPhraseBlacklist: Object.freeze([
    "감사합니다",
    "안녕하세요",
    "말씀드리겠습니다",
    "살펴보겠습니다",
    "설명드리겠습니다",
    "시작하겠습니다",
    "마무리하겠습니다",
    "그렇기 때문에",
    "이와 같이"
  ]),
  candidateScoring: Object.freeze({
    keywordOrNumericTokenBonus: 2,
    preferredWordCountBonus: 1,
    averageSyllableLengthBonus: 1,
    positionDiversityBonus: 1
  })
});

export function mergeSpeechTrackingConfig(
  override: SpeechTrackingConfigOverride = {}
): SpeechTrackingConfig {
  return {
    ...defaultSpeechTrackingConfig,
    ...override,
    particleStopwords:
      override.particleStopwords ?? defaultSpeechTrackingConfig.particleStopwords,
    commonPhraseBlacklist:
      override.commonPhraseBlacklist ??
      defaultSpeechTrackingConfig.commonPhraseBlacklist,
    hybridCoverage: {
      ...defaultSpeechTrackingConfig.hybridCoverage,
      ...override.hybridCoverage
    },
    paceAdvice: {
      ...defaultSpeechTrackingConfig.paceAdvice,
      ...override.paceAdvice
    },
    candidateScoring: {
      ...defaultSpeechTrackingConfig.candidateScoring,
      ...override.candidateScoring
    }
  };
}
