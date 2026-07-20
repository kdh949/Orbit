import { createDemoDeck } from "@orbit/editor-core";
import type { DeckSnapshot } from "@orbit/shared";
import { describe, expect, it, vi } from "vitest";

import { fetchDeckSnapshot, fetchDeckSnapshots, restoreDeckSnapshot } from "./deckSnapshotApi";

describe("deck snapshot API", () => {
  it("lists project snapshot metadata with credentials", async () => {
    const deck = createDemoDeck();
    const snapshot = createSnapshot(deck.version, deck.projectId, deck.deckId);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      projectId: deck.projectId,
      snapshots: [snapshot],
    }), { status: 200 }));

    await expect(fetchDeckSnapshots(deck.projectId, fetcher)).resolves.toEqual([snapshot]);
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/projects/${deck.projectId}/snapshots`, { credentials: "include" });
  });

  it("fetches a selected snapshot with its Deck for preview", async () => {
    const deck = createDemoDeck();
    const snapshot = createSnapshot(deck.version, deck.projectId, deck.deckId);
    const detail = { ...snapshot, deck };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(detail), { status: 200 }));

    await expect(fetchDeckSnapshot(deck.projectId, snapshot.snapshotId, fetcher)).resolves.toEqual(detail);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/projects/${deck.projectId}/snapshots/${snapshot.snapshotId}`,
      { credentials: "include" },
    );
  });

  it("restores a selected snapshot through the shared restore contract", async () => {
    const deck = createDemoDeck();
    const snapshot = createSnapshot(deck.version, deck.projectId, deck.deckId);
    const payload = {
      deck,
      restoredSnapshot: snapshot,
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));

    await expect(restoreDeckSnapshot(deck.projectId, snapshot.snapshotId, fetcher)).resolves.toEqual(payload);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/projects/${deck.projectId}/snapshots/${snapshot.snapshotId}/restore`,
      { method: "POST", credentials: "include" },
    );
  });
});

function createSnapshot(version: number, projectId: string, deckId: string): DeckSnapshot {
  return {
    snapshotId: "snapshot_history_1",
    projectId,
    deckId,
    version,
    reason: "auto-save",
    createdAt: "2026-07-12T00:00:00.000Z",
  };
}
