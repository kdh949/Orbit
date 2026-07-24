import { z } from "zod";

import { liveSttEngineSchema } from "./runtime";

export const runtimeConfigResponseSchema = z
  .object({
    liveSttEngine: liveSttEngineSchema,
    ipadPresenterCompanionEnabled: z.boolean(),
    adaptiveRehearsalCoachEnabled: z.boolean(),
    focusedPracticeEnabled: z.boolean(),
    challengeQnaEnabled: z.boolean(),
    slidePracticeEnabled: z.boolean(),
    slideQuestionGuidesEnabled: z.boolean(),
  })
  .strict();

export type RuntimeConfigResponse = z.infer<typeof runtimeConfigResponseSchema>;

export const coachingCapabilitiesResponseSchema = z.object({
  adaptiveRehearsalCoachEnabled: z.boolean(),
  focusedPracticeEnabled: z.boolean(),
  challengeQnaEnabled: z.boolean(),
}).strict();
export type CoachingCapabilitiesResponse = z.infer<typeof coachingCapabilitiesResponseSchema>;
