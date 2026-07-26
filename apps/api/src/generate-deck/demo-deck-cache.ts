import type { OrbitConfig } from "@orbit/config";
import { deckSchema, type Deck } from "@orbit/shared/deck";
import { ServiceUnavailableException } from "@nestjs/common";

type QueryExecutor = {
  query(query: string, parameters?: unknown[]): Promise<unknown>;
};

export const demoDeckCacheUnavailableCode = "DEMO_DECK_CACHE_UNAVAILABLE";

export function normalizeDemoDeckTopic(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isDemoDeckCacheRequest(
  config: OrbitConfig,
  requestedByUserId: string | undefined,
  topic: string,
): boolean {
  const trigger = config.DEMO_AI_DECK_TRIGGER_TOPIC;
  return Boolean(
    config.DEMO_AI_DECK_CACHE_ENABLED &&
      config.DEMO_FIXTURE_ENV_ALLOWLIST.includes(config.APP_ENV) &&
      requestedByUserId === config.DEMO_USER_ID &&
      config.DEMO_AI_DECK_SOURCE_PROJECT_ID &&
      trigger &&
      normalizeDemoDeckTopic(topic) === normalizeDemoDeckTopic(trigger),
  );
}

export async function readDemoDeckCache(
  executor: QueryExecutor,
  sourceProjectId: string,
  requestedByUserId?: string,
): Promise<Deck> {
  const row = firstRow(
    await executor.query(
      `SELECT decks.deck_json FROM decks
       WHERE decks.project_id = $1
         AND ($2::text IS NULL OR EXISTS (
           SELECT 1 FROM project_members
           WHERE project_members.project_id = decks.project_id
             AND project_members.user_id = $2
             AND project_members.status = 'accepted'
         ))
       LIMIT 1`,
      [sourceProjectId, requestedByUserId ?? null],
    ),
  );
  const parsed = deckSchema.safeParse(row?.deck_json);
  if (!parsed.success) throw demoDeckCacheUnavailable();
  return parsed.data;
}

export function demoDeckCacheUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: demoDeckCacheUnavailableCode,
    message: "The configured demo AI deck cache is unavailable.",
  });
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  const first = Array.isArray(value[0]) ? value[0][0] : value[0];
  return first && typeof first === "object"
    ? (first as Record<string, unknown>)
    : null;
}
