import type { Deck } from "@orbit/shared/deck";
import type {
  PresentationRecordingMode,
  PresentationRunStatus,
  PresentationVoiceReport,
} from "@orbit/shared/presentation";
import type { RehearsalReport } from "@orbit/shared/rehearsals";
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";

import { ProjectEntity } from "../projects/project.entity";

@Entity({ name: "presentation_runs" })
export class PresentationRunEntity {
  @PrimaryColumn({ name: "run_id", type: "text" })
  runId!: string;

  @Column({ name: "project_id", type: "text" })
  projectId!: string;

  @Column({ name: "session_id", type: "text", unique: true })
  sessionId!: string;

  @Column({ name: "deck_id", type: "text" })
  deckId!: string;

  @Column({ name: "deck_version", type: "integer" })
  deckVersion!: number;

  @Column({ name: "deck_snapshot_json", type: "jsonb" })
  deckSnapshot!: Deck;

  @Column({ name: "recording_mode", type: "text" })
  recordingMode!: PresentationRecordingMode;

  @Column({ name: "audio_file_id", nullable: true, type: "text" })
  audioFileId!: string | null;

  @Column({ name: "job_id", nullable: true, type: "text" })
  jobId!: string | null;

  @Column({ type: "text" })
  status!: PresentationRunStatus;

  @Column({ nullable: true, type: "jsonb" })
  error!: { code: string; message: string } | null;

  @Column({ name: "voice_report_json", nullable: true, type: "jsonb" })
  voiceReport!: PresentationVoiceReport | null;

  @Column({ name: "detailed_report_json", nullable: true, type: "jsonb" })
  detailedReport!: RehearsalReport | null;

  @Column({ name: "raw_audio_deleted_at", nullable: true, type: "timestamptz" })
  rawAudioDeletedAt!: Date | null;

  @Column({
    name: "raw_audio_delete_deadline_at",
    nullable: true,
    type: "timestamptz",
  })
  rawAudioDeleteDeadlineAt!: Date | null;

  @Column({ name: "started_at", type: "timestamptz" })
  startedAt!: Date;

  @Column({ name: "ended_at", nullable: true, type: "timestamptz" })
  endedAt!: Date | null;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => ProjectEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "project_id", referencedColumnName: "projectId" })
  project!: ProjectEntity;
}
