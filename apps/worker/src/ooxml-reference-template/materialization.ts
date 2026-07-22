import {
  deckSchema,
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

const packageAssetSchema = z
  .object({
    fileId: z.string().min(1),
    storageKey: z.string().min(1),
    originalName: z.string().min(1),
    mimeType: z.literal(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    size: z.number().int().nonnegative(),
  })
  .strict();

type PackageAsset = z.infer<typeof packageAssetSchema>;

export type OoxmlReferenceMaterializationPublication = {
  projectId: string;
  generationId: string;
  deck: unknown;
  templateBlueprint: unknown;
  templateSnapshot: unknown;
  baselinePackage: unknown;
  currentPackage: unknown;
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

  await dataSource.transaction(async (manager) => {
    await insertPackageAsset(manager, input.projectId, baselinePackage);
    await insertPackageAsset(manager, input.projectId, currentPackage);
    await insertDeck(manager, deck);
    await insertTemplateBlueprint(
      manager,
      input.projectId,
      deck.deckId,
      templateBlueprint,
      qualityReport,
    );
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
  asset: PackageAsset,
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
