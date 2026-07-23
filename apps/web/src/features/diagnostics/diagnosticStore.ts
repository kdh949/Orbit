import type {
  DiagnosticEventWriter,
  DiagnosticSession,
  OrbitDiagnosticEvent
} from "./diagnosticTypes";

export const diagnosticDatabaseName = "orbit-presentation-diagnostics";
export const diagnosticDatabaseVersion = 1;
export const diagnosticSessionStoreName = "diagnosticSessions";
export const diagnosticEventStoreName = "diagnosticEvents";
export const diagnosticRetentionMs = 7 * 24 * 60 * 60 * 1000;

export type DiagnosticWorkerInboundMessage =
  | { type: "start-session"; session: DiagnosticSession }
  | { type: "append-events"; events: OrbitDiagnosticEvent[] }
  | { type: "finish-session"; session: DiagnosticSession }
  | { type: "flush"; requestId: string };

export type DiagnosticWorkerOutboundMessage =
  | { type: "flushed"; requestId: string }
  | { type: "warning"; errorName: string };

type DiagnosticWorkerLike = {
  addEventListener: {
    (
      type: "error",
      listener: (event: Event) => void
    ): void;
    (
      type: "message",
      listener: (event: MessageEvent<DiagnosticWorkerOutboundMessage>) => void
    ): void;
  };
  postMessage: (message: DiagnosticWorkerInboundMessage) => void;
  terminate?: () => void;
};

type DiagnosticWorkerWriterOptions = {
  batchIntervalMs?: number;
  batchSize?: number;
  createId?: () => string;
  createWorker?: () => DiagnosticWorkerLike;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

export class DiagnosticWorkerWriter implements DiagnosticEventWriter {
  private readonly batchIntervalMs: number;
  private readonly batchSize: number;
  private readonly createId: () => string;
  private readonly clearTimer: NonNullable<
    DiagnosticWorkerWriterOptions["clearTimer"]
  >;
  private readonly setTimer: NonNullable<
    DiagnosticWorkerWriterOptions["setTimer"]
  >;
  private readonly worker: DiagnosticWorkerLike;
  private batch: OrbitDiagnosticEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushResolvers = new Map<
    string,
    { reject: (cause: Error) => void; resolve: () => void }
  >();
  private readonly warningListeners = new Set<(warning: string) => void>();

  constructor(options: DiagnosticWorkerWriterOptions = {}) {
    this.batchIntervalMs = options.batchIntervalMs ?? 250;
    this.batchSize = options.batchSize ?? 50;
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.setTimer = options.setTimer ?? setTimeout;
    this.worker = options.createWorker?.() ?? createDiagnosticWorker();
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleWorkerError);
  }

  startSession(session: DiagnosticSession) {
    this.worker.postMessage({ type: "start-session", session });
  }

  append(event: OrbitDiagnosticEvent) {
    this.batch.push(event);
    if (this.batch.length >= this.batchSize) {
      this.postBatch();
      return;
    }
    if (this.timer === null) {
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.postBatch();
      }, this.batchIntervalMs);
    }
  }

  finishSession(session: DiagnosticSession) {
    this.postBatch();
    this.worker.postMessage({ type: "finish-session", session });
  }

  flush() {
    this.postBatch();
    const requestId = this.createId();
    return new Promise<void>((resolve, reject) => {
      this.flushResolvers.set(requestId, { reject, resolve });
      this.worker.postMessage({ type: "flush", requestId });
    });
  }

  subscribeWarnings(listener: (warning: string) => void) {
    this.warningListeners.add(listener);
    return () => {
      this.warningListeners.delete(listener);
    };
  }

  private postBatch() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.batch.length === 0) {
      return;
    }
    const events = this.batch;
    this.batch = [];
    this.worker.postMessage({ type: "append-events", events });
  }

  private readonly handleMessage = (
    event: MessageEvent<DiagnosticWorkerOutboundMessage>
  ) => {
    if (event.data.type === "warning") {
      this.notifyWarning(event.data.errorName);
      return;
    }
    const resolver = this.flushResolvers.get(event.data.requestId);
    if (!resolver) {
      return;
    }
    this.flushResolvers.delete(event.data.requestId);
    resolver.resolve();
  };

  private readonly handleWorkerError = (event: Event) => {
    const error = new Error("DiagnosticWorkerError");
    for (const resolver of this.flushResolvers.values()) {
      resolver.reject(error);
    }
    this.flushResolvers.clear();
    this.notifyWarning(
      "message" in event && typeof event.message === "string"
        ? event.message
        : error.name
    );
  };

  private notifyWarning(warning: string) {
    for (const listener of this.warningListeners) {
      listener(warning);
    }
  }
}

export function createDiagnosticWorker(): DiagnosticWorkerLike {
  if (typeof Worker === "undefined") {
    throw new Error("DiagnosticWorkerUnavailable");
  }
  return new Worker(new URL("./diagnosticWorker.ts", import.meta.url));
}

export async function listDiagnosticSessions(): Promise<DiagnosticSession[]> {
  const database = await openDiagnosticDatabase();
  const sessions = await requestResult<DiagnosticSession[]>(
    database
      .transaction(diagnosticSessionStoreName)
      .objectStore(diagnosticSessionStoreName)
      .getAll()
  );
  database.close();
  return sessions.sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt)
  );
}

export async function readDiagnosticSessionEvents(
  sessionId: string,
  limit = 500
): Promise<OrbitDiagnosticEvent[]> {
  const database = await openDiagnosticDatabase();
  const transaction = database.transaction(diagnosticEventStoreName);
  const store = transaction.objectStore(diagnosticEventStoreName);
  const range = IDBKeyRange.bound(
    [sessionId, Number.MIN_SAFE_INTEGER],
    [sessionId, Number.MAX_SAFE_INTEGER]
  );
  const events = await readCursor<OrbitDiagnosticEvent>(store, range, limit);
  database.close();
  return events.reverse();
}

export async function deleteAllDiagnosticSessions() {
  const database = await openDiagnosticDatabase();
  const transaction = database.transaction(
    [diagnosticSessionStoreName, diagnosticEventStoreName],
    "readwrite"
  );
  transaction.objectStore(diagnosticSessionStoreName).clear();
  transaction.objectStore(diagnosticEventStoreName).clear();
  await transactionComplete(transaction);
  database.close();
}

export async function openDiagnosticDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDBUnavailable");
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      diagnosticDatabaseName,
      diagnosticDatabaseVersion
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(diagnosticSessionStoreName)) {
        database.createObjectStore(diagnosticSessionStoreName, {
          keyPath: "sessionId"
        });
      }
      if (!database.objectStoreNames.contains(diagnosticEventStoreName)) {
        const store = database.createObjectStore(diagnosticEventStoreName, {
          keyPath: ["sessionId", "seq"]
        });
        store.createIndex("sessionId", "sessionId");
        store.createIndex("stage", "stage");
        store.createIndex("name", "name");
        store.createIndex("triggerTraceId", "trace.triggerTraceId");
        store.createIndex("slideId", "trace.slideId");
        store.createIndex("outcome", "outcome");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBOpenFailed"));
  });
}

function readCursor<T>(
  store: IDBObjectStore,
  range: IDBKeyRange,
  limit: number
) {
  return new Promise<T[]>((resolve, reject) => {
    const values: T[] = [];
    const request = store.openCursor(range, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || values.length >= limit) {
        resolve(values);
        return;
      }
      values.push(cursor.value as T);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDBCursorFailed"));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBRequestFailed"));
  });
}

export function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDBTransactionFailed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDBTransactionAborted"));
  });
}
