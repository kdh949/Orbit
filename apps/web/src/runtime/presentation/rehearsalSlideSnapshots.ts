import type { CreateRehearsalRunRequest } from "@orbit/shared";

type SlideSnapshots = NonNullable<CreateRehearsalRunRequest["slideSnapshots"]>;

type PreparedSlideSnapshots = {
  deckId: string;
  deckVersion: number;
  projectId: string;
  snapshots: SlideSnapshots;
};

const storageKeyPrefix = "orbit.rehearsalSlideSnapshots.v1";

export function storePreparedRehearsalSlideSnapshots(input: PreparedSlideSnapshots) {
  const preparationId = crypto.randomUUID();
  sessionStorage.setItem(
    `${storageKeyPrefix}:${preparationId}`,
    JSON.stringify(input),
  );
  return preparationId;
}

export function readPreparedRehearsalSlideSnapshots(input: {
  deckId: string;
  deckVersion: number;
  preparationId?: string;
  projectId: string;
}): SlideSnapshots | undefined {
  if (!input.preparationId) {
    return undefined;
  }

  const key = `${storageKeyPrefix}:${input.preparationId}`;
  const serialized = sessionStorage.getItem(key);
  if (!serialized) {
    return undefined;
  }

  try {
    const prepared = JSON.parse(serialized) as PreparedSlideSnapshots;
    if (
      prepared.projectId !== input.projectId ||
      prepared.deckId !== input.deckId ||
      prepared.deckVersion !== input.deckVersion ||
      !Array.isArray(prepared.snapshots)
    ) {
      return undefined;
    }

    return prepared.snapshots;
  } catch {
    sessionStorage.removeItem(key);
    return undefined;
  }
}

export function clearPreparedRehearsalSlideSnapshots(preparationId?: string) {
  if (!preparationId) return;
  sessionStorage.removeItem(`${storageKeyPrefix}:${preparationId}`);
}
