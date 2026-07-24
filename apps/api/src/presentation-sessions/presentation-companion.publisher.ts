import {
  createPresentationCompanionEvent,
  presentationCompanionRoomId,
  presentationPresenterRoomId,
} from "@orbit/realtime";
import type {
  PresentationCompanionStatus,
} from "@orbit/shared";
import { Injectable } from "@nestjs/common";
import type { Server } from "socket.io";

import { PresentationCompanionStore } from "./presentation-companion.store";

export type PresentationCompanionRevokeReason =
  | "replaced"
  | "disconnected"
  | "session-ended"
  | "expired";

@Injectable()
export class PresentationCompanionPublisher {
  private server: Server | null = null;

  constructor(private readonly store: PresentationCompanionStore) {}

  attach(server: Server): void {
    this.server = server;
  }

  async revokeCurrent(
    sessionId: string,
    reason: PresentationCompanionRevokeReason,
  ): Promise<void> {
    const generation = await this.store.getLatestGeneration(sessionId);
    if (generation !== null) {
      await this.revokeGeneration(sessionId, generation, reason);
    }
  }

  async revokeGeneration(
    sessionId: string,
    generation: number,
    reason: PresentationCompanionRevokeReason,
  ): Promise<void> {
    if (!this.server) return;
    const roomId = presentationCompanionRoomId(sessionId, generation);
    const event = createPresentationCompanionEvent({
      type: "presentation:companion:revoked",
      roomId,
      sessionId,
      userId: "system",
      payload: { reason },
    });
    this.server.to(roomId).emit(event.type, event);
    await this.server.in(roomId).disconnectSockets(true);
  }

  async publishAuthorityChanged(
    sessionId: string,
    authorityEpochId: string | null,
  ): Promise<void> {
    if (!this.server) return;
    const presenterRoom = presentationPresenterRoomId(sessionId);
    const presenterEvent = createPresentationCompanionEvent({
      type: "presentation:companion:authority-changed",
      roomId: presenterRoom,
      sessionId,
      userId: "system",
      payload: { authorityEpochId },
    });
    this.server
      .to(presenterRoom)
      .emit(presenterEvent.type, presenterEvent);

    const generation = await this.store.getLatestGeneration(sessionId);
    if (generation === null) return;
    const companionRoom = presentationCompanionRoomId(
      sessionId,
      generation,
    );
    const companionEvent = createPresentationCompanionEvent({
      type: "presentation:companion:authority-changed",
      roomId: companionRoom,
      sessionId,
      userId: "system",
      payload: { authorityEpochId },
    });
    this.server
      .to(companionRoom)
      .emit(companionEvent.type, companionEvent);
  }

  publishPresence(
    sessionId: string,
    status: PresentationCompanionStatus,
  ): void {
    if (!this.server) return;
    const roomId = presentationPresenterRoomId(sessionId);
    const event = createPresentationCompanionEvent({
      type: "presentation:companion:presence",
      roomId,
      sessionId,
      userId: "system",
      payload: status,
    });
    this.server.to(roomId).emit(event.type, event);
  }
}
