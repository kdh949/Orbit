import { activityApi } from "../api/activityApi";
import { canonicalActivityUrl } from "./ActivityAudienceSlideRenderer";

export type ActivityQrRuntimeState =
  | { status: "loading"; audienceUrl: null }
  | { status: "ready"; audienceUrl: string }
  | { status: "not-prepared" | "unavailable"; audienceUrl: null };

type RuntimeEntry = {
  listeners: Set<() => void>;
  refreshInFlight: boolean;
  state: ActivityQrRuntimeState;
  timerId: number | null;
};

const refreshIntervalMs = 10_000;
const notPreparedRetryMs = 1_000;
const entries = new Map<string, RuntimeEntry>();

export function subscribeActivityQrRuntime(
  input: ActivityQrRuntimeInput,
  listener: () => void
) {
  const key = toRuntimeKey(input);
  const entry = getEntry(key);
  const wasInactive = entry.listeners.size === 0;
  entry.listeners.add(listener);

  if (entry.timerId === null && typeof window !== "undefined") {
    if (wasInactive && entry.state.status === "ready") {
      entry.state = { status: "loading", audienceUrl: null };
    }
    void refreshActivityQrRuntime(input, entry);
  }

  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entry.timerId !== null) {
      window.clearTimeout(entry.timerId);
      entry.timerId = null;
    }
  };
}

export function getActivityQrRuntimeState(input: ActivityQrRuntimeInput) {
  return getEntry(toRuntimeKey(input)).state;
}

export type ActivityQrRuntimeInput = {
  activityId: string;
  deckId: string;
  projectId: string;
};

function getEntry(key: string): RuntimeEntry {
  const existing = entries.get(key);
  if (existing) return existing;

  const entry: RuntimeEntry = {
    listeners: new Set(),
    refreshInFlight: false,
    state: { status: "loading", audienceUrl: null },
    timerId: null
  };
  entries.set(key, entry);
  return entry;
}

async function refreshActivityQrRuntime(
  input: ActivityQrRuntimeInput,
  entry: RuntimeEntry
) {
  if (entry.refreshInFlight) return;
  entry.refreshInFlight = true;

  try {
    setRuntimeState(entry, await loadActivityQrRuntimeState(input));
  } catch {
    setRuntimeState(entry, { status: "unavailable", audienceUrl: null });
  } finally {
    entry.refreshInFlight = false;
    scheduleNextRefresh(input, entry);
  }
}

function scheduleNextRefresh(
  input: ActivityQrRuntimeInput,
  entry: RuntimeEntry
) {
  if (typeof window === "undefined" || entry.listeners.size === 0) return;

  if (entry.timerId !== null) {
    window.clearTimeout(entry.timerId);
  }
  entry.timerId = window.setTimeout(() => {
    entry.timerId = null;
    void refreshActivityQrRuntime(input, entry);
  }, entry.state.status === "not-prepared"
    ? notPreparedRetryMs
    : refreshIntervalMs);
}

/** Read-only runtime lookup used by all editor and presentation renderers. */
export async function loadActivityQrRuntimeState(
  input: ActivityQrRuntimeInput
): Promise<ActivityQrRuntimeState> {
  const current = await activityApi.getCurrentSession(input.projectId, input.deckId);
  if (!current.session || !current.audienceUrl) {
    return { status: "not-prepared", audienceUrl: null };
  }

  const { run } = await activityApi.getCurrentRun(
    input.projectId,
    current.session.sessionId,
    input.activityId
  );
  if (!run) {
    return { status: "not-prepared", audienceUrl: null };
  }

  return {
    status: "ready",
    audienceUrl: canonicalActivityUrl(current.audienceUrl, run.activityId)
  };
}

function setRuntimeState(entry: RuntimeEntry, nextState: ActivityQrRuntimeState) {
  if (
    entry.state.status === nextState.status &&
    entry.state.audienceUrl === nextState.audienceUrl
  ) {
    return;
  }
  entry.state = nextState;
  entry.listeners.forEach((listener) => listener());
}

function toRuntimeKey(input: ActivityQrRuntimeInput) {
  return `${input.projectId}:${input.deckId}:${input.activityId}`;
}
