import {
  appendDeckPatchResponseSchema,
  deckApiErrorSchema,
  getDeckResponseSchema,
  putDeckResponseSchema,
} from "@orbit/shared/deck";
import type { Deck, GetDeckResponse } from "@orbit/shared/deck";

import { applyKeywordsToDeck, buildReplaceKeywordsRequest } from "./keywordEditorModel";

const deckApiBasePath = "/api/v1";

export async function fetchProjectDeck(projectId: string): Promise<GetDeckResponse> {
  const response = await fetch(`${deckApiBasePath}/projects/${projectId}/deck`);

  if (!response.ok) {
    throw await toDeckApiError(response);
  }

  return getDeckResponseSchema.parse(await response.json());
}

export async function putProjectDeck(deck: Deck): Promise<Deck> {
  const response = await fetch(`${deckApiBasePath}/projects/${deck.projectId}/deck`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      deck,
      snapshotReason: "deck-replaced"
    })
  });

  if (!response.ok) {
    throw await toDeckApiError(response);
  }

  return putDeckResponseSchema.parse(await response.json()).deck;
}

export async function saveSlideKeywords(
  deck: Deck,
  slideId: string,
  keywords: Deck["slides"][number]["keywords"]
): Promise<Deck> {
  const response = await fetch(`${deckApiBasePath}/projects/${deck.projectId}/deck/patches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildReplaceKeywordsRequest(deck, slideId, keywords))
  });

  if (!response.ok) {
    throw await toDeckApiError(response);
  }

  return appendDeckPatchResponseSchema.parse(await response.json()).deck;
}

export async function persistSlideKeywords(
  deck: Deck,
  slideId: string,
  keywords: Deck["slides"][number]["keywords"],
  mode: "patch" | "put"
): Promise<Deck> {
  if (mode === "put") {
    return putProjectDeck(applyKeywordsToDeck(deck, slideId, keywords));
  }

  return saveSlideKeywords(deck, slideId, keywords);
}

async function toDeckApiError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => undefined);
  const parsed = deckApiErrorSchema.safeParse(payload);

  if (parsed.success) {
    return new Error(`${parsed.data.code}: ${parsed.data.message}`);
  }

  return new Error(`Deck API request failed: ${response.status}`);
}
