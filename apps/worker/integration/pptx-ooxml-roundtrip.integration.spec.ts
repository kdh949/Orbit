import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  deckSchema,
  templateBlueprintSchema,
  type Deck,
  type DeckElement,
  type Job,
} from "@orbit/shared";
import type {
  StorageObject,
  StoragePort,
  StoragePutInput,
} from "@orbit/storage";
import { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DecksService } from "../../api/src/decks/decks.service";
import { JobsService } from "../../api/src/jobs/jobs.service";
import { processDeckExportJob } from "../src/deck-export.processor";
import { processPptxOoxmlGenerationJob } from "../src/pptx-ooxml-generation.processor";
import { processPptxOoxmlSyncJob } from "../src/pptx-ooxml-sync.processor";

const enabled = process.env.ORBIT_DB_INTEGRATION === "1";
const describeIntegration = enabled ? describe : describe.skip;
const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const databaseUrl =
  process.env.PPTX_INTEGRATION_DATABASE_URL ??
  "postgresql://orbit:orbit@127.0.0.1:5432/orbit";
const pythonWorkerUrl =
  process.env.ORBIT_PYTHON_WORKER_URL ?? process.env.PYTHON_WORKER_URL ?? "";

describeIntegration("PPTX OOXML PostgreSQL round-trip", () => {
  let dataSource: DataSource;
  const projectIds = new Set<string>();
  const fakeWorkers = new Set<Server>();

  beforeAll(async () => {
    if (!pythonWorkerUrl) {
      throw new Error(
        "ORBIT_PYTHON_WORKER_URL is required when ORBIT_DB_INTEGRATION=1.",
      );
    }
    dataSource = new DataSource({
      type: "postgres",
      url: databaseUrl,
      entities: [],
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterEach(async () => {
    await Promise.all([...fakeWorkers].map(closeServer));
    fakeWorkers.clear();
    for (const projectId of projectIds) {
      await cleanupProject(dataSource, projectId);
    }
    projectIds.clear();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("imports, saves, syncs, exports, and re-imports edited text and frame", async () => {
    const projectId = integrationId("project");
    const sourceFileId = integrationId("file");
    const sourceStorageKey = `integration/${projectId}/source.pptx`;
    const storage = new MemoryStorage();
    projectIds.add(projectId);

    await expectPythonWorkerHealthy(pythonWorkerUrl);
    const sourceDeck = createDeck(projectId, integrationId("deck"), 1);
    const sourceBytes = await exportDeckWithPython(pythonWorkerUrl, sourceDeck);
    storage.seed(sourceStorageKey, sourceBytes, pptxMimeType, "pptx-import");
    await seedProject(dataSource, projectId);
    await seedAsset(dataSource, {
      projectId,
      fileId: sourceFileId,
      storageKey: sourceStorageKey,
      purpose: "pptx-import",
      body: sourceBytes,
    });

    const harness = createServiceHarness(dataSource);
    const importJob = await harness.jobs.create({
      projectId,
      type: "pptx-ooxml-generation",
      payload: { request: { fileId: sourceFileId } },
    });
    const importedJob = await processPptxOoxmlGenerationJob(
      dataSource,
      storage,
      pythonWorkerUrl,
      {
        jobId: importJob.jobId,
        projectId,
        request: { fileId: sourceFileId },
      },
    );
    expect(importedJob.status, JSON.stringify(importedJob.error)).toBe(
      "succeeded",
    );

    const imported = (await harness.decks.getDeck(projectId)).deck;
    const initialExportPayload = await enqueueExport(harness, projectId);
    const initialExport = await processDeckExportJob(
      dataSource,
      storage,
      pythonWorkerUrl,
      initialExportPayload,
      { ooxmlReadyAttempts: 1, ooxmlReadyDelayMs: 0 },
    );
    expect(initialExport.status, JSON.stringify(initialExport.error)).toBe(
      "succeeded",
    );
    expect(await jobAssetBytes(dataSource, storage, initialExport)).toEqual(
      sourceBytes,
    );

    const sourceText = findTextElement(imported, "Initial integration text");
    const expectedFrame = {
      x: sourceText.x + 137,
      y: sourceText.y + 83,
      width: sourceText.width + 211,
      height: sourceText.height + 47,
    };
    const editedText = "Edited through PostgreSQL OOXML round-trip";
    const requested = deckSchema.parse(structuredClone(imported));
    const requestedText = findElement(requested, sourceText.elementId);
    Object.assign(requestedText, expectedFrame);
    if (requestedText.type !== "text")
      throw new Error("Expected text element.");
    requestedText.props.text = editedText;

    const saved = await harness.decks.putDeck(projectId, {
      baseVersion: imported.version,
      deck: requested,
    });
    expect(saved.deck.version).toBe(2);
    const syncPayload = await enqueueSync(harness, projectId, {
      deckId: saved.deck.deckId,
      changeId: await latestChangeId(dataSource, projectId, saved.deck.version),
      targetDeckVersion: saved.deck.version,
    });
    const syncJob = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      pythonWorkerUrl,
      syncPayload,
    );
    expect(syncJob.status, JSON.stringify(syncJob.error)).toBe("succeeded");
    expect(syncJob.result).toMatchObject({ syncedDeckVersion: 2 });

    const exportPayload = await enqueueExport(harness, projectId);
    const exportedJob = await processDeckExportJob(
      dataSource,
      storage,
      pythonWorkerUrl,
      exportPayload,
      { ooxmlReadyAttempts: 2, ooxmlReadyDelayMs: 0 },
    );
    expect(exportedJob.status, JSON.stringify(exportedJob.error)).toBe(
      "succeeded",
    );

    const exportedBytes = await jobAssetBytes(dataSource, storage, exportedJob);
    const reimported = await importPptxWithPython(
      pythonWorkerUrl,
      exportedBytes,
      projectId,
      integrationId("file"),
    );
    const reimportedText = findImportedText(reimported, editedText);
    expect(reimportedText.x).toBeCloseTo(expectedFrame.x, 0);
    expect(reimportedText.y).toBeCloseTo(expectedFrame.y, 0);
    expect(reimportedText.width).toBeCloseTo(expectedFrame.width, 0);
    expect(reimportedText.height).toBeCloseTo(expectedFrame.height, 0);
  }, 120_000);

  it("replays add, duplicate, delete, reorder, and undo before export and re-import", async () => {
    const projectId = integrationId("project");
    const sourceFileId = integrationId("file");
    const sourceStorageKey = `integration/${projectId}/source.pptx`;
    const storage = new MemoryStorage();
    projectIds.add(projectId);

    await expectPythonWorkerHealthy(pythonWorkerUrl);
    const baseDeck = createDeck(projectId, integrationId("deck"), 1);
    const sourceDeck = deckSchema.parse({
      ...baseDeck,
      slides: ["Slide 1", "Slide 2", "Slide 3"].map((text, index) => ({
        ...baseDeck.slides[0],
        slideId: `slide_source_${index + 1}`,
        order: index + 1,
        title: text,
        elements: [createTextElement(text, `el_source_${index + 1}`)],
      })),
    });
    const sourceBytes = await exportDeckWithPython(pythonWorkerUrl, sourceDeck);
    storage.seed(sourceStorageKey, sourceBytes, pptxMimeType, "pptx-import");
    await seedProject(dataSource, projectId);
    await seedAsset(dataSource, {
      projectId,
      fileId: sourceFileId,
      storageKey: sourceStorageKey,
      purpose: "pptx-import",
      body: sourceBytes,
    });

    const harness = createServiceHarness(dataSource);
    const importJob = await harness.jobs.create({
      projectId,
      type: "pptx-ooxml-generation",
      payload: { request: { fileId: sourceFileId } },
    });
    const importedJob = await processPptxOoxmlGenerationJob(
      dataSource,
      storage,
      pythonWorkerUrl,
      {
        jobId: importJob.jobId,
        projectId,
        request: { fileId: sourceFileId },
      },
    );
    expect(importedJob.status, JSON.stringify(importedJob.error)).toBe(
      "succeeded",
    );

    const imported = (await harness.decks.getDeck(projectId)).deck;
    const largeBlueprint = await loadTemplateBlueprint(
      dataSource,
      projectId,
      imported.deckId,
    );
    largeBlueprint.slides[0]!.elementSources.push(
      ...Array.from({ length: 9_000 }, (_, index) => ({
        elementId: `el_large_${index}`,
        slidePart: largeBlueprint.slides[0]!.sourceSlidePart!,
        shapeId: String(index + 10_000),
        sourceType: "slide" as const,
        writable: false,
      })),
    );
    expect(Buffer.byteLength(JSON.stringify(largeBlueprint))).toBeGreaterThan(
      1024 * 1024,
    );
    await dataSource.query(
      `UPDATE template_blueprints
       SET blueprint_json = $3
       WHERE project_id = $1 AND deck_id = $2`,
      [projectId, imported.deckId, largeBlueprint],
    );

    const desiredSlideIds = [
      imported.slides[2]!.slideId,
      imported.slides[0]!.slideId,
      imported.slides[1]!.slideId,
    ];
    const duplicateSlideId = integrationId("slide");
    const duplicateSlide = deckSchema.parse({
      ...imported,
      slides: [
        {
          ...imported.slides[1]!,
          slideId: duplicateSlideId,
          order: 3,
          title: "Duplicate",
          elements: [],
          ooxmlOrigin: "authored",
        },
      ],
    }).slides[0]!;
    const afterDuplicate = await harness.decks.appendPatch(projectId, {
      patch: {
        deckId: imported.deckId,
        baseVersion: imported.version,
        source: "user",
        operations: [
          { type: "add_slide", slide: duplicateSlide },
          {
            type: "reorder_slides",
            slideOrders: [
              imported.slides[0]!.slideId,
              imported.slides[1]!.slideId,
              duplicateSlideId,
              imported.slides[2]!.slideId,
            ].map((slideId, index) => ({ slideId, order: index + 1 })),
          },
        ],
      },
    });
    const afterDelete = await harness.decks.appendPatch(projectId, {
      patch: {
        deckId: imported.deckId,
        baseVersion: afterDuplicate.deck.version,
        source: "user",
        operations: [
          { type: "delete_slide", slideId: imported.slides[1]!.slideId },
          {
            type: "reorder_slides",
            slideOrders: [
              imported.slides[0]!.slideId,
              duplicateSlideId,
              imported.slides[2]!.slideId,
            ].map((slideId, index) => ({ slideId, order: index + 1 })),
          },
        ],
      },
    });
    const afterDeleteUndo = await harness.decks.appendPatch(projectId, {
      patch: {
        deckId: imported.deckId,
        baseVersion: afterDelete.deck.version,
        source: "user",
        operations: [
          { type: "add_slide", slide: imported.slides[1]! },
          {
            type: "reorder_slides",
            slideOrders: [...desiredSlideIds, duplicateSlideId].map(
              (slideId, index) => ({ slideId, order: index + 1 }),
            ),
          },
        ],
      },
    });
    const saved = await harness.decks.appendPatch(projectId, {
      patch: {
        deckId: imported.deckId,
        baseVersion: afterDeleteUndo.deck.version,
        source: "user",
        operations: [
          { type: "delete_slide", slideId: duplicateSlideId },
          {
            type: "reorder_slides",
            slideOrders: desiredSlideIds.map((slideId, index) => ({
              slideId,
              order: index + 1,
            })),
          },
        ],
      },
    });
    expect(saved.deck.version).toBe(imported.version + 4);
    const syncPayload = await enqueueSync(harness, projectId, {
      deckId: imported.deckId,
      changeId: saved.changeRecord.changeId,
      targetDeckVersion: saved.deck.version,
    });
    const syncJob = await processPptxOoxmlSyncJob(
      dataSource,
      storage,
      pythonWorkerUrl,
      syncPayload,
    );
    expect(syncJob.status, JSON.stringify(syncJob.error)).toBe("succeeded");

    const exportPayload = await enqueueExport(harness, projectId);
    const exportedJob = await processDeckExportJob(
      dataSource,
      storage,
      pythonWorkerUrl,
      exportPayload,
      { ooxmlReadyAttempts: 2, ooxmlReadyDelayMs: 0 },
    );
    expect(exportedJob.status, JSON.stringify(exportedJob.error)).toBe(
      "succeeded",
    );
    const exportedBytes = await jobAssetBytes(dataSource, storage, exportedJob);
    const reimported = await importPptxWithPython(
      pythonWorkerUrl,
      exportedBytes,
      projectId,
      integrationId("file"),
    );

    expect(importedSlideTextOrder(reimported)).toEqual([
      "Slide 3",
      "Slide 1",
      "Slide 2",
    ]);
    const reloaded = (await harness.decks.getDeck(projectId)).deck;
    expect(reloaded.slides.map((slide) => slide.slideId)).toEqual(
      desiredSlideIds,
    );
  }, 120_000);

  it("serializes inverted v2/v3 sync jobs and coalesces them to v3", async () => {
    const fixture = await seedFakeImportedFixture(dataSource, projectIds);
    const fake = await startFakePythonWorker();
    fakeWorkers.add(fake.server);

    await patchText(fixture.harness, fixture.deck, "version 2");
    const version2 = (await fixture.harness.decks.getDeck(fixture.projectId))
      .deck;
    await patchText(fixture.harness, version2, "version 3");
    expect(fixture.harness.syncPayloads).toHaveLength(2);

    const jobs = await Promise.all(
      [...fixture.harness.syncPayloads]
        .reverse()
        .map((payload) =>
          processPptxOoxmlSyncJob(
            dataSource,
            fixture.storage,
            fake.url,
            payload,
          ),
        ),
    );

    expect(jobs.every((job) => job.status === "succeeded")).toBe(true);
    expect(jobs.map((job) => job.result)).toEqual([
      expect.objectContaining({ syncedDeckVersion: 3 }),
      expect.objectContaining({ syncedDeckVersion: 3 }),
    ]);
    expect(fake.syncedVersions).toEqual([3]);
    const blueprint = await loadTemplateBlueprint(
      dataSource,
      fixture.projectId,
      fixture.deck.deckId,
    );
    expect(blueprint.ooxmlSyncedDeckVersion).toBe(3);
    expect(
      await currentPackageBytes(
        dataSource,
        fixture.storage,
        fixture.projectId,
        blueprint.currentPackageFileId!,
      ),
    ).toEqual(Buffer.from("fake-package-v3"));
  });

  it("re-evaluates the latest deck version while export waits for sync", async () => {
    const fixture = await seedFakeImportedFixture(dataSource, projectIds);
    const fake = await startFakePythonWorker();
    fakeWorkers.add(fake.server);

    await patchText(fixture.harness, fixture.deck, "version 2");
    const version2 = (await fixture.harness.decks.getDeck(fixture.projectId))
      .deck;
    const exportPayload = await enqueueExport(
      fixture.harness,
      fixture.projectId,
    );
    const exporting = processDeckExportJob(
      dataSource,
      fixture.storage,
      fake.url,
      exportPayload,
      { ooxmlReadyAttempts: 4, ooxmlReadyDelayMs: 300 },
    );

    await waitForJobStatus(dataSource, exportPayload.jobId, "running");
    await delay(100);
    await patchText(fixture.harness, version2, "version 3");
    const latestSyncPayload = fixture.harness.syncPayloads.at(-1);
    if (!latestSyncPayload)
      throw new Error("Latest sync job was not enqueued.");
    const syncJob = await processPptxOoxmlSyncJob(
      dataSource,
      fixture.storage,
      fake.url,
      latestSyncPayload,
    );
    expect(syncJob.status, JSON.stringify(syncJob.error)).toBe("succeeded");

    const exportedJob = await exporting;
    expect(exportedJob.status, JSON.stringify(exportedJob.error)).toBe(
      "succeeded",
    );
    expect(fake.syncedVersions).toEqual([3]);
    expect(
      await jobAssetBytes(dataSource, fixture.storage, exportedJob),
    ).toEqual(Buffer.from("fake-package-v3"));
  });

  it("fails a bounded stale export without returning the old package", async () => {
    const fixture = await seedFakeImportedFixture(dataSource, projectIds);
    await patchText(fixture.harness, fixture.deck, "unsynced version 2");
    const exportPayload = await enqueueExport(
      fixture.harness,
      fixture.projectId,
    );

    const exportedJob = await processDeckExportJob(
      dataSource,
      fixture.storage,
      pythonWorkerUrl,
      exportPayload,
      { ooxmlReadyAttempts: 2, ooxmlReadyDelayMs: 0 },
    );

    expect(exportedJob.status).toBe("failed");
    expect(exportedJob.error).toMatchObject({
      code: "DECK_EXPORT_OOXML_SYNC_STALE",
    });
    expect(exportedJob.result).toBeNull();
    expect(fixture.storage.objectsByPurpose("export-result")).toHaveLength(0);
    const rows = await dataSource.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM project_assets
       WHERE project_id = $1 AND purpose = 'export-result'`,
      [fixture.projectId],
    );
    expect(rows[0]?.count).toBe("0");
  });
});

class MemoryStorage implements Pick<
  StoragePort,
  "putObject" | "getSignedReadUrl"
> {
  private readonly objects = new Map<
    string,
    { body: Buffer; contentType: string; purpose: StoragePutInput["purpose"] }
  >();

  seed(
    key: string,
    body: Buffer,
    contentType: string,
    purpose: StoragePutInput["purpose"],
  ): void {
    this.objects.set(key, { body, contentType, purpose });
  }

  async putObject(input: StoragePutInput): Promise<StorageObject> {
    const body = Buffer.from(input.body);
    this.objects.set(input.key, {
      body,
      contentType: input.contentType,
      purpose: input.purpose,
    });
    return {
      key: input.key,
      url: `memory://${input.key}`,
      contentType: input.contentType,
      purpose: input.purpose,
      size: body.byteLength,
    };
  }

  async getSignedReadUrl(key: string): Promise<string> {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Storage object not found: ${key}`);
    return `data:${object.contentType};base64,${object.body.toString("base64")}`;
  }

  bytes(key: string): Buffer {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Storage object not found: ${key}`);
    return object.body;
  }

  objectsByPurpose(purpose: StoragePutInput["purpose"]): Buffer[] {
    return [...this.objects.values()]
      .filter((object) => object.purpose === purpose)
      .map((object) => object.body);
  }
}

function createServiceHarness(dataSource: DataSource) {
  const logger = { info: () => undefined, error: () => undefined };
  const jobs = new JobsService(
    dataSource,
    async () => undefined,
    logger as never,
  );
  const syncPayloads: Array<Record<string, unknown>> = [];
  const exportPayloads: Array<Record<string, unknown>> = [];
  const decks = new DecksService(dataSource);
  return { decks, jobs, syncPayloads, exportPayloads };
}

async function seedFakeImportedFixture(
  dataSource: DataSource,
  projectIds: Set<string>,
) {
  const projectId = integrationId("project");
  const deck = createDeck(projectId, integrationId("deck"), 1);
  const packageFileId = integrationId("file");
  const packageKey = `integration/${projectId}/current.pptx`;
  const storage = new MemoryStorage();
  storage.seed(
    packageKey,
    Buffer.from("fake-package-v1"),
    pptxMimeType,
    "design-asset",
  );
  projectIds.add(projectId);
  await seedProject(dataSource, projectId);
  await seedAsset(dataSource, {
    projectId,
    fileId: packageFileId,
    storageKey: packageKey,
    purpose: "design-asset",
    body: Buffer.from("fake-package-v1"),
  });
  await dataSource.query(
    `INSERT INTO decks (project_id, deck_id, deck_json, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, now(), now())`,
    [projectId, deck.deckId, deck, deck.version],
  );
  const blueprint = templateBlueprintSchema.parse({
    templateId: integrationId("template"),
    sourceFileId: packageFileId,
    sourcePackageFileId: packageFileId,
    currentPackageFileId: packageFileId,
    ooxmlSyncedDeckVersion: 1,
    slides: [
      {
        slideIndex: 1,
        sourceSlideIndex: 1,
        elementSources: [
          {
            elementId: deck.slides[0]!.elements[0]!.elementId,
            slidePart: "ppt/slides/slide1.xml",
            shapeId: "2",
            sourceType: "slide",
            writable: true,
          },
        ],
        slots: [],
      },
    ],
  });
  await dataSource.query(
    `INSERT INTO template_blueprints (
       template_id, project_id, deck_id, source_file_id,
       blueprint_json, quality_report_json, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now(), now())`,
    [blueprint.templateId, projectId, deck.deckId, packageFileId, blueprint],
  );
  return {
    projectId,
    deck,
    storage,
    harness: createServiceHarness(dataSource),
  };
}

async function seedProject(dataSource: DataSource, projectId: string) {
  await dataSource.query(
    `INSERT INTO projects (project_id, workspace_id, title, created_by, created_at)
     VALUES ($1, $2, 'OOXML integration', 'integration-test', now())`,
    [projectId, integrationId("workspace")],
  );
}

async function seedAsset(
  dataSource: DataSource,
  input: {
    projectId: string;
    fileId: string;
    storageKey: string;
    purpose: "pptx-import" | "design-asset";
    body: Buffer;
  },
) {
  await dataSource.query(
    `INSERT INTO project_assets (
       file_id, project_id, storage_key, original_name, mime_type, size, url,
       purpose, status, created_at, uploaded_at, deleted_at
     ) VALUES ($1, $2, $3, 'integration.pptx', $4, $5, $6, $7, 'uploaded', now(), now(), null)`,
    [
      input.fileId,
      input.projectId,
      input.storageKey,
      pptxMimeType,
      input.body.byteLength,
      `/api/v1/projects/${input.projectId}/assets/${input.fileId}/content`,
      input.purpose,
    ],
  );
}

async function patchText(
  harness: ReturnType<typeof createServiceHarness>,
  deck: Deck,
  text: string,
) {
  const element = deck.slides[0]!.elements[0]!;
  const response = await harness.decks.appendPatch(deck.projectId, {
    patch: {
      deckId: deck.deckId,
      baseVersion: deck.version,
      source: "user",
      operations: [
        {
          type: "update_element_props",
          slideId: deck.slides[0]!.slideId,
          elementId: element.elementId,
          props: { text },
        },
      ],
    },
  });
  await enqueueSync(harness, deck.projectId, {
    deckId: deck.deckId,
    changeId: response.changeRecord.changeId,
    targetDeckVersion: response.changeRecord.afterVersion,
  });
}

async function enqueueSync(
  harness: ReturnType<typeof createServiceHarness>,
  projectId: string,
  input: { deckId: string; changeId: string; targetDeckVersion: number },
) {
  const job = await harness.jobs.create({
    projectId,
    type: "pptx-ooxml-sync",
    payload: input,
  });
  const payload = { jobId: job.jobId, projectId, ...input };
  harness.syncPayloads.push(payload);
  return payload;
}

async function enqueueExport(
  harness: ReturnType<typeof createServiceHarness>,
  projectId: string,
) {
  const { deck } = await harness.decks.getDeck(projectId);
  const job = await harness.jobs.create({
    projectId,
    type: "deck-export",
    payload: { deckId: deck.deckId, format: "pptx" },
  });
  const payload = { jobId: job.jobId, projectId, deck, format: "pptx" };
  harness.exportPayloads.push(payload);
  return payload;
}

async function startFakePythonWorker() {
  const syncedVersions: number[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/ai/pptx-ooxml-sync") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    const version = Number(
      body.match(/name="synced_deck_version"\r\n\r\n(\d+)/)?.[1] ?? 0,
    );
    const operations = JSON.parse(
      body.match(
        /name="operations_file"; filename="operations.json"\r\nContent-Type: application\/json\r\n\r\n([^\r\n]+)/,
      )?.[1] ?? "[]",
    ) as Array<{
      type: string;
      slideId?: string;
      elementId?: string;
      element?: { elementId?: string };
    }>;
    syncedVersions.push(version);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        assets: [
          {
            assetId: "current_package",
            fileName: `current-v${version}.pptx`,
            mimeType: pptxMimeType,
            contentBase64: Buffer.from(`fake-package-v${version}`).toString(
              "base64",
            ),
          },
        ],
        elementSources: [],
        appliedOperations: operations.map((operation) => ({
          operationType: operation.type,
          slideId: operation.slideId,
          elementId: operation.elementId ?? operation.element?.elementId,
        })),
        unsupportedOperations: [],
        warnings: [],
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}`, syncedVersions };
}

async function expectPythonWorkerHealthy(baseUrl: string) {
  const response = await fetch(new URL("/health", baseUrl), {
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.ok).toBe(true);
}

async function exportDeckWithPython(baseUrl: string, deck: Deck) {
  const response = await fetch(new URL("/ai/export-deck-pptx", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deck, format: "pptx" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(await response.text());
  const payload = (await response.json()) as { contentBase64: string };
  return Buffer.from(payload.contentBase64, "base64");
}

async function importPptxWithPython(
  baseUrl: string,
  bytes: Buffer,
  projectId: string,
  fileId: string,
) {
  const form = new FormData();
  form.append("project_id", projectId);
  form.append("file_ids", fileId);
  form.append(
    "files",
    new Blob([bytes], { type: pptxMimeType }),
    "roundtrip.pptx",
  );
  const response = await fetch(new URL("/design/import-pptx", baseUrl), {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as {
    blueprint: {
      slides?: Array<{ elements?: Array<Record<string, unknown>> }>;
    };
  };
}

function findImportedText(
  imported: Awaited<ReturnType<typeof importPptxWithPython>>,
  text: string,
) {
  const element = imported.blueprint.slides
    ?.flatMap((slide) => slide.elements ?? [])
    .find(
      (candidate) =>
        candidate.type === "text" &&
        (candidate.props as Record<string, unknown> | undefined)?.text === text,
    );
  if (!element) throw new Error(`Re-imported text not found: ${text}`);
  return element as { x: number; y: number; width: number; height: number };
}

function importedSlideTextOrder(
  imported: Awaited<ReturnType<typeof importPptxWithPython>>,
) {
  return (imported.blueprint.slides ?? []).map((slide) => {
    const element = (slide.elements ?? []).find(
      (candidate) =>
        candidate.type === "text" &&
        String(
          (candidate.props as Record<string, unknown> | undefined)?.text,
        ).startsWith("Slide "),
    );
    if (!element) throw new Error("Re-imported slide text not found.");
    return String((element.props as Record<string, unknown>).text);
  });
}

async function loadTemplateBlueprint(
  dataSource: DataSource,
  projectId: string,
  deckId: string,
) {
  const rows = await dataSource.query<Array<{ blueprint_json: unknown }>>(
    `SELECT blueprint_json FROM template_blueprints
     WHERE project_id = $1 AND deck_id = $2`,
    [projectId, deckId],
  );
  return templateBlueprintSchema.parse(rows[0]?.blueprint_json);
}

async function latestChangeId(
  dataSource: DataSource,
  projectId: string,
  afterVersion: number,
) {
  const rows = await dataSource.query<Array<{ change_id: string }>>(
    `SELECT change_id FROM deck_patches
     WHERE project_id = $1 AND after_version = $2`,
    [projectId, afterVersion],
  );
  const changeId = rows[0]?.change_id;
  if (!changeId) throw new Error(`Deck change not found for v${afterVersion}.`);
  return changeId;
}

async function currentPackageBytes(
  dataSource: DataSource,
  storage: MemoryStorage,
  projectId: string,
  fileId: string,
) {
  const rows = await dataSource.query<Array<{ storage_key: string }>>(
    `SELECT storage_key FROM project_assets
     WHERE project_id = $1 AND file_id = $2`,
    [projectId, fileId],
  );
  const key = rows[0]?.storage_key;
  if (!key) throw new Error(`Package asset not found: ${fileId}`);
  return storage.bytes(key);
}

async function jobAssetBytes(
  dataSource: DataSource,
  storage: MemoryStorage,
  job: Job,
) {
  const fileId = (job.result as { fileId?: string } | null)?.fileId;
  if (!fileId) throw new Error("Export job has no fileId.");
  return currentPackageBytes(dataSource, storage, job.projectId, fileId);
}

async function waitForJobStatus(
  dataSource: DataSource,
  jobId: string,
  status: Job["status"],
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await dataSource.query<Array<{ status: string }>>(
      "SELECT status FROM jobs WHERE job_id = $1",
      [jobId],
    );
    if (rows[0]?.status === status) return;
    await delay(10);
  }
  throw new Error(`Job ${jobId} did not reach ${status}.`);
}

async function cleanupProject(dataSource: DataSource, projectId: string) {
  await dataSource.query("DELETE FROM jobs WHERE project_id = $1", [projectId]);
  await dataSource.query("DELETE FROM deck_snapshots WHERE project_id = $1", [
    projectId,
  ]);
  await dataSource.query("DELETE FROM deck_patches WHERE project_id = $1", [
    projectId,
  ]);
  await dataSource.query(
    "DELETE FROM template_blueprints WHERE project_id = $1",
    [projectId],
  );
  await dataSource.query("DELETE FROM decks WHERE project_id = $1", [
    projectId,
  ]);
  await dataSource.query("DELETE FROM projects WHERE project_id = $1", [
    projectId,
  ]);
}

function createDeck(projectId: string, deckId: string, version: number): Deck {
  return deckSchema.parse({
    deckId,
    projectId,
    title: "OOXML integration",
    version,
    metadata: { sourceType: "import" },
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "Integration",
        elements: [createTextElement()],
      },
    ],
  });
}

function createTextElement(
  text = "Initial integration text",
  elementId = "el_integration_text",
): DeckElement {
  return {
    elementId,
    type: "text",
    role: "body",
    x: 180,
    y: 220,
    width: 760,
    height: 180,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: false,
    visible: true,
    props: {
      text,
      fontSize: 36,
      fontWeight: "normal",
      color: "#111827",
      align: "left",
      verticalAlign: "top",
      lineHeight: 1.2,
    },
  };
}

function findTextElement(deck: Deck, text: string) {
  const element = deck.slides
    .flatMap((slide) => slide.elements)
    .find(
      (candidate) => candidate.type === "text" && candidate.props.text === text,
    );
  if (!element || element.type !== "text") {
    throw new Error(`Text element not found: ${text}`);
  }
  return element;
}

function findElement(deck: Deck, elementId: string) {
  const element = deck.slides
    .flatMap((slide) => slide.elements)
    .find((candidate) => candidate.elementId === elementId);
  if (!element) throw new Error(`Element not found: ${elementId}`);
  return element;
}

function integrationId(prefix: string) {
  return `${prefix}_integration_${randomUUID().replaceAll("-", "")}`;
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
