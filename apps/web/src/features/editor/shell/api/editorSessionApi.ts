import { demoIds, meResponseSchema } from "@orbit/shared";

import { readResponseError } from "./deckPersistenceApi";
import type { EditorSessionDebugState } from "../editorSession.model";

export interface HealthResponse {
  status: string;
  app: string;
  demo: typeof demoIds;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error("API health check failed");
  }
  return response.json() as Promise<HealthResponse>;
}

export async function fetchEditorSessionDebug(): Promise<
  Exclude<EditorSessionDebugState, { status: "idle" | "loading" | "error" }>
> {
  const response = await fetch("/api/v1/auth/me", {
    credentials: "include"
  });

  if (!response.ok) {
    throw await readResponseError(response, "Session fetch failed");
  }

  const session = meResponseSchema.parse(await response.json());
  return {
    authenticatedAt: session.authenticatedAt,
    email: session.user.email,
    expiresAt: session.expiresAt,
    status: "ready",
    userId: session.user.userId
  };
}
