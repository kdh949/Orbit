import { removeLegacyAiGeneratedTitleAnimations } from "@orbit/editor-core/patches";
import {
  deckSchema,
  getDeckResponseSchema,
  putDeckResponseSchema,
} from "@orbit/shared/deck";
import type {
  Deck,
  GetDeckResponse,
  PutDeckResponse,
} from "@orbit/shared/deck";
import { HttpStatus } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import {
  DeckUseCasesBase,
  type InitialDeckWriteResult,
  type OoxmlTemplateBlueprint,
  type PptxOoxmlSyncJobInput,
  createOoxmlReplacement,
  nowIso,
  parseDeckRow,
  parsePutDeckRequest,
  throwDeckApiException,
  toIso,
} from "./deck-use-cases.base";

export class DeckPersistenceUseCases extends DeckUseCasesBase {
  async getDeck(projectId: string): Promise<GetDeckResponse> {
    const deckRow = await this.findDeckRow(this.dataSource, projectId);

    if (!deckRow) {
      throwDeckApiException(
        "DECK_NOT_FOUND",
        HttpStatus.NOT_FOUND,
        `Deck not found for project: ${projectId}`,
      );
    }

    const deck = await this.readCurrentDeckState(
      this.dataSource,
      parseDeckRow(deckRow),
      projectId,
      deckRow.deck_id,
      toIso(deckRow.updated_at),
    );

    return getDeckResponseSchema.parse({
      projectId,
      deck: deck.deck,
      updatedAt: deck.updatedAt,
    });
  }

  async getDeckForUpdate(
    manager: EntityManager,
    projectId: string,
    deckId: string,
  ): Promise<Deck> {
    const deckRow = await this.findDeckRowForUpdate(manager, projectId, deckId);

    if (!deckRow) {
      throwDeckApiException(
        "DECK_NOT_FOUND",
        HttpStatus.NOT_FOUND,
        `Deck not found for project: ${projectId}`,
      );
    }

    return (
      await this.readCurrentDeckState(
        manager,
        parseDeckRow(deckRow),
        projectId,
        deckId,
        toIso(deckRow.updated_at),
        true,
      )
    ).deck;
  }

  async createInitialDeckInTransaction(
    manager: EntityManager,
    deck: Deck,
    createdAt: string,
  ): Promise<InitialDeckWriteResult> {
    const initialDeck = deckSchema.parse(deck);
    const storedDeck = await this.writeDeckCheckpoint(
      manager,
      initialDeck,
      createdAt,
      null,
    );
    await this.updateProjectTitle(
      manager,
      storedDeck.projectId,
      storedDeck.title,
    );
    const snapshot = await this.createSnapshot(
      manager,
      storedDeck,
      "deck-replaced",
      createdAt,
    );

    return { deck: storedDeck, snapshot, updatedAt: createdAt };
  }

  async putDeck(projectId: string, body: unknown): Promise<PutDeckResponse> {
    const request = parsePutDeckRequest(body);

    if (request.deck.projectId !== projectId) {
      throwDeckApiException(
        "PROJECT_MISMATCH",
        HttpStatus.BAD_REQUEST,
        "URL projectId must match deck.projectId",
        [`projectId=${projectId}`, `deck.projectId=${request.deck.projectId}`],
      );
    }

    let syncInput: PptxOoxmlSyncJobInput | null = null;
    const response = await this.dataSource.transaction(async (manager) => {
      const updatedAt = nowIso();
      const deckRow = await this.findProjectDeckRowForUpdate(
        manager,
        projectId,
      );
      let currentDeck: Deck | undefined;
      let templateBlueprint: OoxmlTemplateBlueprint | undefined;

      if (deckRow) {
        if (deckRow.deck_id !== request.deck.deckId) {
          throwDeckApiException(
            "DECK_MISMATCH",
            HttpStatus.CONFLICT,
            "Stored deckId must match deck.deckId",
            [
              `deck.deckId=${deckRow.deck_id}`,
              `request.deckId=${request.deck.deckId}`,
            ],
          );
        }

        currentDeck = (
          await this.readCurrentDeckState(
            manager,
            parseDeckRow(deckRow),
            projectId,
            deckRow.deck_id,
            toIso(deckRow.updated_at),
            true,
          )
        ).deck;
        const baseVersion = request.baseVersion ?? request.deck.version;

        if (currentDeck.version !== baseVersion) {
          throwDeckApiException(
            "STALE_BASE_VERSION",
            HttpStatus.CONFLICT,
            "Deck baseVersion does not match current deck version",
            [
              `deck.version=${currentDeck.version}`,
              `request.baseVersion=${baseVersion}`,
            ],
          );
        }

        templateBlueprint = await this.findOoxmlTemplateBlueprint(
          manager,
          projectId,
          currentDeck.deckId,
          currentDeck,
        );
      }

      const requestedDeck = removeLegacyAiGeneratedTitleAnimations(
        request.deck,
      );
      const replacement =
        currentDeck && templateBlueprint
          ? createOoxmlReplacement(currentDeck, requestedDeck, updatedAt)
          : undefined;
      const nextDeck = replacement?.deck ?? requestedDeck;

      await this.deletePatchRowsAfterVersion(
        manager,
        projectId,
        nextDeck.deckId,
        nextDeck.version,
      );

      if (replacement) {
        await this.insertPatchLog(manager, projectId, replacement.changeRecord);
      }

      const deck = await this.writeDeckCheckpoint(
        manager,
        nextDeck,
        updatedAt,
        templateBlueprint ?? null,
      );
      await this.updateProjectTitle(manager, projectId, deck.title);
      const snapshot = await this.createSnapshot(
        manager,
        deck,
        request.snapshotReason ?? "deck-replaced",
        updatedAt,
      );

      if (replacement) {
        syncInput = {
          deckId: deck.deckId,
          changeId: replacement.changeRecord.changeId,
          targetDeckVersion: deck.version,
        };
      }

      return {
        deck,
        snapshot,
        updatedAt,
      };
    });

    const ooxmlSyncJob = syncInput
      ? await this.enqueueOoxmlSync(projectId, syncInput)
      : undefined;

    return putDeckResponseSchema.parse({
      ...response,
      ...(ooxmlSyncJob ? { ooxmlSyncJob } : {}),
    });
  }
}
