import { loadOrbitConfig } from "@orbit/config";
import { realtimeTranscriptionClientSecretResponseSchema } from "@orbit/shared";
import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { z } from "zod";
import { serializeLogError } from "../logging";

export const REALTIME_TRANSCRIPTION_FETCH = "REALTIME_TRANSCRIPTION_FETCH";

const openAiClientSecretResponseSchema = z
  .object({
    expires_at: z.number().int().positive(),
    value: z.string().min(1)
  })
  .passthrough();

@Injectable()
export class RealtimeTranscriptionService {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });

  constructor(
    @Inject(REALTIME_TRANSCRIPTION_FETCH)
    private readonly fetcher: typeof fetch,
    @InjectPinoLogger(RealtimeTranscriptionService.name)
    private readonly logger: PinoLogger
  ) {}

  async createClientSecret(input: { projectId: string; userId: string }) {
    if (!this.config.OPENAI_API_KEY) {
      throw new ServiceUnavailableException("OpenAI API key is not configured.");
    }

    const safetyIdentifier = hashSafetyIdentifier(input.userId);
    let response: Response;
    try {
      response = await this.fetcher(
        "https://api.openai.com/v1/realtime/client_secrets",
        {
          body: JSON.stringify({
            expires_after: {
              anchor: "created_at",
              seconds: this.config.OPENAI_REALTIME_CLIENT_SECRET_TTL_SECONDS
            },
            session: {
              type: "transcription",
              audio: {
                input: {
                  transcription: {
                    model: this.config.OPENAI_REALTIME_TRANSCRIPTION_MODEL,
                    language: "ko",
                    delay: this.config.OPENAI_REALTIME_TRANSCRIPTION_DELAY
                  },
                  turn_detection: null
                }
              }
            }
          }),
          headers: {
            Authorization: `Bearer ${this.config.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
            "OpenAI-Safety-Identifier": safetyIdentifier
          },
          method: "POST",
          signal: AbortSignal.timeout(10_000)
        }
      );
    } catch (error) {
      this.logger.warn(
        {
          event: "openai.realtime_client_secret.unavailable",
          projectId: input.projectId,
          userIdHash: safetyIdentifier,
          error: serializeLogError(error)
        },
        "OpenAI Realtime client secret request unavailable."
      );
      throw new ServiceUnavailableException(
        "OpenAI Realtime client secret request unavailable."
      );
    }

    if (!response.ok) {
      this.logger.warn(
        {
          event: "openai.realtime_client_secret.failed",
          projectId: input.projectId,
          userIdHash: safetyIdentifier,
          status: response.status
        },
        "OpenAI Realtime client secret request failed."
      );
      throw new BadGatewayException("OpenAI Realtime client secret request failed.");
    }

    let responsePayload: unknown;
    try {
      responsePayload = await response.json();
    } catch (error) {
      this.logger.warn(
        {
          event: "openai.realtime_client_secret.invalid_response",
          projectId: input.projectId,
          userIdHash: safetyIdentifier,
          error: serializeLogError(error)
        },
        "OpenAI Realtime client secret response was not valid JSON."
      );
      throw new BadGatewayException("OpenAI Realtime client secret response is invalid.");
    }

    const parsed = openAiClientSecretResponseSchema.safeParse(responsePayload);
    if (!parsed.success) {
      this.logger.warn(
        {
          event: "openai.realtime_client_secret.invalid_response",
          projectId: input.projectId,
          userIdHash: safetyIdentifier,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        },
        "OpenAI Realtime client secret response did not match the expected schema."
      );
      throw new BadGatewayException("OpenAI Realtime client secret response is invalid.");
    }

    return realtimeTranscriptionClientSecretResponseSchema.parse({
      clientSecret: parsed.data.value,
      expiresAt: parsed.data.expires_at,
      model: this.config.OPENAI_REALTIME_TRANSCRIPTION_MODEL,
      delay: this.config.OPENAI_REALTIME_TRANSCRIPTION_DELAY
    });
  }
}

function hashSafetyIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
