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
