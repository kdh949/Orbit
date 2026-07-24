import { loadOrbitConfig } from "@orbit/config";
import {
  presentationCompanionBootstrapSchema,
  presentationCompanionStatusSchema,
  type PresentationCompanionBootstrap,
  type PresentationCompanionStatus,
} from "@orbit/shared";
import { randomBytes } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";

import {
  companionAccessScopes,
  createCompanionAccessToken,
  verifyCompanionAccessToken,
  type CompanionAccessTokenPayload,
} from "./companion-access-cookie";
import { PresentationCompanionProjectionService } from "./presentation-companion-projection.service";
import { PresentationSessionRepository } from "./presentation-session.repository";
import {
  PresentationCompanionStore,
  type PresentationCompanionPresence,
} from "./presentation-companion.store";
import {
  PresentationCompanionPublisher,
  type PresentationCompanionRevokeReason,
} from "./presentation-companion.publisher";

const pairingTtlSeconds = 2 * 60;
const credentialTtlMs = 4 * 60 * 60 * 1_000;

@Injectable()
export class PresentationCompanionService {
  private readonly config = loadOrbitConfig(process.env, { service: "api" });

  constructor(
    private readonly store: PresentationCompanionStore,
    private readonly sessions: PresentationSessionRepository,
    private readonly projection: PresentationCompanionProjectionService,
    @InjectPinoLogger(PresentationCompanionService.name)
    private readonly logger: PinoLogger,
    private readonly publisher?: PresentationCompanionPublisher,
  ) {}

  async createPairing(
    projectId: string,
    sessionId: string,
    now = new Date(),
  ): Promise<{ code: string; expiresAt: string }> {
    const session = await this.requireActiveSession(
      sessionId,
      projectId,
      now,
    );
    await this.projection.getDeckProjection(sessionId, now);
    const code = randomBytes(32).toString("base64url");
    await this.store.putPairing(
      code,
      {
        sessionId,
        projectId: session.project_id,
        deckId: session.deck_id!,
        deckVersion: session.deck_version!,
        sessionExpiresAt: toIso(session.expires_at),
      },
      pairingTtlSeconds,
    );
    const result = {
      code,
      expiresAt: new Date(
        now.getTime() + pairingTtlSeconds * 1_000,
      ).toISOString(),
    };
    this.logger.info(
      {
        event: "presentation_companion.pairing_created",
        projectId,
        presentationSessionId: sessionId,
      },
      "presentation companion pairing created",
    );
    return result;
  }

  async exchangePairing(
    code: string,
    userAgent: string,
    now = new Date(),
  ): Promise<{
    token: string;
    credential: CompanionAccessTokenPayload;
  }> {
    const pairing = await this.store.consumePairing(code);
    if (!pairing) {
      throw companionUnavailable();
    }
    const session = await this.requireActiveSession(
      pairing.sessionId,
      pairing.projectId,
      now,
    );
    if (
      session.deck_id !== pairing.deckId ||
      session.deck_version !== pairing.deckVersion ||
      toIso(session.expires_at) !== pairing.sessionExpiresAt
    ) {
      throw companionUnavailable();
    }
    await this.projection.getDeckProjection(pairing.sessionId, now);

    const credentialExpiresAt = new Date(
      Math.min(
        new Date(pairing.sessionExpiresAt).getTime(),
        now.getTime() + credentialTtlMs,
      ),
    );
    const ttlSeconds = Math.floor(
      (credentialExpiresAt.getTime() - now.getTime()) / 1_000,
    );
    if (ttlSeconds < 1) {
      throw companionUnavailable();
    }
    const { generation: pairingGeneration, previousGeneration } =
      await this.store.issueGeneration(pairing.sessionId, ttlSeconds);
    if (previousGeneration !== null) {
      await this.publisher?.revokeGeneration(
        pairing.sessionId,
        previousGeneration,
        "replaced",
      );
      this.logger.info(
        {
          event: "presentation_companion.replaced",
          presentationSessionId: pairing.sessionId,
          previousGeneration,
          pairingGeneration,
          reasonCode: "new-pairing-exchanged",
        },
        "presentation companion replaced",
      );
    }
    const token = createCompanionAccessToken(
      this.config,
      {
        sessionId: pairing.sessionId,
        projectId: pairing.projectId,
        deckId: pairing.deckId,
        deckVersion: pairing.deckVersion,
        pairingGeneration,
        scopes: [...companionAccessScopes],
        expiresAt: credentialExpiresAt.toISOString(),
      },
      userAgent,
    );
    const credential = verifyCompanionAccessToken(
      this.config,
      token,
      userAgent,
      now,
    );
    if (!credential) {
      throw companionUnavailable();
    }
    this.logger.info(
      {
        event: "presentation_companion.pairing_exchanged",
        projectId: credential.projectId,
        presentationSessionId: credential.sessionId,
        pairingGeneration: credential.pairingGeneration,
      },
      "presentation companion pairing exchanged",
    );
    return { token, credential };
  }

  async verifyCredential(
    token: string,
    userAgent: string,
    expectedSessionId?: string,
    now = new Date(),
  ): Promise<CompanionAccessTokenPayload | null> {
    const credential = verifyCompanionAccessToken(
      this.config,
      token,
      userAgent,
      now,
    );
    if (
      !credential ||
      (expectedSessionId && credential.sessionId !== expectedSessionId)
    ) {
      return null;
    }
    const [latestGeneration, session] = await Promise.all([
      this.store.getLatestGeneration(credential.sessionId),
      this.sessions.findActiveCompanionSession(credential.sessionId, now),
    ]);
    if (
      latestGeneration !== credential.pairingGeneration ||
      !session ||
      session.project_id !== credential.projectId ||
      session.deck_id !== credential.deckId ||
      session.deck_version !== credential.deckVersion
    ) {
      return null;
    }
    return credential;
  }

