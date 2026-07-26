import type {
  SavedDesignPackOwnerType,
  SavedDesignPackPreferences,
} from "@orbit/shared/deck";
import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({ name: "saved_design_packs" })
@Index("idx_saved_design_packs_owner_updated", ["ownerType", "ownerId", "updatedAt"])
export class SavedDesignPackEntity {
  @PrimaryColumn({ name: "pack_id", type: "text" })
  packId!: string;

  @Column({ name: "owner_type", type: "text" })
  ownerType!: SavedDesignPackOwnerType;

  @Column({ name: "owner_id", type: "text" })
  ownerId!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", default: "" })
  description!: string;

  @Column({ type: "integer" })
  version!: number;

  @Column({ name: "base_style_pack_id", type: "text" })
  baseStylePackId!: string;

  @Column({ name: "preferences_json", type: "jsonb" })
  preferences!: SavedDesignPackPreferences;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
