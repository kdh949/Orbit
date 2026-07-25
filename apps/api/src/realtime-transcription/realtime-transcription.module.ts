import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProjectsModule } from "../projects/projects.module";
import { RealtimeTranscriptionController } from "./realtime-transcription.controller";
import {
  REALTIME_TRANSCRIPTION_FETCH,
  RealtimeTranscriptionService
} from "./realtime-transcription.service";

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [RealtimeTranscriptionController],
  providers: [
    RealtimeTranscriptionService,
    {
      provide: REALTIME_TRANSCRIPTION_FETCH,
      useValue: fetch
    }
  ]
})
export class RealtimeTranscriptionModule {}
