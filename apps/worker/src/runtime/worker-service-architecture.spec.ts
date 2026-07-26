import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workerServiceSource = readFileSync(
  resolve(process.cwd(), "src/worker.service.ts"),
  "utf8",
);

describe("WorkerService architecture", () => {
  it("stays a bounded lifecycle orchestrator", () => {
    expect(workerServiceSource.split("\n").length).toBeLessThanOrEqual(400);
    expect(
      workerServiceSource.match(/^import /gm)?.length ?? 0,
    ).toBeLessThanOrEqual(15);
  });

  it("delegates queue execution and scheduling to runtime modules", () => {
    expect(workerServiceSource).not.toMatch(/new BullMqWorker\(/);
    expect(workerServiceSource).not.toContain("setInterval(");
    expect(workerServiceSource).not.toMatch(/from "\.\/.*\.processor"/);
    expect(workerServiceSource).toContain("createWorkerDescriptors");
    expect(workerServiceSource).toContain("createWorkerSchedulers");
  });
});
