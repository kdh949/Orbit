import { applyDeckPatch, createDemoDeck } from "@orbit/editor-core";
import {
  appendDeckPatchAckResponseSchema,
  appendDeckPatchRequestSchema,
  appendDeckPatchResponseSchema,
  deckApiErrorSchema,
  getDeckResponseSchema,
  getPptxImportQualityResponseSchema,
  putDeckResponseSchema,
  type AppendDeckPatchAckResponse,
  type Deck,
  type DeckApiErrorCode,
  type DeckPatch,
  type Job,
  type PptxImportQuality
} from "@orbit/shared";

import type {
  PatchProducer,
  SaveErrorCode,
  SaveState
} from "../hooks/useEditorPersistenceState";

export const ooxmlSyncJobEventName = "orbit:ooxml-sync-job";

export async function readResponseError(response: Response, fallbackMessage: string) {
  const text = await response.text();
  if (!text) return new DeckRequestError(fallbackMessage, response.status);

  try {
    const payload = deckApiErrorSchema.parse(JSON.parse(text));
    return new DeckRequestError(
      payload.message,
      response.status,
      payload.code,
      payload.details
    );
  } catch {
    return new DeckRequestError(text, response.status);
  }
}

export class DeckRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: DeckApiErrorCode,
    readonly details: string[] = []
  ) {
    super(message);
    this.name = "DeckRequestError";
  }
}

export function isDeckRequestErrorWithCode(
  error: unknown,
  code: DeckApiErrorCode
): error is DeckRequestError {
  return error instanceof DeckRequestError && error.code === code;
}

export function withSaveErrorCode(error: Error, saveErrorCode: SaveErrorCode) {
  (error as Error & { saveErrorCode?: SaveErrorCode }).saveErrorCode = saveErrorCode;
  return error;
}

export function resolvePatchInput(
  deck: Deck,
  patchInput: DeckPatch | PatchProducer
): DeckPatch {
  return typeof patchInput === "function" ? patchInput(deck) : patchInput;
}

export function buildPatchBatch(
  baseDeck: Deck,
  patchInputs: (DeckPatch | PatchProducer)[]
): { patch: DeckPatch; deck: Deck } {
  let workingDeck = baseDeck;
  const operations: DeckPatch["operations"] = [];
  let source: DeckPatch["source"] = "user";

  for (const patchInput of patchInputs) {
    const resolvedPatch = resolvePatchInput(workingDeck, patchInput);
    const nextPatch = {
      ...resolvedPatch,
      baseVersion: workingDeck.version
    } satisfies DeckPatch;
    const result = applyDeckPatch(workingDeck, nextPatch);

    if (!result.ok) {
      throw new Error("최신 내용과 충돌해 저장할 수 없습니다. 다시 저장해 주세요.");
    }

    operations.push(...nextPatch.operations);
    source = nextPatch.source;
    workingDeck = result.deck;
  }

  if (operations.length === 0) {
    throw new Error("저장할 변경 사항이 없습니다.");
  }

  return {
    patch: {
      deckId: baseDeck.deckId,
      baseVersion: baseDeck.version,
      operations,
      source
    },
    deck: workingDeck
  };
}

function createSeedDeck(projectId: string): Deck {
  return { ...createDemoDeck(), projectId };
}

export async function fetchProjectDeck(projectId: string): Promise<Deck | null> {
  const response = await fetch(`/api/v1/projects/${projectId}/deck`);
  if (response.status === 404) return null;
  if (!response.ok) throw await readResponseError(response, "Deck fetch failed");
  return getDeckResponseSchema.parse(await response.json()).deck;
}

export async function fetchPptxImportQuality(
  projectId: string
): Promise<PptxImportQuality | null> {
  const response = await fetch(`/api/v1/projects/${projectId}/deck/import-quality`);
  if (!response.ok) {
    throw await readResponseError(response, "PPTX import quality fetch failed");
  }
  return getPptxImportQualityResponseSchema.parse(await response.json()).importQuality;
}

export function hasPendingEditorChanges(args: {
  hasUnackedLocalChanges: boolean;
  pendingPatchCount: number;
  saveState: SaveState;
}) {
  return (
    args.hasUnackedLocalChanges ||
    args.pendingPatchCount > 0 ||
    args.saveState === "auto-pending" ||
    args.saveState === "auto-saving" ||
    args.saveState === "manual-saving" ||
    args.saveState === "error"
  );
}

export function consumeScheduledUndoRedoPersistLabel(args: {
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  labelRef: { current: string | null };
  timerRef: { current: ReturnType<typeof setTimeout> | null };
}) {
  const timer = args.timerRef.current;

  if (timer) {
    args.clearTimer(timer);
    args.timerRef.current = null;
  }

  const label = args.labelRef.current;
  args.labelRef.current = null;
  return label;
}

