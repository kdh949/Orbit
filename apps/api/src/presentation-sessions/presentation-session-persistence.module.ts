import { Module } from "@nestjs/common";

import { PresentationSessionRepository } from "./presentation-session.repository";

@Module({
  providers: [PresentationSessionRepository],
  exports: [PresentationSessionRepository],
})
export class PresentationSessionPersistenceModule {}
