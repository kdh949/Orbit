import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardUrl = new URL(
  "../observability/grafana/dashboards/orbit-overview.json",
  import.meta.url,
);

async function loadDashboard() {
  return JSON.parse(await readFile(dashboardUrl, "utf8"));
}

async function readObservabilityFile(relativePath) {
  return readFile(
    new URL(`../observability/${relativePath}`, import.meta.url),
    "utf8",
  );
}

function panelByTitle(dashboard, title) {
  const panel = dashboard.panels.find((candidate) => candidate.title === title);
  assert.ok(panel, `missing dashboard panel: ${title}`);
  return panel;
}

function panelQueries(panel) {
  return (panel.targets ?? [])
    .map((target) => target.expr ?? target.query ?? target.labelSelector ?? "")
    .join("\n");
}

test("dashboard panel ids stay unique", async () => {
  const dashboard = await loadDashboard();
  const ids = dashboard.panels.map((panel) => panel.id);

  assert.equal(new Set(ids).size, ids.length);
});

test("load-test outcome separates arrived traffic, failures, and client phases", async () => {
  const dashboard = await loadDashboard();
  const rate = panelQueries(
    panelByTitle(dashboard, "k6 actual request / iteration rate"),
  );
  const ratio = panelQueries(
    panelByTitle(dashboard, "k6 success / failure ratio"),
  );
  const failures = panelQueries(
    panelByTitle(dashboard, "k6 failures by status / error code"),
  );
  const phases = panelQueries(panelByTitle(dashboard, "k6 client phase p95"));

  assert.match(rate, /k6_http_reqs_total/);
  assert.match(rate, /k6_iterations_total/);
  assert.match(ratio, /expected_response="true"/);
  assert.match(ratio, /expected_response="false"/);
  assert.match(failures, /sum by \(testid, target_path, status, error_code\)/);
  assert.doesNotMatch(failures, /sum by \([^)]*\berror\b/);
  assert.match(phases, /k6_http_req_waiting_p95/);
  assert.match(phases, /k6_http_req_receiving_p95/);
});