  async revokeSession(
    sessionId: string,
    reason: PresentationCompanionRevokeReason = "disconnected",
  ): Promise<void> {
    await this.publisher?.revokeCurrent(sessionId, reason);
    await this.store.revokeSession(sessionId);
    this.logger.info(
      {
        event: "presentation_companion.revoked",
        presentationSessionId: sessionId,
        reasonCode: reason,
      },
      "presentation companion credential revoked",
    );
  }

  recordConnected(input: {
    companionId: string;
    pairingGeneration: number;
    sessionId: string;
  }): void {
    this.logger.info(
      {
        event: "presentation_companion.connected",
        companionId: input.companionId,
        pairingGeneration: input.pairingGeneration,
        presentationSessionId: input.sessionId,
      },
      "presentation companion connected",
    );
  }

  recordDisconnected(input: {
    pairingGeneration: number;
    sessionId: string;
  }): void {
    this.logger.info(
      {
        event: "presentation_companion.disconnected",
        pairingGeneration: input.pairingGeneration,
        presentationSessionId: input.sessionId,
        reasonCode: "socket-disconnected",
      },
      "presentation companion disconnected",
    );
  }

  recordCommandRejected(input: {
    reasonCode: "NOT_AUTHORITY" | "RATE_LIMITED" | "STALE_GENERATION";
    sessionId: string;
  }): void {
    this.logger.warn(
      {
        event: "presentation_companion.command_rejected",
        presentationSessionId: input.sessionId,
        reasonCode: input.reasonCode,
      },
      "presentation companion command rejected",
    );
  }

  recordWebRtcFailed(input: {
    pairingGeneration: number;
    sessionId: string;
  }): void {
    this.logger.warn(
      {
        event: "presentation_companion.webrtc_failed",
        elapsedBucket: "unknown",
        pairingGeneration: input.pairingGeneration,
        presentationSessionId: input.sessionId,
        webrtcState: "failed",
      },
      "presentation companion WebRTC failed",
    );
  }

  async disconnect(
    projectId: string,
    sessionId: string,
    now = new Date(),
  ): Promise<void> {
    await this.requireActiveSession(sessionId, projectId, now);
    await this.revokeSession(sessionId, "disconnected");
  }

  async getStatus(
    projectId: string,
    sessionId: string,
    now = new Date(),
  ): Promise<PresentationCompanionStatus> {
    await this.requireActiveSession(sessionId, projectId, now);
    const [generation, presence] = await Promise.all([
      this.store.getLatestGeneration(sessionId),
      this.store.getPresence(sessionId),
    ]);
    const connected =
      generation !== null &&
      presence !== null &&
      presence.generation === generation;
    return presentationCompanionStatusSchema.parse({
      connected,
      pairingGeneration: generation,
      connectedAt: connected ? presence.connectedAt : null,
      rttBucket: connected ? presence.rttBucket : null,
    });
  }

  async getBootstrap(
    token: string,
    userAgent: string,
    sessionId: string,
    now = new Date(),
  ): Promise<PresentationCompanionBootstrap> {
    const credential = await this.verifyCredential(
      token,
      userAgent,
      sessionId,
      now,
    );
    if (!credential) {
      throw companionUnavailable();
    }
    const session = await this.requireActiveSession(
      sessionId,
      credential.projectId,
      now,
    );
    if (
      session.deck_id !== credential.deckId ||
      session.deck_version !== credential.deckVersion
    ) {
      throw companionUnavailable();
    }
    const projection = await this.projection.getDeckProjection(
      sessionId,
      now,
    );
    return presentationCompanionBootstrapSchema.parse({
      sessionId,
      sessionPurpose: session.session_purpose,
      expiresAt: credential.expiresAt,
      scopes: credential.scopes,
      deck: projection.deck,
    });
  }

  claimAuthority(
    sessionId: string,
    authorityEpochId: string,
  ): Promise<boolean> {
    return this.store.claimAuthority(sessionId, authorityEpochId);
  }

  heartbeatAuthority(
    sessionId: string,
    authorityEpochId: string,
  ): Promise<boolean> {
    return this.store.heartbeatAuthority(sessionId, authorityEpochId);
  }

  renewPresence(
    sessionId: string,
    presence: PresentationCompanionPresence,
  ): Promise<void> {
    return this.store.renewPresence(sessionId, presence);
  }

  clearPresence(
    sessionId: string,
    expectedGeneration: number,
  ): Promise<boolean> {
    return this.store.clearPresence(sessionId, expectedGeneration);
  }

  async getLatestGeneration(sessionId: string): Promise<number | null> {
    return this.store.getLatestGeneration(sessionId);
  }

  async getAuthority(sessionId: string): Promise<string | null> {
    return this.store.getAuthority(sessionId);
  }

  private async requireActiveSession(
    sessionId: string,
    expectedProjectId: string,
    now: Date,
  ) {
    const session = await this.sessions.findActiveCompanionSession(
      sessionId,
      now,
    );
    if (
      !session ||
      session.project_id !== expectedProjectId ||
      !session.deck_id ||
      !session.deck_version
    ) {
      throw companionUnavailable();
    }
    return session;
  }
}

function companionUnavailable() {
  return new NotFoundException("Presentation companion unavailable");
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
