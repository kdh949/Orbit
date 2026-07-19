import { z } from "zod";

import { deckAnimationIdSchema, deckElementIdSchema } from "./id.schema";

export const animationTypeSchema = z.enum([
  "appear",
  "disappear",
  "fade-in",
  "fade-out",
  "zoom-in",
  "zoom-out",
  "rotate"
]);

export const animationEasingSchema = z.enum([
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out"
]);

export const animationStartModeSchema = z.enum([
  "on-slide-enter",
  "on-click",
  "with-previous",
  "after-previous"
]);

export const animationSchema = z.object({
  animationId: deckAnimationIdSchema,
  elementId: deckElementIdSchema,
  type: animationTypeSchema,
  order: z.number().int().positive(),
  startMode: animationStartModeSchema.optional(),
  durationMs: z.number().int().positive().default(400),
  delayMs: z.number().int().nonnegative().default(0),
  easing: animationEasingSchema.default("ease-out")
});

export type DeckAnimationType = z.infer<typeof animationTypeSchema>;
export type DeckAnimationEasing = z.infer<typeof animationEasingSchema>;
export type DeckAnimationStartMode = z.infer<typeof animationStartModeSchema>;
export type DeckAnimation = z.infer<typeof animationSchema>;
