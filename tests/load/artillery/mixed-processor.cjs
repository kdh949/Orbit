const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { performance } = require("node:perf_hooks");
const { io } = require("socket.io-client");

const MIXED_AUDIENCE_PROFILES = {
  smoke: {
    audienceVus: 10,
    connectRampMs: 5_000,
    responseWindowMs: 5_000,
  },
  average: {
    audienceVus: 50,
    connectRampMs: 60_000,
    responseWindowMs: 15_000,
  },
};

const ACTIVITY_TEMPLATES = ["pre-question", "poll", "satisfaction"];
const REQUEST_TIMEOUT_MS = 10_000;

module.exports = {
  assertMixedSafety,
  buildActivityAnswers,
  getMixedAudienceProfile,
  parseMixedActivities,
  requireAudiencePayloadBoundary,
  runMixedAudienceScenario,
  validateMixedAudienceEnvironment,
};

function assertMixedSafety(_context, _events, done) {
  try {
    const environment = validateMixedAudienceEnvironment(process.env);
    readActivities(environment.activityRuntimePath);
    done();
  } catch (error) {
    done(error);
  }
}

async function runMixedAudienceScenario(_context, events) {
  let socket;
  try {
    const environment = validateMixedAudienceEnvironment(process.env);
    const activities = readActivities(environment.activityRuntimePath);
    const virtualUserId = randomUUID();
    const userAgent = `orbit-mixed-artillery-${process.pid}-${virtualUserId}`;
    const identity = await joinAudience(environment, userAgent);
    socket = await connectAudience(environment, identity, userAgent);
    const revisions = observeRevisions(socket);

    for (const activity of activities) {
      await waitForOpenActivity(environment, identity, userAgent, activity);
      await waitForStableOffset(
        virtualUserId,
        activity.activityId,
        environment.responseWindowMs,
      );
      const startedAt = performance.now();
      const submitted = await submitActivityResponse(
        environment,
        identity,
        userAgent,
        activity,
        virtualUserId,
      );
      const submittedAt = performance.now();
      events.emit("histogram", "orbit_http_submit_ms", submittedAt - startedAt);
      const receivedAt = await revisions.waitFor(
        activity.activityRunId,
        submitted.runRevision,
        environment.activityOpenTimeoutMs,
      );
      events.emit(
        "histogram",
        "orbit_revision_event_ms",
        receivedAt - submittedAt,
      );
      events.emit(
        "counter",
        `orbit_activity_${activity.template.replaceAll("-", "_")}_succeeded`,
        1,
      );
    }
    events.emit("counter", "orbit_mixed_audience_succeeded", 1);
  } catch (error) {
    events.emit("counter", "orbit_mixed_audience_failed", 1);
    throw error;
  } finally {
    socket?.disconnect();
  }
}

function getMixedAudienceProfile(profile) {
  const config = MIXED_AUDIENCE_PROFILES[profile];
  if (!config) throw new Error(`Unsupported MIXED_PROFILE: ${profile}`);
  return config;
}

function validateMixedAudienceEnvironment(environment) {
  const required = [
    "ARTILLERY_PUSHGATEWAY_URL",
    "AUDIENCE_PASSCODE",
    "BASE_URL",
    "LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN",
    "MIXED_ACTIVITY_RUNTIME_PATH",
    "PROJECT_ID",
    "SESSION_ID",
  ];
  for (const key of required) {
    if (!environment[key]?.trim()) throw new Error(`${key} is required.`);
  }
  const profile = environment.MIXED_PROFILE || "smoke";
  const profileConfig = getMixedAudienceProfile(profile);
  if (profile === "average" && environment.CONFIRM_LARGE_LOAD !== "true") {
    throw new Error("average profile requires CONFIRM_LARGE_LOAD=true.");
  }
  const target = requireHttpUrl("BASE_URL", environment.BASE_URL);
  requireHttpUrl(
    "ARTILLERY_PUSHGATEWAY_URL",
    environment.ARTILLERY_PUSHGATEWAY_URL,
  );
  if (
    target.hostname === "orbit.dhkim.cloud" &&
    environment.CONFIRM_ORBIT_DHKIM_CLOUD !== "true"
  ) {
    throw new Error(
      "orbit.dhkim.cloud requires CONFIRM_ORBIT_DHKIM_CLOUD=true.",
    );
  }
  if (environment.LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN.trim().length < 32) {
    throw new Error(
      "LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN must be at least 32 characters.",
    );
  }
  return {
    ...profileConfig,
    activityOpenTimeoutMs: profile === "average" ? 300_000 : 180_000,
    activityRuntimePath: environment.MIXED_ACTIVITY_RUNTIME_PATH,
    baseUrl: target.origin,
    bypassToken: environment.LOAD_TEST_RATE_LIMIT_BYPASS_TOKEN,
    passcode: environment.AUDIENCE_PASSCODE,
    profile,
    projectId: environment.PROJECT_ID,
    sessionId: environment.SESSION_ID,
  };
}

