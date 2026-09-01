import { startNodeProfiling, startNodeTelemetry } from "@orbit/observability";

startNodeTelemetry("orbit-worker");
void startNodeProfiling("orbit-worker").catch(() => {
  process.stderr.write("Orbit Worker CPU profiling failed to start.\n");
});
