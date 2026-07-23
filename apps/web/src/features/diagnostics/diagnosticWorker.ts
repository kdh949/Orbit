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
    if (event.data.type === "flush") {
      const requestId = event.data.requestId;
      void pendingOperation
        .then(() => {
          post({ type: "flushed", requestId });
        })
        .catch(reportWarning);
      return;
    }

    pendingOperation = pendingOperation
      .then(async () => {
        switch (event.data.type) {
          case "start-session":
            await pruneExpiredSessions(new Date(event.data.session.startedAt));
            await putSession(event.data.session);
            return;
          case "append-events":
            await appendEvents(event.data.events);
            return;
          case "finish-session":
            await putSession(event.data.session);
            return;
        }
      })
      .catch((cause: unknown) => {
        reportWarning(cause);
      });
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

function reportWarning(cause: unknown) {
  post({
    type: "warning",
    errorName: cause instanceof Error ? cause.name : "DiagnosticStorageError"
  });
}

function post(message: DiagnosticWorkerOutboundMessage) {
  workerScope.postMessage(message);
}
