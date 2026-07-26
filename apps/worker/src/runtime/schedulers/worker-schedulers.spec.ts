import type { StoragePort } from "@orbit/storage";
import type { PinoLogger } from "nestjs-pino";
import type { DataSource } from "typeorm";
import { describe, expect, it } from "vitest";

import type { ImageAssetRuntime } from "../../image-asset-pipeline";
import { createWorkerSchedulers } from "./worker-schedulers";

describe("worker schedulers", () => {
  it("registers retention and maintenance schedulers for the all role", () => {
    expect(
      createWorkerSchedulers(context("all")).map(({ name }) => name),
    ).toEqual([
      "storage-deletion",
      "activity-retention",
      "ai-deck-maintenance",
    ]);
  });

  it("keeps dedicated roles away from monolith retention schedulers", () => {
    expect(
      createWorkerSchedulers(context("image")).map(({ name }) => name),
    ).toEqual(["ai-deck-maintenance"]);
  });
});

function context(role: "all" | "image") {
  return {
    config: {
      AI_DECK_WORKER_QUEUE: role,
    } as never,
    dataSource: {} as DataSource,
    eventLogger: () => undefined,
    imageRuntime: {} as ImageAssetRuntime,
    logger: {} as PinoLogger,
    storage: {} as StoragePort,
    workerId: "worker-test",
  };
}
