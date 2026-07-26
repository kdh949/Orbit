import { createDemoDeck } from "@orbit/editor-core";
import type {
  AppendDeckPatchResponse,
  Deck,
  DeckChangeRecord,
  DeckSnapshot,
  GetDeckResponse,
  Keyword,
  PutDeckResponse,
} from "@orbit/shared/deck";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchProjectDeck, putProjectDeck, saveSlideKeywords } from "./keywordEditorApi";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function createSnapshot(deck: Deck, reason: DeckSnapshot["reason"]): DeckSnapshot {
  return {
    snapshotId: `snapshot_${reason.replaceAll("-", "_")}`,
    projectId: deck.projectId,
    deckId: deck.deckId,
    version: deck.version,
    reason,
    createdAt: "2026-06-29T00:00:00.000Z"
  };
}

function applyKeywordsForResponse(
  deck: Deck,
  slideId: string,
  keywords: Keyword[]
): Deck {
  return {
    ...deck,
    version: deck.version + 1,
    slides: deck.slides.map((slide) =>
      slide.slideId === slideId ? { ...slide, keywords } : slide
    )
  };
}

function createChangeRecord(
  deck: Deck,
  updatedDeck: Deck,
  operations: DeckChangeRecord["operations"]
): DeckChangeRecord {
  return {
    changeId: "change_keywords_saved",
    deckId: deck.deckId,
    beforeVersion: deck.version,
    afterVersion: updatedDeck.version,
    source: "user",
    createdAt: "2026-06-29T00:00:00.000Z",
    operations
  };
}

describe("keyword editor API helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a project deck from the shared deck API path", async () => {
    const deck = createDemoDeck();
    const payload: GetDeckResponse = {
      projectId: deck.projectId,
      deck,
      updatedAt: "2026-06-29T00:00:00.000Z"
    };
    const fetcher = vi.fn(async () => jsonResponse(payload));

    vi.stubGlobal("fetch", fetcher);

    await expect(fetchProjectDeck(deck.projectId)).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/projects/${deck.projectId}/deck`);
  });

  it("replaces a project deck through the shared deck API path", async () => {
    const deck = createDemoDeck();
    const payload: PutDeckResponse = {
      deck,
      snapshot: createSnapshot(deck, "deck-replaced"),
      updatedAt: "2026-06-29T00:00:00.000Z"
    };
    const fetcher = vi.fn(async () => jsonResponse(payload));

    vi.stubGlobal("fetch", fetcher);

    await expect(putProjectDeck(deck)).resolves.toEqual(deck);
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/projects/${deck.projectId}/deck`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deck,
        snapshotReason: "deck-replaced"
      })
    });
  });

  it("saves slide keywords through the shared deck patch API path", async () => {
    const deck = createDemoDeck();
    const slideId = deck.slides[0].slideId;
    const keywords: Keyword[] = [
      {
        keywordId: "kw_rehearsal",
        text: "리허설",
        synonyms: ["발표 연습"],
        abbreviations: ["STT"],
        required: true
      }
    ];
    const updatedDeck = applyKeywordsForResponse(deck, slideId, keywords);
    const operations: DeckChangeRecord["operations"] = [
      {
        type: "replace_keywords",
        slideId,
        keywords
      }
    ];
    const payload: AppendDeckPatchResponse = {
      deck: updatedDeck,
      changeRecord: createChangeRecord(deck, updatedDeck, operations),
      snapshot: createSnapshot(updatedDeck, "patch-applied"),
      updatedAt: "2026-06-29T00:00:00.000Z"
    };
    const fetcher = vi.fn(async () => jsonResponse(payload));

    vi.stubGlobal("fetch", fetcher);

    await expect(saveSlideKeywords(deck, slideId, keywords)).resolves.toEqual(
      updatedDeck
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/projects/${deck.projectId}/deck/patches`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          patch: {
            deckId: deck.deckId,
            baseVersion: deck.version,
            source: "user",
            operations
          },
          snapshotReason: "patch-applied"
        })
      }
    );
  });
});
