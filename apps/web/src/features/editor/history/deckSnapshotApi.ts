import {
  deckSnapshotDetailSchema,
  listDeckSnapshotsResponseSchema,
  restoreDeckSnapshotResponseSchema,
  type DeckSnapshot,
  type DeckSnapshotDetail,
  type RestoreDeckSnapshotResponse,
} from "@orbit/shared";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchDeckSnapshots(
  projectId: string,
  fetcher: Fetcher = fetch,
): Promise<DeckSnapshot[]> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/snapshots`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("버전 기록을 불러오지 못했습니다.");
  return listDeckSnapshotsResponseSchema.parse(await response.json()).snapshots;
}

export async function fetchDeckSnapshot(
  projectId: string,
  snapshotId: string,
  fetcher: Fetcher = fetch,
): Promise<DeckSnapshotDetail> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("선택한 버전을 불러오지 못했습니다.");
  return deckSnapshotDetailSchema.parse(await response.json());
}

export async function restoreDeckSnapshot(
  projectId: string,
  snapshotId: string,
  fetcher: Fetcher = fetch,
): Promise<RestoreDeckSnapshotResponse> {
  const response = await fetcher(
    `/api/v1/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) throw new Error("선택한 버전을 복원하지 못했습니다.");
  return restoreDeckSnapshotResponseSchema.parse(await response.json());
}
