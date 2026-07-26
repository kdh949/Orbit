import type { AiDeckGenerationStageMessage } from "@orbit/shared/jobs";
import { createHash } from "node:crypto";
import { z } from "zod";

const safeContractPathSegments = new Set([
  "request",
  "rawInput",
  "contentPlan",
  "designPlan",
  "layoutResult",
  "visualRequirements",
  "workerPayload",
  "deck",
  "slides",
  "elements",
  "validation",
  "diagnostics",
  "result",
]);

export type AiDeckStageEventLogger = (
  event: string,
  fields: Record<string, unknown>,
) => void;

export type SafeStageErrorDiagnostics = {
  code: string;
  reasonCode: string;
  name: string;
  httpStatus?: number;
  providerHttpStatus?: number;
  provider?: string;
  providerRequestId?: string;
  retryAfterMs?: number;
  topFrame?: string;
  messageFingerprint?: string;
  issueCodes?: string[];
  issueCount?: number;
  unresolvedMediaCount?: number;
  contractPaths?: string[];
};

export function stageEventFields(
  message: AiDeckGenerationStageMessage,
  workerId: string,
  attempt: number,
  startedAt: number,
  terminal?: boolean,
  error?: SafeStageErrorDiagnostics,
): Record<string, unknown> {
  return {
    pipelineJobId: message.pipelineJobId,
    projectId: message.projectId,
    stage: message.stage,
    shardKey: message.shardKey,
    workerId,
    attempt,
    maxAttempts: 5,
    ...(terminal === undefined ? {} : { terminal }),
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(error ? { error } : {}),
  };
}

export function unknownErrorDiagnostics(
  error: unknown,
  code: string,
  reasonCode: string,
): SafeStageErrorDiagnostics {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : String(error);
  return compactDiagnostics({
    code,
    reasonCode,
    name,
    topFrame: repositoryTopFrame(error),
    messageFingerprint: createHash("sha256")
      .update(`${name}\u0000${message}`)
      .digest("hex")
      .slice(0, 16),
  });
}

export function contractErrorDiagnostics(
  error: z.ZodError,
  code: string,
  reasonCode: string,
): SafeStageErrorDiagnostics {
  return {
    code,
    reasonCode,
    name: error.name,
    contractPaths: [
      ...new Set(
        error.issues
          .map((issue) =>
            issue.path
              .map((segment) =>
                typeof segment === "number"
                  ? "*"
                  : safeContractPathSegments.has(segment)
                    ? segment
                    : "*",
              )
              .join("."),
          )
          .filter((path) => path.length > 0),
      ),
    ].slice(0, 8),
  };
}

export function emitStageEvent(
  logger: AiDeckStageEventLogger | undefined,
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    logger?.(event, fields);
  } catch {
    // Diagnostic logging must not change generation behavior.
  }
}

export function compactDiagnostics(
  diagnostics: SafeStageErrorDiagnostics,
): SafeStageErrorDiagnostics {
  return Object.fromEntries(
    Object.entries(diagnostics).filter(([, value]) => value !== undefined),
  ) as SafeStageErrorDiagnostics;
}

function repositoryTopFrame(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  for (const line of error.stack.split("\n").slice(1)) {
    const match = line.match(
      /[\\/](apps|packages|services)[\\/]([^():]+(?:[\\/][^():]+)*):(\d+)(?::\d+)?/,
    );
    if (!match) continue;
    return `${match[1]}/${match[2].replaceAll("\\", "/")}:${match[3]}`;
  }
  return undefined;
}
