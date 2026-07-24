import { performance } from "node:perf_hooks";
import { io } from "socket.io-client";

const origin = "https://www.tryorbit.site";
const sessionId = "session_ced608a2-c4b0-43f4-831c-36a17f801375";
const activityId = "activity_1";
const audienceCount = 100;
const batchSize = 10;
const batchDelayMs = 1_000;
const requestTimeoutMs = 10_000;
const socketTimeoutMs = 10_000;
const eventSettleMs = 3_000;
const requiredConfirmation = "--confirm-write-100";

if (!process.argv.includes(requiredConfirmation)) {
  console.error("Safety stop: this test writes 100 real audience responses.");
  console.error(`Run again with: node .\\orbit-audience-websocket-load-test.mjs ${requiredConfirmation}`);
  process.exit(2);
}
if (new URL(origin).hostname !== "www.tryorbit.site") {
  throw new Error("Safety stop: only www.tryorbit.site is permitted.");
}
if (audienceCount !== 100 || batchSize > 10) {
  throw new Error("Safety stop: expected 100 users ramped in batches of at most 10.");
}

const joinUrl = `${origin}/api/v1/audience-sessions/${sessionId}/join`;
const activityUrl =
  `${origin}/api/v1/audience-sessions/${sessionId}/activities/${activityId}`;
const responseUrl = `${activityUrl}/response`;
const runId = `load-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const metrics = {
  join: [],
  socket: [],
  submit: [],
  verify: []
};
const audiences = [];

console.log("ORBIT 100-audience WebSocket + response load test");
console.log(`Target: ${origin}`);
console.log(`Session: ${sessionId}`);
console.log(`Activity: ${activityId}`);
console.log("Writes: 100 real test responses");
console.log("");

try {
  console.log("1/5 Joining 100 independent audience identities...");
  for (let offset = 0; offset < audienceCount; offset += batchSize) {
    const batch = Array.from(
      { length: Math.min(batchSize, audienceCount - offset) },
      (_, index) => joinAudience(offset + index + 1)
    );
    audiences.push(...(await Promise.all(batch)));
    printProgress("joined", audiences.length);
    if (audiences.length < audienceCount) await delay(batchDelayMs);
    stopOnFailureRate("join", metrics.join, 0.05);
  }

  console.log("2/5 Loading the active question definition...");
  const activity = await getJson(activityUrl, audiences[0], "activity preflight");
  if (activity?.run?.status !== "open") {
    throw new Error(`Activity must be open; received ${String(activity?.run?.status)}`);
  }
  const projectId = activity.run.presentationSessionId
    ? await readProjectId(audiences[0])
    : null;
  if (!projectId) throw new Error("Could not resolve projectId from audience access.");
  const definition = activity.run.definitionSnapshot;
  const questions = definition?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("The activity has no answerable questions.");
  }

  console.log("3/5 Connecting all audience WebSockets...");
  for (let offset = 0; offset < audienceCount; offset += batchSize) {
    const batch = audiences
      .slice(offset, offset + batchSize)
      .map((audience) => connectSocket(audience, projectId));
    await Promise.all(batch);
    printProgress("sockets connected", Math.min(offset + batchSize, audienceCount));
    if (offset + batchSize < audienceCount) await delay(batchDelayMs);
    stopOnFailureRate("socket", metrics.socket, 0.05);
  }

  console.log("4/5 Submitting one unique response per audience...");
  for (let offset = 0; offset < audienceCount; offset += batchSize) {
    const batch = audiences
      .slice(offset, offset + batchSize)
      .map((audience) => submitResponse(audience, definition));
    await Promise.all(batch);
    printProgress("responses submitted", Math.min(offset + batchSize, audienceCount));
    if (offset + batchSize < audienceCount) await delay(batchDelayMs);
    stopOnFailureRate("submit", metrics.submit, 0.05);
  }

  await delay(eventSettleMs);

  console.log("5/5 Verifying each audience can read its own response...");
  for (let offset = 0; offset < audienceCount; offset += batchSize) {
    await Promise.all(
      audiences.slice(offset, offset + batchSize).map((audience) => verifyOwnResponse(audience))
    );
    printProgress("responses verified", Math.min(offset + batchSize, audienceCount));
    stopOnFailureRate("verify", metrics.verify, 0.05);
  }

  printSummary();
  const failures = Object.values(metrics).flat().filter((item) => !item.ok).length;
  const socketsWithoutEvents = audiences.filter((audience) => audience.eventCount === 0).length;
  if (failures > 0 || socketsWithoutEvents > 0) {
    console.error(`Result: FAIL (request failures=${failures}, sockets without events=${socketsWithoutEvents})`);
    process.exitCode = 1;
  } else {
    console.log("Result: PASS");
  }
} catch (error) {
  console.error(`ABORTED: ${error instanceof Error ? error.message : String(error)}`);
  printSummary();
  process.exitCode = 1;
} finally {
  for (const audience of audiences) audience.socket?.disconnect();
}

async function joinAudience(index) {
  const audience = {
    index,
    userAgent: `orbit-load-test-${runId}-${index}`,
    cookie: "",
    socket: null,
    eventCount: 0,
    submittedMutationId: `load-${runId}-${String(index).padStart(3, "0")}`
  };
  const result = await timedFetch("join", joinUrl, {
    method: "POST",
    headers: jsonHeaders(audience),
    body: "{}"
  });
  metrics.join.push(result);
  if (!result.ok) throw new Error(`Audience ${index} join failed (${result.status})`);
  audience.cookie = readAudienceCookie(result.headers);
  if (!audience.cookie) throw new Error(`Audience ${index} did not receive an access cookie.`);
  return audience;
}

async function readProjectId(audience) {
  const url = `${origin}/api/v1/audience-sessions/${sessionId}/access`;
  const payload = await getJson(url, audience, "access");
  return payload?.session?.projectId ?? null;
}

async function connectSocket(audience, projectId) {
  const startedAt = performance.now();
  const socket = io(origin, {
    autoConnect: false,
    extraHeaders: {
      Cookie: audience.cookie,
      "User-Agent": audience.userAgent,
      Origin: origin
    },
    reconnection: false,
    transports: ["websocket"],
    timeout: socketTimeoutMs
  });
  audience.socket = socket;
  socket.on("activity-results-updated", (event) => {
    if (event?.sessionId === sessionId && event?.payload?.activityRunId) {
      audience.eventCount += 1;
    }
  });

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("connect timeout")), socketTimeoutMs);
      socket.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.connect();
    });
    const acknowledgement = await socket
      .timeout(socketTimeoutMs)
      .emitWithAck("presentation:audience:join", { projectId, sessionId });
    const ok =
      acknowledgement?.joined === true &&
      acknowledgement?.role === "audience" &&
      acknowledgement?.sessionId === sessionId;
    if (!ok) throw new Error("room acknowledgement rejected");
    metrics.socket.push({ ok: true, status: 200, durationMs: performance.now() - startedAt });
  } catch (error) {
    metrics.socket.push({ ok: false, status: 0, durationMs: performance.now() - startedAt });
    socket.disconnect();
    throw new Error(
      `Audience ${audience.index} socket failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function submitResponse(audience, definition) {
  const body = {
    clientMutationId: audience.submittedMutationId,
    answers: definition.questions.map((question) => createAnswer(question, audience.index)),
    ...(definition.allowDisplayName ? { displayName: `부하테스트 ${audience.index}` } : {})
  };
  const result = await timedFetch("submit", responseUrl, {
    method: "PUT",
    headers: jsonHeaders(audience, true),
    body: JSON.stringify(body)
  });
  metrics.submit.push(result);
  if (!result.ok) {
    throw new Error(`Audience ${audience.index} response failed (${result.status})`);
  }
}

