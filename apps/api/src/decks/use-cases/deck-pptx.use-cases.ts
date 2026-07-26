import { randomUUID } from "node:crypto";
import {
  getOoxmlSyncStateResponseSchema,
  getPptxImportQualityResponseSchema,
  getPptxNotesPreviewResponseSchema,
  qualityReportSchema,
  retryOoxmlSyncResponseSchema,
} from "@orbit/shared/deck";
import type {
  GetPptxImportQualityResponse,
  GetPptxNotesPreviewResponse,
} from "@orbit/shared/deck";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { assertAsyncJobAdmissionOpen } from "../../jobs/async-job-admission";
import {
  type PptxImportQualityRow,
  type PptxNotesPreviewAssetRow,
} from "./deck-use-cases.base";
import { DeckHistoryUseCases } from "./deck-history.use-cases";

export class DeckPptxUseCases extends DeckHistoryUseCases {
  async getPptxImportQuality(
    projectId: string,
  ): Promise<GetPptxImportQualityResponse> {
    const { deck } = await this.getDeck(projectId);
    const rows = await this.dataSource.query<PptxImportQualityRow[]>(
      `
        SELECT quality_report_json
        FROM template_blueprints
        WHERE project_id = $1 AND deck_id = $2
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [projectId, deck.deckId],
    );
    const qualityReport = qualityReportSchema.safeParse(
      rows[0]?.quality_report_json,
    );

    return getPptxImportQualityResponseSchema.parse({
      importQuality: qualityReport.success
        ? { qualityReport: qualityReport.data }
        : null,
    });
  }

  async getPptxNotesPreview(
    projectId: string,
    slideId: string,
  ): Promise<GetPptxNotesPreviewResponse> {
    const { deck } = await this.getDeck(projectId);
    const slide = deck.slides.find(
      (candidate) => candidate.slideId === slideId,
    );
    if (!slide) {
      throw new NotFoundException(`Deck slide not found: ${slideId}`);
    }

    const response = (
      status: GetPptxNotesPreviewResponse["notesPreview"]["status"],
      assetUrl: string | null = null,
    ) =>
      getPptxNotesPreviewResponseSchema.parse({
        notesPreview: { slideId, status, assetUrl },
      });
    const imported = await this.findOoxmlTemplateBlueprint(
      this.dataSource,
      projectId,
      deck.deckId,
      deck,
    );
    if (!imported) {
      return response(
        deck.metadata.sourceType === "import" ? "unavailable" : "absent",
      );
    }

    const blueprintSlide = imported.blueprint.slides.find(
      (candidate) => candidate.slideId === slideId,
    );
    if (!blueprintSlide) return response("unavailable");

    const syncState = await this.readOoxmlSyncState(projectId, deck);
    if (syncState.status === "pending") return response("sync-pending");
    if (syncState.status === "stale" || syncState.status === "failed") {
      return response("stale");
    }

    const notesPage = blueprintSlide.notesPage;
    if (!notesPage || notesPage.status === "absent") {
      return response("absent");
    }
    if (notesPage.status !== "rendered") {
      return response("render-unavailable");
    }

    const previewFileId = notesPage.renderAssetFileId;
    if (!previewFileId) return response("unavailable");

    let rows: PptxNotesPreviewAssetRow[];
    try {
      rows = await this.dataSource.query<PptxNotesPreviewAssetRow[]>(
        `
          SELECT file_id, project_id, purpose, status, mime_type
          FROM project_assets
          WHERE project_id = $1 AND file_id = $2
          LIMIT 1
        `,
        [projectId, previewFileId],
      );
    } catch {
      return response("unavailable");
    }
    const asset = rows[0];
    if (
      !asset ||
      asset.project_id !== projectId ||
      asset.purpose !== "design-asset" ||
      asset.status !== "uploaded" ||
      !asset.mime_type.startsWith("image/")
    ) {
      return response("unavailable");
    }

    return response(
      "available",
      `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(
        previewFileId,
      )}/content`,
    );
  }

  async getOoxmlSyncState(projectId: string) {
    const { deck } = await this.getDeck(projectId);
    const state = await this.readOoxmlSyncState(projectId, deck);
    return getOoxmlSyncStateResponseSchema.parse({ ooxmlSyncState: state });
  }

  async retryOoxmlSync(projectId: string) {
    const { deck } = await this.getDeck(projectId);
    const current = await this.readOoxmlSyncState(projectId, deck);
    if (current.status === "not-applicable" || current.status === "synced") {
      return retryOoxmlSyncResponseSchema.parse({ ooxmlSyncState: current });
    }
    if (current.status === "pending" && current.job?.status !== "failed") {
      return retryOoxmlSyncResponseSchema.parse({ ooxmlSyncState: current });
    }
    if (!current.retryable) {
      throw new ConflictException("PPTX OOXML sync job is not retryable.");
    }

    assertAsyncJobAdmissionOpen();
    const job = await this.enqueueOoxmlSync(projectId, {
      deckId: deck.deckId,
      changeId: `retry_${randomUUID()}`,
      targetDeckVersion: deck.version,
    });
    const state = await this.readOoxmlSyncState(projectId, deck, job);
    return retryOoxmlSyncResponseSchema.parse({ ooxmlSyncState: state });
  }
}
