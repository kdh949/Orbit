import {
  deckSchema,
  ooxmlReferenceTemplateGenerationJobResultSchema,
  ooxmlTemplateSnapshotSchema,
  qualityReportSchema,
  templateBlueprintSchema,
  type Deck,
  type OoxmlTemplateSnapshot,
  type QualityReport,
  type TemplateBlueprint,
} from "@orbit/shared";
import type { DataSource, EntityManager } from "typeorm";
import { z } from "zod";

const designAssetBaseSchema = z
  .object({
    fileId: z.string().min(1),
    storageKey: z.string().min(1),
    originalName: z.string().min(1),
    size: z.number().int().nonnegative(),
  })
  .strict();

const packageAssetSchema = designAssetBaseSchema.extend({
  mimeType: z.literal(
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ),
});

const renderAssetSchema = designAssetBaseSchema.extend({
  mimeType: z.literal("image/png"),
});

type DesignAsset =
  | z.infer<typeof packageAssetSchema>
  | z.infer<typeof renderAssetSchema>;

export type OoxmlReferenceMaterializationPublication = {
  projectId: string;
  generationId: string;
  deck: unknown;
  templateBlueprint: unknown;
  templateSnapshot: unknown;
  baselinePackage: unknown;
  currentPackage: unknown;
  renderAssets?: unknown[];
  jobResult?: unknown;
  qualityReport: unknown;
};

type PublicationEventSink = {
  info: (event: Record<string, unknown>) => void;
};

export async function publishOoxmlReferenceMaterialization(
  dataSource: DataSource,
  input: OoxmlReferenceMaterializationPublication,
  eventSink?: PublicationEventSink,
): Promise<void> {
  const templateSnapshot = ooxmlTemplateSnapshotSchema.parse(
    input.templateSnapshot,
  );
  const baselinePackage = packageAssetSchema.parse(input.baselinePackage);
  const currentPackage = packageAssetSchema.parse(input.currentPackage);
  const renderAssets = z.array(renderAssetSchema).max(500).parse(
    input.renderAssets ?? [],
  );
  if (baselinePackage.fileId === currentPackage.fileId) {
    throw new Error("baseline and current package file IDs must be distinct");
  }
  const deck = materializedDeck(input, templateSnapshot);
  const templateBlueprint = templateBlueprintSchema.parse({
    ...(input.templateBlueprint as Record<string, unknown>),
    sourceFileId: baselinePackage.fileId,
    sourcePackageFileId: baselinePackage.fileId,
    currentPackageFileId: currentPackage.fileId,
    referenceTemplateSnapshot: templateSnapshot,
  });
  const qualityReport = qualityReportSchema.parse(input.qualityReport);
  const jobResult = input.jobResult
    ? ooxmlReferenceTemplateGenerationJobResultSchema.parse(input.jobResult)
    : null;
  if (jobResult) {
    const expectedRenderFileIds = renderAssets.map((asset) => asset.fileId);
    if (
      jobResult.deckId !== deck.deckId ||
      jobResult.templateId !== templateBlueprint.templateId ||
      jobResult.currentPackageFileId !== currentPackage.fileId ||
      JSON.stringify(jobResult.templateSnapshot) !== JSON.stringify(templateSnapshot) ||
      JSON.stringify(jobResult.renderAssetFileIds) !==
        JSON.stringify(expectedRenderFileIds)
    ) {
      throw new Error("generation result does not match publication identity");
    }
    if (
      jobResult.fidelityReport.status !== "passed" ||
      !jobResult.fidelityReport.structuralGate.passed
    ) {
      throw new Error("generation fidelity gate must pass before publication");
    }
  }

  await dataSource.transaction(async (manager) => {
    await insertPackageAsset(manager, input.projectId, baselinePackage);
    await insertPackageAsset(manager, input.projectId, currentPackage);
    for (const renderAsset of renderAssets) {
      await insertPackageAsset(manager, input.projectId, renderAsset);
    }
    await insertDeck(manager, deck);
    await insertTemplateBlueprint(
      manager,
      input.projectId,
      deck.deckId,
      templateBlueprint,
      qualityReport,
    );
    if (jobResult) {
      await publishParentJobSuccess(
        manager,
        input.projectId,
        input.generationId,
        jobResult,
      );
    }
  });
  eventSink?.info({
    event: "ooxml_reference_materialization_published",
    projectId: input.projectId,
    generationId: input.generationId,
    deckId: deck.deckId,
    templateId: templateBlueprint.templateId,
    baselineFileId: baselinePackage.fileId,
    currentFileId: currentPackage.fileId,
  });
}

