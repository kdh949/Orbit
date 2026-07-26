import { removeLegacyAiGeneratedTitleAnimations } from "@orbit/editor-core/patches";
import {
  deckSnapshotDetailSchema,
  listDeckSnapshotsResponseSchema,
  restoreDeckSnapshotResponseSchema,
} from "@orbit/shared/deck";
import type {
  Deck,
  DeckSnapshot,
  DeckSnapshotDetail,
  ListDeckSnapshotsResponse,
  RestoreDeckSnapshotResponse,
} from "@orbit/shared/deck";
import { HttpStatus } from "@nestjs/common";
import {
  type DeckSnapshotRow,
  type OoxmlTemplateBlueprint,
  type PptxOoxmlSyncJobInput,
  createOoxmlReplacement,
  deduplicateRestoreSnapshotRows,
  nowIso,
  parseDeckJson,
  parseSnapshotRow,
  throwDeckApiException,
  toIso,
} from "./deck-use-cases.base";
import { DeckPatchUseCases } from "./deck-patch.use-cases";

export class DeckHistoryUseCases extends DeckPatchUseCases {
  async listSnapshots(projectId: string): Promise<ListDeckSnapshotsResponse> {
    const rows = await this.dataSource.query<DeckSnapshotRow[]>(
      `
        SELECT snapshot_id, project_id, deck_id, deck_json, version, reason, created_at
        FROM deck_snapshots
        WHERE project_id = $1
        ORDER BY created_at DESC, version DESC, snapshot_id DESC
      `,
      [projectId],
    );
    const snapshots = deduplicateRestoreSnapshotRows(rows);

    return listDeckSnapshotsResponseSchema.parse({
      projectId,
      snapshots: snapshots.map(parseSnapshotRow),
    });
  }

  async getSnapshot(
    projectId: string,
    snapshotId: string,
  ): Promise<DeckSnapshotDetail> {
    const rows = await this.dataSource.query<DeckSnapshotRow[]>(
      `
        SELECT snapshot_id, project_id, deck_id, deck_json, version, reason, created_at
        FROM deck_snapshots
        WHERE project_id = $1 AND snapshot_id = $2
        LIMIT 1
      `,
      [projectId, snapshotId],
    );
    const row = rows[0];

    if (!row) {
      throwDeckApiException(
        "SNAPSHOT_NOT_FOUND",
        HttpStatus.NOT_FOUND,
        `Snapshot not found: ${snapshotId}`,
      );
    }

    return deckSnapshotDetailSchema.parse({
      ...parseSnapshotRow(row),
      deck: removeLegacyAiGeneratedTitleAnimations(
        parseDeckJson(row.deck_json),
      ),
    });
  }

  async getOrCreateSnapshot(deck: Deck): Promise<DeckSnapshot> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT deck_id FROM decks WHERE project_id = $1 AND deck_id = $2 FOR UPDATE`,
        [deck.projectId, deck.deckId],
      );
      const rows = await manager.query<DeckSnapshotRow[]>(
        `SELECT snapshot_id, project_id, deck_id, deck_json, version, reason, created_at
         FROM deck_snapshots
         WHERE project_id = $1 AND deck_id = $2 AND version = $3
         ORDER BY created_at DESC, snapshot_id DESC LIMIT 1`,
        [deck.projectId, deck.deckId, deck.version],
      );
      return rows[0]
        ? parseSnapshotRow(rows[0])
        : this.createSnapshot(manager, deck, "auto-save", nowIso());
    });
  }

  async restoreSnapshot(
    projectId: string,
    snapshotId: string,
  ): Promise<RestoreDeckSnapshotResponse> {
    let syncInput: PptxOoxmlSyncJobInput | null = null;
    const response = await this.dataSource.transaction(async (manager) => {
      const snapshotRow = await this.findSnapshotRow(manager, snapshotId);

      if (!snapshotRow) {
        throwDeckApiException(
          "SNAPSHOT_NOT_FOUND",
          HttpStatus.NOT_FOUND,
          `Snapshot not found: ${snapshotId}`,
        );
      }

      if (snapshotRow.project_id !== projectId) {
        throwDeckApiException(
          "SNAPSHOT_PROJECT_MISMATCH",
          HttpStatus.BAD_REQUEST,
          "Snapshot does not belong to the requested project",
          [
            `projectId=${projectId}`,
            `snapshot.projectId=${snapshotRow.project_id}`,
          ],
        );
      }

      const restoredSnapshot = parseSnapshotRow(snapshotRow);
      const deck = removeLegacyAiGeneratedTitleAnimations(
        parseDeckJson(snapshotRow.deck_json),
      );
      const updatedAt = nowIso();
      let currentDeck: Deck | undefined;
      let templateBlueprint: OoxmlTemplateBlueprint | undefined;
      const currentRow = await this.findDeckRowForUpdate(
        manager,
        projectId,
        deck.deckId,
      );
      if (currentRow) {
        const currentState = await this.readCurrentDeckState(
          manager,
          parseDeckJson(currentRow.deck_json),
          projectId,
          deck.deckId,
          toIso(currentRow.updated_at),
          true,
        );
        currentDeck = currentState.deck;
        templateBlueprint = await this.findOoxmlTemplateBlueprint(
          manager,
          projectId,
          currentDeck.deckId,
          currentDeck,
        );
        const existingRestoreSnapshot =
          await this.findEquivalentRestoreSnapshot(manager, currentDeck);
        if (!existingRestoreSnapshot) {
          await this.createSnapshot(
            manager,
            currentDeck,
            "snapshot-restore",
            updatedAt,
          );
        }
      }

      if (currentDeck && templateBlueprint) {
        const replacement = createOoxmlReplacement(
          currentDeck,
          deck,
          updatedAt,
        );
        await this.insertPatchLog(manager, projectId, replacement.changeRecord);
        const restoredDeck = await this.writeDeckCheckpoint(
          manager,
          replacement.deck,
          updatedAt,
          templateBlueprint,
        );
        await this.updateProjectTitle(manager, projectId, restoredDeck.title);
        syncInput = {
          deckId: restoredDeck.deckId,
          changeId: replacement.changeRecord.changeId,
          targetDeckVersion: restoredDeck.version,
        };

        return { deck: restoredDeck, restoredSnapshot, updatedAt };
      }

      await this.deletePatchRowsAfterVersion(
        manager,
        projectId,
        deck.deckId,
        deck.version,
      );
      await this.writeDeckCheckpoint(manager, deck, updatedAt);
      await this.updateProjectTitle(manager, projectId, deck.title);

      return { deck, restoredSnapshot, updatedAt };
    });

    const ooxmlSyncJob = syncInput
      ? await this.enqueueOoxmlSync(projectId, syncInput)
      : undefined;

    return restoreDeckSnapshotResponseSchema.parse({
      ...response,
      ...(ooxmlSyncJob ? { ooxmlSyncJob } : {}),
    });
  }
}
