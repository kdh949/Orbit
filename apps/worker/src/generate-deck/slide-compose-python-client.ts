import { generateDeckValidationSchema, slideSchema } from "@orbit/shared/deck";
import { z } from "zod";

const slideComposeResponseSchema = z
  .object({
    slide: slideSchema,
    validation: generateDeckValidationSchema,
    warnings: z.array(z.string()),
    factDiagnostics: z
      .object({
        validationDurationMs: z.number().int().nonnegative(),
        issueCodes: z.array(z.string()),
        slideOrders: z.array(z.number().int().positive()),
        repairAttempted: z.boolean(),
        repairSucceeded: z.boolean(),
        repairDurationMs: z.number().int().nonnegative(),
      })
      .strict()
      .default({
        validationDurationMs: 0,
        issueCodes: [],
        slideOrders: [],
        repairAttempted: false,
        repairSucceeded: false,
        repairDurationMs: 0,
      }),
  })
  .strict();

export type SlideComposeResponse = z.infer<typeof slideComposeResponseSchema>;

export async function composeAiDeckSlide(
  pythonWorkerUrl: string,
  input: unknown,
): Promise<SlideComposeResponse> {
  let response: Response;
  try {
    response = await fetch(
      new URL(
        "/internal/ai/deck-generation/slide-compose",
        pythonWorkerUrl,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(180_000),
      },
    );
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Slide composition provider is unavailable.",
    );
  }
  if (!response.ok) {
    throw new Error((await response.text()) || "Slide composition failed.");
  }
  return slideComposeResponseSchema.parse(await response.json());
}