export async function flushEditorPersistenceBeforeManualAction(args: {
  flushPendingSaveBatch: () => Promise<void>;
  flushScheduledUndoRedoPersist: () => Promise<void>;
  hasPendingPatchInputs: () => boolean;
  waitForSaveQueue: () => Promise<void>;
}) {
  await args.flushScheduledUndoRedoPersist();
  await args.waitForSaveQueue();

  while (args.hasPendingPatchInputs()) {
    await args.flushPendingSaveBatch();
  }
}

export async function putProjectDeck(
  projectId: string,
  deck: Deck,
  options: { baseVersion?: number } = {}
): Promise<Deck> {
  const response = await fetch(`/api/v1/projects/${projectId}/deck`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseVersion: options.baseVersion,
      deck,
      snapshotReason: "deck-replaced"
    })
  });

  if (!response.ok) throw await readResponseError(response, "Deck bootstrap failed");

  const payload = putDeckResponseSchema.parse(await response.json());
  emitOoxmlSyncJob(payload.ooxmlSyncJob);
  return payload.deck;
}

export async function putProjectDeckWithConflictRecovery(args: {
  baseVersion: number;
  deck: Deck;
  projectId: string;
  fetchLatest?: (projectId: string) => Promise<Deck | null>;
  put?: (
    projectId: string,
    deck: Deck,
    options: { baseVersion?: number },
  ) => Promise<Deck>;
}): Promise<{ deck: Deck; recoveredConflict: boolean }> {
  const put = args.put ?? putProjectDeck;
  try {
    return {
      deck: await put(args.projectId, args.deck, {
        baseVersion: args.baseVersion,
      }),
      recoveredConflict: false,
    };
  } catch (error) {
    if (!isDeckRequestErrorWithCode(error, "STALE_BASE_VERSION")) throw error;
    const latestDeck = await (args.fetchLatest ?? fetchProjectDeck)(
      args.projectId,
    );
    if (!latestDeck) {
      throw new Error("최신 저장 상태를 다시 불러오지 못했습니다.");
    }
    return {
      deck: await put(args.projectId, args.deck, {
        baseVersion: latestDeck.version,
      }),
      recoveredConflict: true,
    };
  }
}

export function applyDeckPatchAcknowledgement(
  baseDeck: Deck,
  patch: DeckPatch,
  acknowledgement: AppendDeckPatchAckResponse
): Deck {
  const matchesRequest =
    acknowledgement.deckId === patch.deckId &&
    acknowledgement.changeRecord.deckId === patch.deckId &&
    acknowledgement.changeRecord.beforeVersion === patch.baseVersion &&
    acknowledgement.changeRecord.source === patch.source &&
    JSON.stringify(acknowledgement.changeRecord.operations) ===
      JSON.stringify(patch.operations);

  if (!matchesRequest) {
    throw new Error("Deck patch acknowledgement does not match the request");
  }

  const result = applyDeckPatch(baseDeck, patch, {
    createdAt: acknowledgement.changeRecord.createdAt
  });

  if (!result.ok || result.deck.version !== acknowledgement.version) {
    throw new Error("Deck patch acknowledgement version does not match the local result");
  }

  return result.deck;
}

export async function appendProjectDeckPatchAck(
  projectId: string,
  baseDeck: Deck,
  patch: DeckPatch
): Promise<Deck> {
  const request = appendDeckPatchRequestSchema.parse({ patch, responseMode: "ack" });
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/deck/patches`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    }
  );

  if (!response.ok) throw await readResponseError(response, "Deck save failed");

  const result = parseDeckPatchPersistenceResponse(
    baseDeck,
    request.patch,
    await response.json()
  );
  emitOoxmlSyncJob(result.ooxmlSyncJob);
  return result.deck;
}

export function parseDeckPatchPersistenceResponse(
  baseDeck: Deck,
  patch: DeckPatch,
  payload: unknown
): { deck: Deck; ooxmlSyncJob?: Job } {
  const acknowledgement = appendDeckPatchAckResponseSchema.safeParse(payload);
  if (acknowledgement.success) {
    return {
      deck: applyDeckPatchAcknowledgement(baseDeck, patch, acknowledgement.data),
      ooxmlSyncJob: acknowledgement.data.ooxmlSyncJob
    };
  }

  const legacyResponse = appendDeckPatchResponseSchema.safeParse(payload);
  if (legacyResponse.success) {
    return {
      deck: legacyResponse.data.deck,
      ooxmlSyncJob: legacyResponse.data.ooxmlSyncJob
    };
  }

  throw acknowledgement.error;
}

function emitOoxmlSyncJob(job: Job | undefined) {
  if (!job || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Job>(ooxmlSyncJobEventName, { detail: job }));
}

export async function fetchDeck(projectId: string): Promise<Deck> {
  const storedDeck = await fetchProjectDeck(projectId);
  return storedDeck ?? putProjectDeck(projectId, createSeedDeck(projectId));
}
