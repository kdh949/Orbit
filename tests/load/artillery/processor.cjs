const { performance } = require("node:perf_hooks");
const { randomUUID } = require("node:crypto");
const { io } = require("socket.io-client");

const REALTIME_PROFILES = {
  smoke: { rampDurationMs: 0, submissionWindowMs: 0 },
  average: { rampDurationMs: 60_000, submissionWindowMs: 30_000 },
  load: { rampDurationMs: 120_000, submissionWindowMs: 10_000 },
  stress: { rampDurationMs: 180_000, submissionWindowMs: 3_000 },
  acceptance: { rampDurationMs: 300_000, submissionWindowMs: 60_000 },
};

module.exports = {
  assertSafety,
  findRevisionAtOrAbove,
  getRealtimeProfile,
  runRealtimeScenario,
};

function assertSafety(_context, _events, done) {
  try {
    validateEnvironment();
    done();
  } catch (error) {
    done(error);
  }
}

async function runRealtimeScenario(context, events) {
  let socket;
  try {
    const env = validateEnvironment();
    const timeoutMs = env.profile === "smoke" ? 5_000 : 10_000;
    const virtualUserId = randomUUID();
    const userAgent = `orbit-artillery-${process.pid}-${virtualUserId}`;
    const join = await fetch(
      `${env.baseUrl}/api/v1/audience-sessions/${env.sessionId}/join`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: env.baseUrl,
          "user-agent": userAgent,
          ...(env.bypassToken
            ? { "x-orbit-load-test-token": env.bypassToken }
            : {}),
        },
        body: JSON.stringify(env.passcode ? { passcode: env.passcode } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (join.status !== 201)
      throw new Error(`audience join failed: ${join.status}`);
    const cookie = join.headers.get("set-cookie")?.split(";", 1)[0];
    if (!cookie) throw new Error("audience join did not return a cookie");

    socket = io(env.baseUrl, {
      autoConnect: false,
      extraHeaders: {
        Cookie: cookie,
        Origin: env.baseUrl,
        "User-Agent": userAgent,
      },
      reconnection: false,
      timeout: timeoutMs,
      transports: ["websocket"],
    });
    await connect(socket);
    const acknowledgement = await socket
      .timeout(timeoutMs)
      .emitWithAck("presentation:audience:join", {
        projectId: env.projectId,
        sessionId: env.sessionId,
      });
    if (acknowledgement?.joined !== true)
      throw new Error("audience room join was rejected");

    await waitForScheduledSubmission(virtualUserId, env);
    const startedAt = performance.now();
    const revisions = new Map();
    let revisionWaiter = null;
    socket.on("activity-results-updated", (message) => {
      if (message?.payload?.activityRunId !== env.activityRunId) return;
      const revision = message?.payload?.revision;
      if (typeof revision !== "number") return;
      const receivedAt = performance.now();
      revisions.set(revision, receivedAt);
      if (revisionWaiter && revision >= revisionWaiter.revision) {
        clearTimeout(revisionWaiter.timeout);
        revisionWaiter.resolve(receivedAt);
        revisionWaiter = null;
      }
    });

    const response = await fetch(
      `${env.baseUrl}/api/v1/audience-sessions/${env.sessionId}/activities/${env.activityId}/response`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: env.baseUrl,
          "user-agent": userAgent,
        },
        body: JSON.stringify({
          clientMutationId: `artillery-${virtualUserId}`,
          answers: [{ questionId: env.questionId, type: "rating", value: 4 }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    const submittedAt = performance.now();
    events.emit("histogram", "orbit_http_submit_ms", submittedAt - startedAt);
    if (response.status !== 200)
      throw new Error(`response submit failed: ${response.status}`);
    const payload = await response.json();
    const expectedRevision = payload.runRevision;
    if (typeof expectedRevision !== "number")
      throw new Error("submit response omitted runRevision");
    let receivedAt = findRevisionAtOrAbove(revisions, expectedRevision);
    if (receivedAt === undefined) {
      receivedAt = await waitForRevision(
        expectedRevision,
        revisions,
        (waiter) => {
          revisionWaiter = waiter;
        },
        timeoutMs,
      );
    }
    if (receivedAt === undefined)
      throw new Error(`revision event ${String(expectedRevision)} timed out`);
    events.emit("histogram", "orbit_revision_event_ms", receivedAt - startedAt);
    events.emit("counter", "orbit_realtime_succeeded", 1);
  } catch (error) {
    events.emit("counter", "orbit_realtime_failed", 1);
    throw error;
  } finally {
    socket?.disconnect();
  }
}

function validateEnvironment() {
  const required = [
    "BASE_URL",
    "SESSION_ID",
    "PROJECT_ID",
    "ACTIVITY_ID",
    "ACTIVITY_RUN_ID",
    "QUESTION_ID",
  ];
  for (const key of required)
    if (!process.env[key]) throw new Error(`${key} is required.`);
  const target = new URL(process.env.BASE_URL);
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("BASE_URL must use HTTP or HTTPS.");
  if (
    target.hostname === "orbit.dhkim.cloud" &&
    process.env.CONFIRM_ORBIT_DHKIM_CLOUD !== "true"
  ) {
    throw new Error(
      "orbit.dhkim.cloud requires CONFIRM_ORBIT_DHKIM_CLOUD=true.",
    );
  }
  const profile = process.env.LOAD_PROFILE || "smoke";
  const profileConfig = getRealtimeProfile(profile);
  if (profile !== "smoke" && process.env.CONFIRM_LARGE_LOAD !== "true") {
    throw new Error(`${profile} profile requires CONFIRM_LARGE_LOAD=true.`);
  }
  if (profile !== "smoke" && !process.env.ARTILLERY_PUSHGATEWAY_URL) {
    throw new Error(`${profile} profile requires ARTILLERY_PUSHGATEWAY_URL.`);
  }
  return {
    profile,
    ...profileConfig,
    baseUrl: target.origin,
    sessionId: process.env.SESSION_ID,
    projectId: process.env.PROJECT_ID,
    activityId: process.env.ACTIVITY_ID,
    activityRunId: process.env.ACTIVITY_RUN_ID,
    questionId: process.env.QUESTION_ID,
    passcode: process.env.AUDIENCE_PASSCODE || "",
    bypassToken: process.env.LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN || "",
    startedAtMs: Number(process.env.LOAD_TEST_STARTED_AT_MS || Date.now()),
  };
}

function getRealtimeProfile(profile) {
  const config = REALTIME_PROFILES[profile];
  if (!config) throw new Error(`Unsupported LOAD_PROFILE: ${profile}`);
  return config;
}

function connect(socket) {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    socket.connect();
  });
}

async function waitForScheduledSubmission(uuid, env) {
  if (env.submissionWindowMs === 0) return;
  const offsetMs = stableHash(String(uuid)) % env.submissionWindowMs;
  const waitMs = env.startedAtMs + env.rampDurationMs + offsetMs - Date.now();
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function findRevisionAtOrAbove(revisions, expectedRevision) {
  for (const [revision, receivedAt] of revisions) {
    if (revision >= expectedRevision) return receivedAt;
  }
  return undefined;
}

function waitForRevision(revision, revisions, setWaiter, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`revision event ${revision} timed out`)),
      timeoutMs,
    );
    setWaiter({ revision, resolve, timeout });
    const receivedAt = findRevisionAtOrAbove(revisions, revision);
    if (receivedAt !== undefined) {
      clearTimeout(timeout);
      resolve(receivedAt);
    }
  });
}
