import type {
  DesignAgentContext,
  DesignAgentMessageRole,
  DesignAgentMessageStatus,
} from "@orbit/shared/deck";
import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { ProjectEntity } from "../projects/project.entity";

@Entity({ name: "design_agent_messages" })
export class DesignAgentMessageEntity {
  @PrimaryColumn({ name: "message_id", type: "text" })
  messageId!: string;

  @Column({ name: "session_id", type: "text" })
  sessionId!: string;

  @Column({ name: "project_id", type: "text" })
  projectId!: string;

  @Column({ name: "actor_user_id", type: "text" })
  actorUserId!: string;

  @Column({ name: "deck_id", type: "text" })
  deckId!: string;

  @Column({ name: "slide_id", type: "text" })
  slideId!: string;

  @Column({ type: "text" })
  role!: DesignAgentMessageRole;

  @Column({ type: "text" })
  content!: string;

  @Column({ type: "text" })
  status!: DesignAgentMessageStatus;

  @Column({ name: "context_json", nullable: true, type: "jsonb" })
  contextJson!: DesignAgentContext | null;

  @Column({ name: "error_code", nullable: true, type: "text" })
  errorCode!: string | null;

  @Column({ name: "error_message", nullable: true, type: "text" })
  errorMessage!: string | null;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => ProjectEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "project_id", referencedColumnName: "projectId" })
  project!: ProjectEntity;
}
