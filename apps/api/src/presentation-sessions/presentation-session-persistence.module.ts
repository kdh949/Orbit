import { Module } from "@nestjs/common";

import { PresentationSessionAccessService } from "./presentation-session-access.service";
import { PresentationSessionRepository } from "./presentation-session.repository";

@Module({
  providers: [PresentationSessionRepository, PresentationSessionAccessService],
  exports: [PresentationSessionRepository, PresentationSessionAccessService],
})
export class PresentationSessionPersistenceModule {}