async function publishParentJobSuccess(
  manager: EntityManager,
  projectId: string,
  jobId: string,
  result: z.infer<typeof ooxmlReferenceTemplateGenerationJobResultSchema>,
): Promise<void> {
  const rows = await manager.query(
    `
      UPDATE jobs
      SET status = 'succeeded', progress = 100,
          message = 'OOXML reference template generation completed.',
          result = $3, error = NULL, updated_at = now()
      WHERE job_id = $1 AND project_id = $2
        AND type = 'ooxml-reference-template-generation'
        AND status IN ('queued', 'running')
      RETURNING job_id
    `,
    [jobId, projectId, result],
  );
  const queryRows = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
  if (!Array.isArray(queryRows) || queryRows.length !== 1) {
    throw new Error("generation parent Job is not publishable");
  }
}

function materializedDeck(
  input: OoxmlReferenceMaterializationPublication,
  snapshot: OoxmlTemplateSnapshot,
): Deck {
  const value = input.deck as Record<string, unknown>;
  const metadata = (value.metadata ?? {}) as Record<string, unknown>;
  return deckSchema.parse({
    ...value,
    projectId: input.projectId,
    metadata: {
      ...metadata,
      sourceType: "import",
      generatedBy: "ai",
      ooxmlReferenceTemplateSnapshot: {
        catalogTemplateId: snapshot.catalogTemplateId,
        catalogTemplateVersion: snapshot.catalogTemplateVersion,
        sourceSha256: snapshot.sourceSha256,
        generationId: input.generationId,
      },
    },
  });
}

async function insertPackageAsset(
  manager: EntityManager,
  projectId: string,
  asset: DesignAsset,
): Promise<void> {
  await manager.query(
    `
      INSERT INTO project_assets (
        file_id, project_id, storage_key, original_name, mime_type, size, url,
        purpose, status, created_at, uploaded_at, deleted_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'design-asset', 'uploaded', now(), now(), null)
    `,
    [
      asset.fileId,
      projectId,
      asset.storageKey,
      asset.originalName,
      asset.mimeType,
      asset.size,
      `/api/projects/${projectId}/assets/${asset.fileId}/content`,
    ],
  );
}

async function insertDeck(manager: EntityManager, deck: Deck): Promise<void> {
  await manager.query(
    `
      INSERT INTO decks (project_id, deck_id, deck_json, version, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (project_id)
      DO UPDATE SET
        deck_id = EXCLUDED.deck_id,
        deck_json = EXCLUDED.deck_json,
        version = EXCLUDED.version,
        updated_at = EXCLUDED.updated_at
    `,
    [deck.projectId, deck.deckId, deck, deck.version],
  );
}

async function insertTemplateBlueprint(
  manager: EntityManager,
  projectId: string,
  deckId: string,
  blueprint: TemplateBlueprint,
  qualityReport: QualityReport,
): Promise<void> {
  await manager.query(
    `
      INSERT INTO template_blueprints (
        template_id, project_id, deck_id, source_file_id,
        blueprint_json, quality_report_json, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, now(), now())
      ON CONFLICT (template_id)
      DO UPDATE SET
        project_id = EXCLUDED.project_id,
        deck_id = EXCLUDED.deck_id,
        source_file_id = EXCLUDED.source_file_id,
        blueprint_json = EXCLUDED.blueprint_json,
        quality_report_json = EXCLUDED.quality_report_json,
        updated_at = EXCLUDED.updated_at
    `,
    [
      blueprint.templateId,
      projectId,
      deckId,
      blueprint.sourceFileId,
      blueprint,
      qualityReport,
    ],
  );
}
