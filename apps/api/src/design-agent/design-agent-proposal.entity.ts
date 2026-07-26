import type {
  DeckPatchOperation,
  DesignAgentProposalStatus,
} from "@orbit/shared/deck";
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { ProjectEntity } from "../projects/project.entity";

@Entity({ name: "design_agent_proposals" })
export class DesignAgentProposalEntity {
  @PrimaryColumn({ name: "proposal_id", type: "text" })
  proposalId!: string;

  @Column({ name: "project_id", type: "text" })
  projectId!: string;

  @Column({ name: "deck_id", type: "text" })
  deckId!: string;

  @Column({ name: "slide_id", type: "text" })
  slideId!: string;

  @Column({ name: "request_message_id", type: "text" })
  requestMessageId!: string;

  @Column({ name: "response_message_id", nullable: true, type: "text" })
  responseMessageId!: string | null;

  @Column({ name: "base_version", type: "integer" })
  baseVersion!: number;

  @Column({ type: "text" })
  title!: string;

  @Column({ nullable: true, type: "text" })
  summary!: string | null;

  @Column({ type: "jsonb" })
  operations!: DeckPatchOperation[];

  @Column({ name: "interpreted_intent", nullable: true, type: "jsonb" })
  interpretedIntent!: Record<string, unknown> | null;

  @Column({ name: "affected_element_ids", type: "jsonb" })
  affectedElementIds!: string[];

  @Column({ type: "jsonb" })
  warnings!: string[];

  @Column({ type: "text" })
  status!: DesignAgentProposalStatus;

  @Column({ name: "applied_change_id", nullable: true, type: "text" })
  appliedChangeId!: string | null;

  @Column({ name: "rejected_reason", nullable: true, type: "text" })
  rejectedReason!: string | null;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => ProjectEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "project_id", referencedColumnName: "projectId" })
  project!: ProjectEntity;
}
