import type {
  SmartArtElementTemplate,
  SmartArtLayoutType,
} from "@orbit/shared/deck";
import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({ name: "smart_art_layouts" })
@Index("idx_smart_art_layouts_type_count", ["layoutType", "itemCountMin", "itemCountMax"])
export class SmartArtLayoutEntity {
  @PrimaryColumn({ name: "layout_id", type: "text" })
  layoutId!: string;

  @Column({ name: "layout_type", type: "text" })
  layoutType!: SmartArtLayoutType;

  @Column({ type: "text" })
  name!: string;

  @Column({ name: "item_count_min", type: "integer" })
  itemCountMin!: number;

  @Column({ name: "item_count_max", type: "integer" })
  itemCountMax!: number;

  @Column({ name: "elements_json", type: "jsonb" })
  elements!: SmartArtElementTemplate[];

  @Column({ name: "source_file", nullable: true, type: "text" })
  sourceFile!: string | null;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @Column({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