async function verifyOwnResponse(audience) {
  const startedAt = performance.now();
  try {
    const payload = await getJson(activityUrl, audience, "verify");
    const ok = payload?.ownResponse?.answers?.length > 0;
    metrics.verify.push({ ok, status: ok ? 200 : 0, durationMs: performance.now() - startedAt });
  } catch {
    metrics.verify.push({ ok: false, status: 0, durationMs: performance.now() - startedAt });
  }
}

function createAnswer(question, index) {
  switch (question.type) {
    case "rating":
      return { questionId: question.questionId, type: "rating", value: ((index - 1) % 5) + 1 };
    case "single-choice":
      return {
        questionId: question.questionId,
        type: "single-choice",
        optionId: question.options[(index - 1) % question.options.length].optionId
      };
    case "multiple-choice":
      return {
        questionId: question.questionId,
        type: "multiple-choice",
        optionIds: [question.options[(index - 1) % question.options.length].optionId]
      };
    case "free-text":
      return {
        questionId: question.questionId,
        type: "free-text",
        text: `ORBIT 동시 청중 테스트 질문 ${String(index).padStart(3, "0")} (${runId})`
      };
    default:
      throw new Error(`Unsupported question type: ${String(question.type)}`);
  }
}

async function getJson(url, audience, label) {
  const result = await timedFetch(label, url, {
    headers: {
      Cookie: audience.cookie,
      "User-Agent": audience.userAgent
    }
  });
  if (!result.ok) throw new Error(`${label} failed (${result.status})`);
  return result.payload;
}

async function timedFetch(label, url, init) {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    const payload = await response.json().catch(() => null);
    return {
      label,
      ok: response.ok,
      status: response.status,
      durationMs: performance.now() - startedAt,
      headers: response.headers,
      payload
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: 0,
      durationMs: performance.now() - startedAt,
      headers: new Headers(),
      payload: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function jsonHeaders(audience, includeCookie = false) {
  return {
    "Content-Type": "application/json",
    Origin: origin,
    "User-Agent": audience.userAgent,
    ...(includeCookie ? { Cookie: audience.cookie } : {})
  };
}

function readAudienceCookie(headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);
  return (
    values
      .map((value) => value.split(";", 1)[0])
      .find((value) => value.startsWith("orbit_audience_access=")) ?? ""
  );
}

function stopOnFailureRate(stage, values, maximumRate) {
  if (values.length === 0) return;
  const failures = values.filter((item) => !item.ok).length;
  if (failures / values.length > maximumRate) {
    throw new Error(`${stage} failure rate exceeded ${maximumRate * 100}%`);
  }
}

function printProgress(label, count) {
  console.log(`  ${label}: ${count}/${audienceCount}`);
}

function printSummary() {
  console.log("");
  console.log("Summary");
  for (const [name, values] of Object.entries(metrics)) {
    if (values.length === 0) continue;
    const failures = values.filter((item) => !item.ok).length;
    console.log(
      `${name.padEnd(7)} count=${String(values.length).padStart(3)} ` +
        `fail=${String(failures).padStart(3)} p95=${percentile(
          values.map((item) => item.durationMs),
          0.95
        ).toFixed(1)} ms`
    );
  }
  if (audiences.length > 0) {
    const eventCounts = audiences.map((audience) => audience.eventCount);
    console.log(
      `events  total=${eventCounts.reduce((sum, value) => sum + value, 0)} ` +
        `min/socket=${Math.min(...eventCounts)} max/socket=${Math.max(...eventCounts)}`
    );
  }
}

function percentile(values, ratio) {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