test("API lifecycle distinguishes scrape outage, restart, OOM, and memory failure", async () => {
  const dashboard = await loadDashboard();

  assert.match(
    panelQueries(panelByTitle(dashboard, "API scrape availability")),
    /up\{job="orbit-api"/,
  );
  assert.match(
    panelQueries(panelByTitle(dashboard, "API unavailable duration")),
    /sum_over_time/,
  );
  assert.match(
    panelQueries(panelByTitle(dashboard, "API container restarts")),
    /container_start_time_seconds/,
  );
  assert.match(
    panelQueries(panelByTitle(dashboard, "API OOM events")),
    /container_oom_events_total/,
  );
  assert.match(
    panelQueries(panelByTitle(dashboard, "API memory allocation failures")),
    /container_memory_failcnt/,
  );
});

test("telemetry pipeline exposes accepted, refused, queued, and generated spans", async () => {
  const dashboard = await loadDashboard();
  const receiver = panelQueries(
    panelByTitle(dashboard, "Alloy trace receiver accepted / refused"),
  );
  const limiter = panelQueries(
    panelByTitle(dashboard, "Alloy memory limiter accepted / refused"),
  );
  const exporter = panelQueries(
    panelByTitle(dashboard, "Alloy trace exporter sent rate"),
  );
  const queue = panelQueries(
    panelByTitle(dashboard, "Alloy trace exporter queue utilization"),
  );
  const tempo = panelQueries(
    panelByTitle(dashboard, "Tempo trace and service-graph generation"),
  );

  assert.match(receiver, /otelcol_receiver_accepted_spans_total/);
  assert.match(receiver, /otelcol_receiver_refused_spans_total/);
  assert.match(
    limiter,
    /otelcol_processor_memory_limiter_accepted_spans_total/,
  );
  assert.match(limiter, /otelcol_processor_memory_limiter_refused_spans_total/);
  assert.match(exporter, /otelcol_exporter_sent_spans_total/);
  assert.match(queue, /otelcol_exporter_queue_size/);
  assert.match(queue, /otelcol_exporter_queue_capacity/);
  assert.match(tempo, /tempo_distributor_spans_received_total/);
  assert.match(tempo, /tempo_metrics_generator_processor_service_graphs_edges/);
});

test("resource saturation panels use finite limits and bounded container labels", async () => {
  const dashboard = await loadDashboard();
  const cpu = panelQueries(
    panelByTitle(dashboard, "Container CPU share of host capacity"),
  );
  const memory = panelQueries(
    panelByTitle(dashboard, "Container memory limit utilization"),
  );
  const failures = panelQueries(
    panelByTitle(dashboard, "Container memory pressure / failures"),
  );

  assert.match(cpu, /machine_cpu_cores/);
  assert.match(memory, /container_spec_memory_limit_bytes/);
  assert.match(memory, /> 0/);
  assert.match(failures, /container_oom_events_total/);
  assert.match(failures, /container_memory_failcnt/);
  assert.doesNotMatch(
    `${cpu}\n${memory}\n${failures}`,
    /userId|sessionId|projectId/,
  );
});

test("PostgreSQL and Redis drill-down panels expose saturation and latency", async () => {
  const dashboard = await loadDashboard();
  const connections = panelQueries(
    panelByTitle(dashboard, "PostgreSQL connection utilization"),
  );
  const activity = panelQueries(
    panelByTitle(dashboard, "PostgreSQL activity by state"),
  );
  const waits = panelQueries(
    panelByTitle(dashboard, "PostgreSQL waits by type"),
  );
  const locks = panelQueries(panelByTitle(dashboard, "PostgreSQL locks"));
  const transactions = panelQueries(
    panelByTitle(dashboard, "PostgreSQL longest transaction"),
  );
  const redisLatency = panelQueries(
    panelByTitle(dashboard, "Redis command latency p99"),
  );
  const redisFailures = panelQueries(
    panelByTitle(dashboard, "Redis slowlog / rejected connections"),
  );

  assert.match(connections, /pg_settings_max_connections/);
  assert.match(activity, /pg_stat_activity_count/);
  assert.match(activity, /state/);
  assert.match(waits, /wait_event_type/);
  assert.match(locks, /pg_locks_count/);
  assert.match(transactions, /pg_stat_activity_max_tx_duration/);
  assert.match(redisLatency, /redis_latency_percentiles_usec/);
  assert.match(redisFailures, /redis_slowlog_length/);
  assert.match(redisFailures, /redis_rejected_connections_total/);
});

test("response and database timing panels keep phase boundaries and bounded labels", async () => {
  const dashboard = await loadDashboard();
  const responseSize = panelQueries(
    panelByTitle(dashboard, "API response body size percentiles"),
  );
  const responsePhases = panelQueries(
    panelByTitle(dashboard, "API response completion phases"),
  );
  const responseLifecycle = panelQueries(
    panelByTitle(dashboard, "API in-flight / aborted responses"),
  );
  const databaseLatency = panelQueries(
    panelByTitle(dashboard, "Database client query latency"),
  );
  const databaseRate = panelQueries(
    panelByTitle(dashboard, "Database client query rate / errors"),
  );
  const nginxBoundaries = panelQueries(
    panelByTitle(dashboard, "Nginx response boundary p95"),
  );
  const nginxSize = panelQueries(
    panelByTitle(dashboard, "Nginx response body size p95"),
  );

  assert.match(responseSize, /orbit_api_http_response_body_size_bytes_bucket/);
  assert.match(responseSize, /outcome="completed"/);
  assert.match(
    responsePhases,
    /orbit_api_http_response_write_duration_seconds_bucket/,
  );
  assert.match(
    responsePhases,
    /orbit_api_http_response_post_handler_duration_seconds_bucket/,
  );
  assert.match(responseLifecycle, /orbit_api_http_in_flight_requests/);
  assert.match(responseLifecycle, /orbit_api_http_response_aborts_total/);
  assert.match(
    databaseLatency,
    /orbit_db_client_query_duration_seconds_bucket/,
  );
  assert.match(databaseLatency, /sum by \(le, job, operation\)/);
  assert.match(databaseRate, /orbit_db_client_queries_total/);
  assert.match(databaseRate, /outcome="error"/);
  assert.doesNotMatch(
    `${responseSize}\n${responsePhases}\n${databaseLatency}\n${databaseRate}`,
    /projectId|sessionId|userId|db\.query\.text|query=|table=/,
  );
  assert.match(nginxBoundaries, /upstreamHeaderTimeSeconds/);
  assert.match(nginxBoundaries, /upstreamResponseTimeSeconds/);
  assert.match(nginxBoundaries, /requestTimeSeconds/);
  assert.match(nginxSize, /responseBodyBytes/);
  assert.match(nginxBoundaries, /uri=~"\$target_path"/);
});

test("Nginx metrics and JSON logs are collected without exposing a host port", async () => {
  const dashboard = await loadDashboard();
  const compose = await readObservabilityFile("docker-compose.app.yml");
  const alloy = await readObservabilityFile("alloy/config.alloy");
  const nginx = await readObservabilityFile("nginx/orbit-observability.conf");
  const nginxExporterBlock = compose.slice(
    compose.indexOf("  nginx-exporter:"),
    compose.indexOf("  node-exporter:"),
  );
  const nginxOverview = panelQueries(
    panelByTitle(dashboard, "Nginx requests / active connections"),
  );
  const nginxErrors = panelQueries(
    panelByTitle(dashboard, "Nginx 499 / 502 / 504"),
  );
  const nginxLatency = panelQueries(
    panelByTitle(dashboard, "Nginx request / upstream p95"),
  );
  const aggregateHealth = panelQueries(
    panelByTitle(dashboard, "All metric targets healthy"),
  );
  const targetAvailability = panelQueries(
    panelByTitle(dashboard, "Target availability"),
  );

  assert.match(compose, /nginx-exporter:/);
  assert.match(compose, /unix:\/run\/orbit-nginx\/status\.sock:\/stub_status/);
  assert.doesNotMatch(nginxExporterBlock, /\n\s+ports:/);
  assert.match(alloy, /nginx-exporter:9113/);
  assert.match(alloy, /loki\.source\.file "nginx_access"/);
  assert.match(
    alloy,
    /local\.file_match "nginx_access"[\s\S]*"environment"\s*=\s*sys\.env\("OBSERVABILITY_ENVIRONMENT"\)/,
  );
  assert.match(nginx, /stub_status/);
  assert.match(nginx, /\$uri/);
  assert.match(nginx, /upstreamHeaderTimeSeconds/);
  assert.match(nginx, /\$upstream_header_time/);
  assert.match(nginx, /responseBodyBytes/);
  assert.match(nginx, /\$body_bytes_sent/);
  assert.doesNotMatch(
    nginx,
    /\$request_uri|\$http_authorization|\$http_cookie/,
  );
  assert.match(nginxOverview, /nginx_http_requests_total/);
  assert.match(nginxOverview, /nginx_connections_active/);
  assert.match(nginxErrors, /499\|502\|504/);
  assert.match(nginxErrors, /\[\$__auto\]/);
  assert.doesNotMatch(nginxErrors, /\$__rate_interval/);
  assert.match(nginxLatency, /requestTimeSeconds/);
  assert.match(nginxLatency, /upstreamResponseTimeSeconds/);
  assert.match(nginxLatency, /\[\$__auto\]/);
  assert.match(aggregateHealth, /nginx_up/);
  assert.match(aggregateHealth, /orbit-nginx-status/);
  assert.match(targetAvailability, /nginx_up/);
  assert.match(targetAvailability, /orbit-nginx-status/);
});

test("Pyroscope flame graphs use runtime-specific profile types", async () => {
  const dashboard = await loadDashboard();
  const nodeFlamegraph = panelByTitle(
    dashboard,
    "Node service wall-time flame graph",
  );
  const pythonFlamegraph = panelByTitle(
    dashboard,
    "Python worker CPU flame graph",
  );
  const profileService = dashboard.templating.list.find(
    (variable) => variable.name === "profile_service",
  );
  const apiCpu = panelByTitle(dashboard, "API process CPU usage");
  const apiCpuLinks = JSON.stringify(apiCpu.fieldConfig?.defaults?.links ?? []);

  assert.equal(nodeFlamegraph.type, "flamegraph");
  assert.deepEqual(nodeFlamegraph.datasource, {
    type: "grafana-pyroscope-datasource",
    uid: "pyroscope",
  });
  assert.match(
    panelQueries(nodeFlamegraph),
    /service_name="\$profile_service"/,
  );
  assert.match(panelQueries(nodeFlamegraph), /environment=~"\$environment"/);
  assert.equal(
    nodeFlamegraph.targets[0].profileTypeId,
    "wall:cpu:nanoseconds:wall:nanoseconds",
  );

  assert.equal(pythonFlamegraph.type, "flamegraph");
  assert.match(
    panelQueries(pythonFlamegraph),
    /service_name="orbit-python-worker"/,
  );
  assert.match(panelQueries(pythonFlamegraph), /environment=~"\$environment"/);
  assert.equal(
    pythonFlamegraph.targets[0].profileTypeId,
    "process_cpu:cpu:nanoseconds:cpu:nanoseconds",
  );
  assert.equal(profileService?.type, "custom");
  assert.deepEqual(
    profileService?.options.map((option) => option.value),
    ["orbit-api", "orbit-worker"],
  );
  assert.match(apiCpuLinks, /\$\{__url_time_range\}/);
  assert.match(apiCpuLinks, /viewPanel=79/);
  assert.match(apiCpuLinks, /var-profile_service=orbit-api/);
});

test("Tempo keeps trace-to-profile service and environment correlation", async () => {
  const datasource = await readObservabilityFile(
    "grafana/provisioning/datasources/datasources.yml",
  );

  assert.match(datasource, /tracesToProfiles:/);
  assert.match(datasource, /key: service\.name\s+value: service_name/);
  assert.match(
    datasource,
    /key: deployment\.environment\.name\s+value: environment/,
  );
});

test("Tempo service graph recognizes stable Redis database spans", async () => {
  const tempo = await readObservabilityFile("tempo/tempo.yml");
  const serviceGraphsStart = tempo.indexOf("    service_graphs:");
  const spanMetricsStart = tempo.indexOf(
    "    span_metrics:",
    serviceGraphsStart,
  );

  assert.notEqual(serviceGraphsStart, -1);
  assert.notEqual(spanMetricsStart, -1);

  const serviceGraphs = tempo.slice(serviceGraphsStart, spanMetricsStart);
  assert.match(serviceGraphs, /database_name_attributes:/);
  assert.match(serviceGraphs, /- db\.namespace/);
  assert.match(serviceGraphs, /- db\.name/);
  assert.match(serviceGraphs, /- db\.system(?:\s|$)/);
  assert.match(serviceGraphs, /- db\.system\.name/);
});
