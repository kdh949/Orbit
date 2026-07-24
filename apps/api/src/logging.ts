import { loadOrbitConfig, type OrbitConfig } from "@orbit/config";
import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { Params } from "nestjs-pino";
import type { Options as PinoHttpOptions } from "pino-http";

export const redactedPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "password",
  "*.password",
  "body.password",
  "payload.contentBase64",
  "payload.files.*.contentBase64",
  "contentBase64",
  "audioBase64",
  "rawAudio",
  "script",
  "transcript",
  "speakerNotes",
  "sdp",
  "candidate",
  "usernameFragment",
  "token",
  "points",
  "currentNotes",
  "suggestedNotes",
  "premise",
  "hypothesis",
  "semanticCueDecisions",
  "*.speakerNotes",
  "*.sdp",
  "*.candidate",
  "*.usernameFragment",
  "*.token",
  "*.points",
  "*.currentNotes",
  "*.suggestedNotes",
  "*.premise",
  "*.hypothesis",
  "*.semanticCueDecisions",
  "body.deck.slides.*.speakerNotes",
  "payload.deck.slides.*.speakerNotes",
  "payload.semanticCueDecisions",
  "result.semanticCueDecisions"
];

export function createApiLoggerParams(
  env: NodeJS.ProcessEnv = process.env
): Params {
  const config = loadOrbitConfig(env, { service: "api" });

  return {
    pinoHttp: createApiPinoHttpOptions(config),
    assignResponse: true
  };
}

export function serializeLogError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    message: String(error)
  };
}

export function writeBootstrapError(service: "api", error: unknown): void {
  const payload = {
    level: "fatal",
    time: new Date().toISOString(),
    service,
    event: "bootstrap.failed",
    error: serializeLogError(error),
    message: `${service} bootstrap failed.`
  };

  process.stderr.write(`${JSON.stringify(payload)}\n`);
}

function createApiPinoHttpOptions(
  config: OrbitConfig
): PinoHttpOptions {
  return {
    level: config.LOG_LEVEL,
    base: {
      service: "api",
      appEnv: config.APP_ENV
    },
    redact: {
      paths: redactedPaths,
      censor: "[Redacted]"
    },
    transport: createPrettyTransport(config),
    genReqId: (request, response) => {
      const requestId = readHeader(request.headers, "x-request-id") ?? randomUUID();
      response.setHeader("X-Request-ID", requestId);
      return requestId;
    },
    customProps: (request) => ({
      event: "http.request.completed",
      requestId: String(request.id ?? "")
    }),
    serializers: {
      req: (request) => ({
        id: request.id,
        method: request.method,
        url: sanitizeLogRequestUrl(request.url),
      }),
      res: (response) => ({
        statusCode: response.statusCode,
      }),
    },
    customSuccessMessage: (request, response, responseTime) =>
      `${request.method ?? "HTTP"} ${sanitizeLogRequestUrl(request.url)} ${response.statusCode} ${Math.round(responseTime)}ms`,
    customErrorMessage: (request, response, error) =>
      `${request.method ?? "HTTP"} ${sanitizeLogRequestUrl(request.url)} ${response.statusCode} ${error.message}`
  };
}

export function sanitizeLogRequestUrl(url: unknown): string {
  const value = typeof url === "string" ? url : "";
  return value.replace(
    /\/api\/v1\/presentation-companion\/pairings\/[^/?#]+\/exchange/g,
    "/api/v1/presentation-companion/pairings/[Redacted]/exchange",
  );
}

function createPrettyTransport(config: OrbitConfig) {
  if (!config.LOG_PRETTY) {
    return undefined;
  }

  return {
    target: "pino-pretty",
    options: {
      colorize: true,
      singleLine: true,
      translateTime: "SYS:standard"
    }
  };
}

function readHeader(
  headers: IncomingHttpHeaders,
  key: keyof IncomingHttpHeaders
): string | undefined {
  const value = headers[key];
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}
