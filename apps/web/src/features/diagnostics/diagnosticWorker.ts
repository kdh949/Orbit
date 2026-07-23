/// <reference lib="webworker" />

import type {
  DiagnosticSession,
  OrbitDiagnosticEvent
} from "./diagnosticTypes";
import {
  diagnosticEventStoreName,
  diagnosticRetentionMs,
  diagnosticSessionStoreName,
  openDiagnosticDatabase,
  transactionComplete,
  type DiagnosticWorkerInboundMessage,
  type DiagnosticWorkerOutboundMessage
} from "./diagnosticStore";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
let pendingOperation = Promise.resolve();

workerScope.addEventListener(
  "message",
  (event: MessageEvent<DiagnosticWorkerInboundMessage>) => {
    const message = event.data;
    if (message.type === "flush") {
      const requestId = message.requestId;
      void pendingOperation
        .then(() => {
          post({ type: "flushed", requestId });
        })
        .catch(reportWarning);
      return;
    }

    pendingOperation = pendingOperation
      .then(async () => {
        switch (message.type) {
          case "start-session": {
            const session = message.session;
            await runStorageOperation("retention", () =>
              pruneExpiredSessions(new Date(session.startedAt))
            );
            await runStorageOperation("start-session", () =>
              putSession(session)
            );
            return;
          }
          case "append-events": {
            const events = message.events;
            await runStorageOperation("append-events", () =>
              appendEvents(events)
            );
            return;
          }
          case "finish-session": {
            const session = message.session;
            await runStorageOperation("finish-session", () =>
              putSession(session)
            );
            return;
          }
        }
      })
      .catch(() => undefined);
  }
);

async function putSession(session: DiagnosticSession) {
  const database = await openDiagnosticDatabase();
  const transaction = database.transaction(
    diagnosticSessionStoreName,
    "readwrite"
  );
  transaction.objectStore(diagnosticSessionStoreName).put(session);
  await transactionComplete(transaction);
  database.close();
}

async function appendEvents(events: OrbitDiagnosticEvent[]) {
  if (events.length === 0) {
    return;
  }
  const database = await openDiagnosticDatabase();
  const transaction = database.transaction(
    diagnosticEventStoreName,
    "readwrite"
  );
  const store = transaction.objectStore(diagnosticEventStoreName);
  for (const event of events) {
    store.put(event);
  }
  await transactionComplete(transaction);
  database.close();
}

async function pruneExpiredSessions(now: Date) {
  const database = await openDiagnosticDatabase();
  const readTransaction = database.transaction(diagnosticSessionStoreName);
  const sessions = await requestResult<DiagnosticSession[]>(
    readTransaction.objectStore(diagnosticSessionStoreName).getAll()
  );
  const expiredSessionIds = sessions
    .filter(
      (session) =>
        now.getTime() - new Date(session.startedAt).getTime() >
        diagnosticRetentionMs
    )
    .map((session) => session.sessionId);
  if (expiredSessionIds.length === 0) {
    database.close();
    return;
  }

  const transaction = database.transaction(
    [diagnosticSessionStoreName, diagnosticEventStoreName],
    "readwrite"
  );
  const sessionStore = transaction.objectStore(diagnosticSessionStoreName);
  const eventStore = transaction.objectStore(diagnosticEventStoreName);
  for (const sessionId of expiredSessionIds) {
    sessionStore.delete(sessionId);
    eventStore.delete(
      IDBKeyRange.bound(
        [sessionId, Number.MIN_SAFE_INTEGER],
        [sessionId, Number.MAX_SAFE_INTEGER]
      )
    );
  }
  await transactionComplete(transaction);
  database.close();
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDBWorkerRequestFailed"));
  });
}

async function runStorageOperation(
  operation: string,
  action: () => Promise<void>
) {
  try {
    await action();
  } catch (cause) {
    reportWarning(cause, operation);
    throw cause;
  }
}

function reportWarning(cause: unknown, operation?: string) {
  const errorName =
    cause instanceof Error ? cause.name : "DiagnosticStorageError";
  post({
    type: "warning",
    errorName: operation ? `${operation}:${errorName}` : errorName
  });
}

function post(message: DiagnosticWorkerOutboundMessage) {
  workerScope.postMessage(message);
}
