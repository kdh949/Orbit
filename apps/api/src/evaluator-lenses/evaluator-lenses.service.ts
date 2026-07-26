import {
  evaluatorLensRegistryResponseSchema,
  type EvaluatorLensDefinition,
} from "@orbit/shared/coaching";
import { Injectable } from "@nestjs/common";

const lenses: EvaluatorLensDefinition[] = [
  {
    ref: { lensId: "general-novice", revision: 1 },
    label: "처음 듣는 청중",
    description: "배경지식 없이도 핵심 흐름과 결론을 이해할 수 있는지 봅니다.",
    priorityOrder: ["structure", "semantic", "timing", "delivery"],
  },
  {
    ref: { lensId: "decision-maker", revision: 1 },
    label: "의사결정자",
    description: "결정에 필요한 근거, 반론 대응, 다음 행동이 분명한지 봅니다.",
    priorityOrder: ["semantic", "structure", "timing", "delivery"],
  },
  {
    ref: { lensId: "strict-reviewer", revision: 1 },
    label: "엄격한 검토자",
    description: "주장과 근거의 연결, 누락된 조건, 표현의 정확성을 우선합니다.",
    priorityOrder: ["semantic", "delivery", "structure", "timing"],
  },
];

@Injectable()
export class EvaluatorLensesService {
  list() {
    return evaluatorLensRegistryResponseSchema.parse({ items: lenses });
  }
}
