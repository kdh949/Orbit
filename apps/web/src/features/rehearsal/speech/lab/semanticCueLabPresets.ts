import type { SemanticCue } from "@orbit/shared/deck";

export type SemanticCueLabPreset = {
  id: string;
  label: string;
  description: string;
  transcript: string;
  cues: readonly Partial<SemanticCue>[];
};

export const semanticCueLabPresets: SemanticCueLabPreset[] = [
  {
    id: "cac-definition",
    label: "CAC 정의 (단일 큐)",
    description: "고객 획득 비용 정의를 말했는지 판별",
    transcript:
      "이번 슬라이드에서는 고객 획득 비용, 즉 CAC에 대해 말씀드리겠습니다. CAC는 신규 고객 한 명을 데려오는 데 드는 마케팅과 영업 비용을 의미합니다.",
    cues: [
      {
        cueId: "scue_lab_cac",
        slideId: "slide_lab_1",
        meaning: "고객 획득 비용(CAC)의 정의를 설명한다",
        reportLabel: "CAC 정의",
        cueType: "definition",
        importance: "core",
        reviewStatus: "approved",
        freshness: "current",
        origin: "manual",
        required: true,
        priority: 1,
        candidateKeywords: ["CAC", "고객 획득 비용", "획득 비용"],
        aliases: {
          CAC: ["씨에이씨", "고객 획득 비용", "customer acquisition cost"]
        },
        requiredConcepts: ["고객", "비용"],
        nliHypotheses: [
          "발표자는 고객 획득 비용을 설명했다",
          "발표자는 CAC가 신규 고객을 데려오는 데 드는 비용이라고 설명했다"
        ]
      }
    ]
  },
  {
    id: "problem-cause",
    label: "문제-원인 (큐 2개)",
    description: "문제 제시와 원인 설명을 각각 판별",
    transcript:
      "저희 서비스의 이탈률이 최근 석 달 동안 두 배로 늘었습니다. 원인을 분석해 보니 온보딩 과정이 너무 복잡해서 첫 주에 이탈하는 사용자가 많았습니다.",
    cues: [
      {
        cueId: "scue_lab_problem",
        slideId: "slide_lab_2",
        meaning: "이탈률 증가 문제를 제시한다",
        reportLabel: "문제 제시",
        cueType: "problem",
        importance: "core",
        reviewStatus: "approved",
        freshness: "current",
        origin: "manual",
        required: true,
        priority: 1,
        candidateKeywords: ["이탈률", "이탈", "증가"],
        aliases: { 이탈률: ["churn", "이탈율"] },
        requiredConcepts: ["이탈률", "증가"],
        nliHypotheses: [
          "발표자는 이탈률이 증가했다는 문제를 제시했다",
          "발표자는 사용자 이탈이 늘었다고 말했다"
        ]
      },
      {
        cueId: "scue_lab_cause",
        slideId: "slide_lab_2",
        meaning: "온보딩 복잡성이 이탈의 원인임을 설명한다",
        reportLabel: "원인 설명",
        cueType: "cause",
        importance: "core",
        reviewStatus: "approved",
        freshness: "current",
        origin: "manual",
        required: true,
        priority: 1,
        candidateKeywords: ["온보딩", "복잡", "원인"],
        aliases: { 온보딩: ["onboarding", "가입 과정"] },
        requiredConcepts: ["온보딩", "원인"],
        nliHypotheses: [
          "발표자는 온보딩이 복잡한 것이 이탈의 원인이라고 설명했다"
        ]
      }
    ]
  },
  {
    id: "empty",
    label: "빈 템플릿",
    description: "최소 필드만 채운 큐 한 개",
    transcript: "",
    cues: [
      {
        cueId: "scue_lab_new",
        slideId: "slide_lab_new",
        meaning: "여기에 필수 문맥의 의미를 적으세요",
        reviewStatus: "approved",
        freshness: "current",
        required: true,
        priority: 2,
        candidateKeywords: [],
        aliases: {},
        requiredConcepts: [],
        nliHypotheses: ["발표자는 ...라고 설명했다"]
      }
    ]
  }
];