function parseMixedActivities(input) {
  if (!input || !Array.isArray(input.activities)) {
    throw new Error("MIXED_ACTIVITY_RUNTIME_PATH must contain activities.");
  }
  if (
    input.activities.length !== ACTIVITY_TEMPLATES.length ||
    input.activities.some(
      (activity, index) => activity?.template !== ACTIVITY_TEMPLATES[index],
    )
  ) {
    throw new Error(
      "Mixed runtime must contain three ordered activities: pre-question, poll, satisfaction.",
    );
  }
  for (const activity of input.activities) {
    if (!activity.activityId || !activity.activityRunId) {
      throw new Error(
        "Each mixed activity requires activityId and activityRunId.",
      );
    }
    if (!Array.isArray(activity.questions) || activity.questions.length === 0) {
      throw new Error("Each mixed activity requires at least one question.");
    }
    buildActivityAnswers(activity, "contract-check");
  }
  return input.activities;
}

function buildActivityAnswers(activity, virtualUserId) {
  return activity.questions.map((question) => {
    const optionCount = Math.max(1, question.options?.length ?? 1);
    const selectionIndex =
      Math.floor(stableHash(virtualUserId) / 2) % optionCount;
    if (question.type === "rating") {
      return { questionId: question.questionId, type: "rating", value: 4 };
    }
    if (question.type === "single-choice") {
      requireOptions(question, 1);
      return {
        optionId: question.options[selectionIndex].optionId,
        questionId: question.questionId,
        type: "single-choice",
      };
    }
    if (question.type === "multiple-choice") {
      requireOptions(question, 1);
      const selectionCount = Math.min(
        question.maxSelections ?? question.options.length,
        question.options.length,
        2,
      );
      return {
        optionIds: question.options
          .slice(selectionIndex)
          .concat(question.options.slice(0, selectionIndex))
          .slice(0, selectionCount)
          .map((option) => option.optionId),
        questionId: question.questionId,
        type: "multiple-choice",
      };
    }
    if (question.type !== "free-text") {
      throw new Error(`Unsupported activity question type: ${question.type}`);
    }
    return {
      questionId: question.questionId,
      text:
        activity.template === "pre-question"
          ? `혼합 테스트 질문 ${virtualUserId}`
          : `혼합 테스트 의견 ${virtualUserId}`,
      type: "free-text",
    };
  });
}

function readActivities(runtimePath) {
  const payload = JSON.parse(readFileSync(runtimePath, "utf8"));
  return parseMixedActivities(payload);
}

