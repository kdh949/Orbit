import type { SmartArtLayoutType } from "@orbit/shared/deck";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThanOrEqual, MoreThanOrEqual, Repository } from "typeorm";
import { SmartArtLayoutEntity } from "./smart-art-layout.entity";

@Injectable()
export class SmartArtLayoutsService {
  constructor(
    @InjectRepository(SmartArtLayoutEntity)
    private readonly repository: Repository<SmartArtLayoutEntity>
  ) {}

  async findByTypeAndItemCount(
    layoutType: SmartArtLayoutType,
    itemCount: number
  ): Promise<SmartArtLayoutEntity | null> {
    return this.repository.findOne({
      where: {
        layoutType,
        isActive: true,
        itemCountMin: LessThanOrEqual(itemCount),
        itemCountMax: MoreThanOrEqual(itemCount)
      },
      order: { itemCountMax: "ASC" }
    });
  }

  async listActiveCatalog(): Promise<SmartArtLayoutEntity[]> {
    return this.repository.find({
      where: { isActive: true },
      order: { itemCountMin: "ASC", layoutType: "ASC", layoutId: "ASC" }
    });
  }

  async findActiveById(layoutId: string): Promise<SmartArtLayoutEntity | null> {
    return this.repository.findOne({ where: { layoutId, isActive: true } });
  }
}
