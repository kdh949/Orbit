import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FilesModule } from "../files/files.module";
import { JobsModule } from "../jobs/jobs.module";
import { ProjectsModule } from "../projects/projects.module";
import { SavedDesignPacksModule } from "../saved-design-packs/saved-design-packs.module";
import { PresentationBriefsModule } from "../presentation-briefs/presentation-briefs.module";
import { AiDeckPreviewController } from "./ai-deck-preview.controller";
import { AiDeckPreviewService } from "./ai-deck-preview.service";
import { DeckColorOptionsController } from "./deck-color-options.controller";
import { DeckDesignPackOptionsController } from "./deck-design-pack-options.controller";
import { GenerateDeckController } from "./generate-deck.controller";
import { GenerateDeckService } from "./generate-deck.service";
import { DesignSelectionController } from "./design-selection.controller";
import { DesignSelectionService } from "./design-selection.service";

@Module({
  imports: [
    AuthModule,
    FilesModule,
    JobsModule,
    PresentationBriefsModule,
    ProjectsModule,
    SavedDesignPacksModule
  ],
  controllers: [
    AiDeckPreviewController,
    DeckColorOptionsController,
    DeckDesignPackOptionsController,
    DesignSelectionController,
    GenerateDeckController,
  ],
  providers: [AiDeckPreviewService, DesignSelectionService, GenerateDeckService]
})
export class GenerateDeckModule {}