async function joinAudience(environment, userAgent) {
  const response = await fetch(
    `${environment.baseUrl}/api/v1/audience-sessions/${encodeURIComponent(environment.sessionId)}/join`,
    {
      body: JSON.stringify({ passcode: environment.passcode }),
      headers: requestHeaders(environment, userAgent),
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (response.status !== 201) {
    throw new Error(`audience join failed: ${response.status}`);
  }
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("audience join did not return a cookie");
  return { cookie };
}

async function connectAudience(environment, identity, userAgent) {
  const socket = io(environment.baseUrl, {
    autoConnect: false,
    extraHeaders: {
      Cookie: identity.cookie,
      Origin: environment.baseUrl,
      "User-Agent": userAgent,
      "x-orbit-load-test-token": environment.bypassToken,
    },
    reconnection: false,
    timeout: REQUEST_TIMEOUT_MS,
    transports: ["websocket"],
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    socket.connect();
  });
  const acknowledgement = await socket
    .timeout(REQUEST_TIMEOUT_MS)
    .emitWithAck("presentation:audience:join", {
      projectId: environment.projectId,
      sessionId: environment.sessionId,
    });
  if (acknowledgement?.joined !== true) {
    socket.disconnect();
    throw new Error("audience room join was rejected");
  }
  return socket;
}

function observeRevisions(socket) {
  const received = new Map();
  const waiters = new Map();
  socket.on("activity-results-updated", (event) => {
    const runId = event?.payload?.activityRunId;
    const revision = event?.payload?.revision;
    if (!runId || typeof revision !== "number") return;
    const key = `${runId}:${revision}`;
    const receivedAt = performance.now();
    received.set(key, receivedAt);
    const waiter = waiters.get(key);
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    waiters.delete(key);
    waiter.resolve(receivedAt);
  });
  return {
    waitFor(runId, revision, timeoutMs) {
      const key = `${runId}:${revision}`;
      if (received.has(key)) return Promise.resolve(received.get(key));
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(key);
          reject(new Error(`revision event ${revision} timed out`));
        }, timeoutMs);
        waiters.set(key, { reject, resolve, timeout });
        if (received.has(key)) {
          clearTimeout(timeout);
          waiters.delete(key);
          resolve(received.get(key));
        }
      });
    },
  };
}

async function waitForOpenActivity(
  environment,
  identity,
  userAgent,
  expectedActivity,
) {
  const deadline = Date.now() + environment.activityOpenTimeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${environment.baseUrl}/api/v1/audience-sessions/${encodeURIComponent(environment.sessionId)}/active-activity`,
      {
        headers: requestHeaders(environment, userAgent, identity.cookie),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw new Error(`active activity read failed: ${response.status}`);
    }
    const payload = await response.json();
    requireAudiencePayloadBoundary(payload);
    const activity = payload?.activity;
    if (
      activity?.activityId === expectedActivity.activityId &&
      activity?.run?.activityRunId === expectedActivity.activityRunId &&
      activity?.run?.status === "open"
    ) {
      return;
    }
    await delay(500);
  }
  throw new Error(`activity ${expectedActivity.activityId} did not open`);
}

function requireAudiencePayloadBoundary(payload) {
  visit(payload);
  return payload;

  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (
        /^(?:speakerNotes|transcript|rawAudio|rawAudioUrl|presenterScript|script)$/i.test(
          key,
        )
      ) {
        throw new Error("Audience payload exposed presenter-only content.");
      }
      visit(item);
    }
  }
}

async function submitActivityResponse(
  environment,
  identity,
  userAgent,
  activity,
  virtualUserId,
) {
  const response = await fetch(
    `${environment.baseUrl}/api/v1/audience-sessions/${encodeURIComponent(environment.sessionId)}/activities/${encodeURIComponent(activity.activityId)}/response`,
    {
      body: JSON.stringify({
        answers: buildActivityAnswers(activity, virtualUserId),
        clientMutationId: `mixed-${virtualUserId}-${activity.activityId}`,
      }),
      headers: requestHeaders(environment, userAgent, identity.cookie),
      method: "PUT",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`activity response failed: ${response.status}`);
  }
  const payload = await response.json();
  if (typeof payload?.runRevision !== "number") {
    throw new Error("activity response omitted runRevision");
  }
  return payload;
}

function requestHeaders(environment, userAgent, cookie) {
  return {
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
    origin: environment.baseUrl,
    "user-agent": userAgent,
    "x-orbit-load-test-token": environment.bypassToken,
  };
}

function requireHttpUrl(key, value) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${key} must use HTTP or HTTPS.`);
  }
  return parsed;
}

function requireOptions(question, minimum) {
  if (!Array.isArray(question.options) || question.options.length < minimum) {
    throw new Error(`${question.type} question requires options.`);
  }
}

async function waitForStableOffset(virtualUserId, activityId, windowMs) {
  if (windowMs <= 0) return;
  const offsetMs = stableHash(`${virtualUserId}:${activityId}`) % windowMs;
  await delay(offsetMs);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
