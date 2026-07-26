import type { DeckSnapshot } from "@orbit/shared/deck";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../slides/rendering", () => ({
  ReadOnlySlideCanvas: () => null,
}));

import {
  resolveCurrentSnapshotId,
  snapshotLabel,
  snapshotTone,
} from "./DeckVersionHistoryPage";

const snapshot: DeckSnapshot = {
  snapshotId: "snapshot_history_1",
  projectId: "project_history_1",
  deckId: "deck_history_1",
  version: 1,
  reason: "deck-replaced",
  createdAt: "2026-07-12T00:00:00.000Z",
};

describe("DeckVersionHistoryPage", () => {
  it("현재 스냅샷과 다른 기록을 현재 상태로 표시하지 않는다", () => {
    expect(snapshotLabel(snapshot, "snapshot_history_3")).toBe("전체 교체");
    expect(snapshotTone(snapshot, "snapshot_history_3")).toBe("neutral");
  });

  it("현재 스냅샷만 현재 상태로 표시한다", () => {
    expect(snapshotLabel(snapshot, snapshot.snapshotId)).toBe("현재 상태");
    expect(snapshotTone(snapshot, snapshot.snapshotId)).toBe("primary");
  });

  it("같은 버전 기록이 여러 개면 최신 기록 하나만 현재 상태로 선택한다", () => {
    const older = { ...snapshot, snapshotId: "snapshot_history_older" };
    const latest = {
      ...snapshot,
      snapshotId: "snapshot_history_latest",
      reason: "snapshot-restore" as const,
    };

    expect(resolveCurrentSnapshotId([latest, older], snapshot.version)).toBe(
      latest.snapshotId,
    );
    expect(snapshotLabel(latest, latest.snapshotId)).toBe("현재 상태");
    expect(snapshotLabel(older, latest.snapshotId)).toBe("전체 교체");
  });
});
