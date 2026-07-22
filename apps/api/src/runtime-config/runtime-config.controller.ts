import { loadOrbitConfig } from "@orbit/config";
import { runtimeConfigResponseSchema } from "@orbit/shared";
import { Controller, Get } from "@nestjs/common";

@Controller("api/v1/runtime-config")
export class RuntimeConfigController {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });

  @Get()
  getRuntimeConfig() {
    return runtimeConfigResponseSchema.parse({
      liveSttEngine: this.config.LIVE_STT_ENGINE,
      adaptiveRehearsalCoachEnabled:
        this.config.ADAPTIVE_REHEARSAL_COACH_ENABLED,
      focusedPracticeEnabled: this.config.FOCUSED_PRACTICE_ENABLED,
      challengeQnaEnabled: this.config.CHALLENGE_QNA_ENABLED,
      slidePracticeEnabled: this.config.SLIDE_PRACTICE_ENABLED,
      slideQuestionGuidesEnabled: this.config.SLIDE_QUESTION_GUIDES_ENABLED,
      ooxmlReferenceTemplatesEnabled:
        this.config.AI_PPT_OOXML_REFERENCE_TEMPLATES_ENABLED,
    });
  }
}
