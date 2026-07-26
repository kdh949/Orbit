import { applyDeckPatch } from "@orbit/editor-core/patches";
import {
  appendDeckPatchAckResponseSchema,
  appendDeckPatchResponseSchema,
} from "@orbit/shared/deck";
import type {
  AppendDeckPatchAckRequest,
  AppendDeckPatchAckResponse,
  AppendDeckPatchFullRequest,
  AppendDeckPatchResponse,
} from "@orbit/shared/deck";
import { HttpStatus } from "@nestjs/common";
import {
  type PptxOoxmlSyncJobInput,
  deckCheckpointPatchInterval,
  nowIso,
  parseAppendDeckPatchRequest,
  parseDeckRow,
  throwApplyPatchException,
  throwDeckApiException,
  toIso,
} from "./deck-use-cases.base";
import { DeckPersistenceUseCases } from "./deck-persistence.use-cases";

export class DeckPatchUseCases extends DeckPersistenceUseCases {
  async appendPatch(
    projectId: string,
    body: AppendDeckPatchAckRequest,
  ): Promise<AppendDeckPatchAckResponse>;
  async appendPatch(
    projectId: string,
    body: AppendDeckPatchFullRequest,
  ): Promise<AppendDeckPatchResponse>;
  async appendPatch(
    projectId: string,
    body: unknown,
  ): Promise<AppendDeckPatchResponse | AppendDeckPatchAckResponse>;
  async appendPatch(
    projectId: string,
    body: unknown,
  ): Promise<AppendDeckPatchResponse | AppendDeckPatchAckResponse> {
    const request = parseAppendDeckPatchRequest(body);
    let syncInput: PptxOoxmlSyncJobInput | null = null;

    const response = await this.dataSource.transaction(async (manager) => {
      const deckRow = await this.findDeckRowForUpdate(
        manager,
        projectId,
        request.patch.deckId,
      );

      if (!deckRow) {
        throwDeckApiException(
          "DECK_NOT_FOUND",
          HttpStatus.NOT_FOUND,
          `Deck not found for project: ${projectId}`,
        );
      }

      const checkpointVersion = deckRow.version;
      const currentDeck = (
        await this.readCurrentDeckState(
          manager,
          parseDeckRow(deckRow),
          projectId,
          request.patch.deckId,
          toIso(deckRow.updated_at),
          true,
        )
      ).deck;

      if (currentDeck.projectId !== projectId) {
        throwDeckApiException(
          "PROJECT_MISMATCH",
          HttpStatus.BAD_REQUEST,
          "Stored deck projectId must match URL projectId",
          [`projectId=${projectId}`, `deck.projectId=${currentDeck.projectId}`],
        );
      }

      const updatedAt = nowIso();
      const applyResult = applyDeckPatch(currentDeck, request.patch, {
        createdAt: updatedAt,
      });

      if (!applyResult.ok) {
        throwApplyPatchException(applyResult.error);
      }

      await this.insertPatchLog(manager, projectId, applyResult.changeRecord);
      const templateBlueprint = await this.findOoxmlTemplateBlueprint(
        manager,
        projectId,
        applyResult.deck.deckId,
        currentDeck,
      );
      const shouldCheckpoint =
        !templateBlueprint &&
        (Boolean(request.snapshotReason) ||
          applyResult.deck.version - checkpointVersion >=
            deckCheckpointPatchInterval);
      const deck =
        templateBlueprint || shouldCheckpoint
          ? await this.writeDeckCheckpoint(
              manager,
              applyResult.deck,
              updatedAt,
              templateBlueprint ?? null,
            )
          : applyResult.deck;

      if (applyResult.deck.title !== currentDeck.title) {
        await this.updateProjectTitle(
          manager,
          projectId,
          applyResult.deck.title,
        );
      }

      const snapshot = request.snapshotReason
        ? await this.createSnapshot(
            manager,
            deck,
            request.snapshotReason,
            updatedAt,
          )
        : null;
      if (templateBlueprint) {
        syncInput = {
          deckId: deck.deckId,
          changeId: applyResult.changeRecord.changeId,
          targetDeckVersion: deck.version,
        };
      }

      return {
        deck,
        changeRecord: applyResult.changeRecord,
        snapshot,
        updatedAt,
      };
    });

    const ooxmlSyncJob = syncInput
      ? await this.enqueueOoxmlSync(projectId, syncInput)
      : undefined;

    if (request.responseMode === "ack") {
      return appendDeckPatchAckResponseSchema.parse({
        deckId: response.deck.deckId,
        version: response.deck.version,
        changeRecord: response.changeRecord,
        ...(response.snapshot ? { snapshot: response.snapshot } : {}),
        ...(ooxmlSyncJob ? { ooxmlSyncJob } : {}),
        updatedAt: response.updatedAt,
      });
    }

    return appendDeckPatchResponseSchema.parse({
      ...response,
      ...(ooxmlSyncJob ? { ooxmlSyncJob } : {}),
    });
  }
}
