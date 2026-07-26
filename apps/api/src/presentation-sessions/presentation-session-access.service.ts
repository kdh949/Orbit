import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import { PresentationSessionRepository } from "./presentation-session.repository";

@Injectable()
export class PresentationSessionAccessService {
  constructor(private readonly repository: PresentationSessionRepository) {}

  async assertPresenterSession(
    projectId: string,
    sessionId: string,
  ): Promise<void> {
    const row = await this.repository.findByIdForRead(projectId, sessionId);
    if (!row) {
      throw new NotFoundException("Presentation session not found");
    }
  }

  async assertAudienceAccess(
    sessionId: string,
    projectId: string,
  ): Promise<void> {
    const row = await this.repository.findAccessibleBySessionId(sessionId);
    if (!row || row.project_id !== projectId || !row.deck_id) {
      throw new UnauthorizedException("Audience access required");
    }
  }
}
