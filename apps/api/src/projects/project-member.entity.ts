import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import type {
  ProjectMemberRole,
  ProjectMemberStatus,
} from "@orbit/shared/projects";

@Entity({ name: "project_members" })
@Index("idx_project_members_user_status", ["userId", "status"])
@Index("idx_project_members_project_status", ["projectId", "status"])
export class ProjectMemberEntity {
  @PrimaryColumn({ name: "project_id", type: "text" })
  projectId!: string;

  @PrimaryColumn({ name: "user_id", type: "text" })
  userId!: string;

  @Column({ type: "text" })
  role!: ProjectMemberRole;

  @Column({ type: "text" })
  status!: ProjectMemberStatus;

  @Column({ name: "is_pinned", type: "boolean", default: false })
  isPinned!: boolean;

  @Column({ name: "pinned_at", type: "timestamptz", nullable: true })
  pinnedAt!: Date | null;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
