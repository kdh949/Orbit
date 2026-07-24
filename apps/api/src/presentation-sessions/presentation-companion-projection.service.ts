import { loadOrbitConfig } from "@orbit/config";
import { Injectable, NotFoundException } from "@nestjs/common";

import { DecksService } from "../decks/decks.service";
import {
  FilesService,
  type OpenedAssetContent,
} from "../files/files.service";
import {
  createPresentationCompanionProjection,
  type PresentationCompanionProjection,
} from "./presentation-companion-projection";
import {
  PresentationSessionRepository,
  type PresentationSessionRow,
} from "./presentation-session.repository";

@Injectable()
export class PresentationCompanionProjectionService {
  private readonly trustedAssetOrigins: ReadonlySet<string>;

  constructor(
    private readonly sessions: PresentationSessionRepository,
    private readonly decks: DecksService,
    private readonly files: FilesService,
  ) {
    const config = loadOrbitConfig(process.env, { service: "api" });
    this.trustedAssetOrigins = new Set([
      config.WEB_ORIGIN,
      config.API_BASE_URL,
    ]);
  }

  async getDeckProjection(
    sessionId: string,
    now = new Date(),
  ): Promise<PresentationCompanionProjection> {
    const context = await this.loadCurrentSessionDeck(sessionId, now);
    return createPresentationCompanionProjection({
      deck: context.deck,
      sessionId,
      trustedAssetOrigins: this.trustedAssetOrigins,
    });
  }

  async openReferencedAsset(
    sessionId: string,
    fileId: string,
    ifNoneMatch?: string,
    now = new Date(),
  ): Promise<OpenedAssetContent> {
    const context = await this.loadCurrentSessionDeck(sessionId, now);
    const projection = createPresentationCompanionProjection({
      deck: context.deck,
      sessionId,
      trustedAssetOrigins: this.trustedAssetOrigins,
    });
    if (!projection.referencedAssetIds.has(fileId)) {
      throw companionAssetUnavailable();
    }
    try {
      return await this.files.openCompanionRenderableAssetContent(
        context.session.project_id,
        fileId,
        ifNoneMatch,
      );
    } catch {
      throw companionAssetUnavailable();
    }
  }

  private async loadCurrentSessionDeck(
    sessionId: string,
    now: Date,
  ): Promise<{
    deck: Awaited<ReturnType<DecksService["getDeck"]>>["deck"];
    session: PresentationSessionRow;
  }> {
    const session = await this.sessions.findActiveCompanionSession(
      sessionId,
      now,
    );
    if (!session?.deck_id || !session.deck_version) {
      throw companionUnavailable();
    }

    try {
      const { deck } = await this.decks.getDeck(session.project_id);
      if (
        deck.deckId !== session.deck_id ||
        deck.version !== session.deck_version
      ) {
        throw companionUnavailable();
      }
      return { deck, session };
    } catch {
      throw companionUnavailable();
    }
  }
}

function companionUnavailable() {
  return new NotFoundException("Presentation companion unavailable");
}

function companionAssetUnavailable() {
  return new NotFoundException("Presentation companion asset unavailable");
}
