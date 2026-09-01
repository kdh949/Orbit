import { startNodeProfiling, startNodeTelemetry } from "@orbit/observability";

startNodeTelemetry("orbit-api");
void startNodeProfiling("orbit-api").catch(() => {
  process.stderr.write("Orbit API CPU profiling failed to start.\n");
});
