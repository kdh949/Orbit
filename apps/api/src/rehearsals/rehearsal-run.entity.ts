import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import type {
  RehearsalEvaluationSnapshot,
  RehearsalSemanticEvaluationMode,
} from "@orbit/shared/rehearsals";
import { ProjectEntity } from "../projects/project.entity";

export type RehearsalRunStatus =
  | "created"
  | "uploading"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

@Entity({ name: "rehearsal_runs" })
export class RehearsalRunEntity {
  @PrimaryColumn({ name: "run_id", type: "text" })
  runId!: string;

  @Column({ name: "project_id", type: "text" })
  projectId!: string;

  @Column({ name: "deck_id", type: "text" })
  deckId!: string;

  @Column({ name: "audio_file_id", nullable: true, type: "text" })
  audioFileId!: string | null;

  @Column({ name: "transcript_json_file_id", nullable: true, type: "text" })
  transcriptJsonFileId!: string | null;

  @Column({ name: "transcript_text_file_id", nullable: true, type: "text" })
  transcriptTextFileId!: string | null;

  @Column({ name: "job_id", nullable: true, type: "text" })
  jobId!: string | null;

  @Column({ name: "deck_version", nullable: true, type: "integer" })
  deckVersion!: number | null;

  @Column({ name: "evaluation_snapshot_json", nullable: true, type: "jsonb" })
  evaluationSnapshot!: RehearsalEvaluationSnapshot | null;

  @Column({ name: "semantic_evaluation_mode", default: "full", type: "text" })
  semanticEvaluationMode!: RehearsalSemanticEvaluationMode;

  @Column({ name: "analysis_revision", default: 0, type: "integer" })
  analysisRevision!: number;

  @Column({ name: "analysis_finalized_at", nullable: true, type: "timestamptz" })
  analysisFinalizedAt!: Date | null;

  @Column({ type: "text" })
  status!: RehearsalRunStatus;

  @Column({ nullable: true, type: "jsonb" })
  error!: { code: string; message: string } | null;

  @Column({ name: "report_json", nullable: true, type: "jsonb" })
  rehearsalReport!: Record<string, unknown> | null;

  @Column({ default: {}, name: "meta_json", type: "jsonb" })
  metaJson!: Record<string, unknown>;

  @Column({ default: false, name: "transcript_retained", type: "boolean" })
  transcriptRetained!: boolean;

  @Column({ name: "raw_audio_deleted_at", nullable: true, type: "timestamptz" })
  rawAudioDeletedAt!: Date | null;

  @Column({
    name: "raw_audio_delete_deadline_at",
    nullable: true,
    type: "timestamptz",
  })
  rawAudioDeleteDeadlineAt!: Date | null;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => ProjectEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "project_id", referencedColumnName: "projectId" })
  project!: ProjectEntity;
}
