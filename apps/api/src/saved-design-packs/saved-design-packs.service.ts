import { randomUUID } from "node:crypto";
import {
  createSavedDesignPackRequestSchema,
  savedDesignPackListResponseSchema,
  savedDesignPackSchema,
  savedDesignPackSnapshotSchema,
  updateSavedDesignPackRequestSchema,
  type GenerateDeckRequest,
  type SavedDesignPack,
  type SavedDesignPackPreferences,
  type SavedDesignPackSnapshot,
  type UpdateSavedDesignPackRequest,
} from "@orbit/shared/deck";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { SavedDesignPackEntity } from "./saved-design-pack.entity";

type RawGenerateDeckBody = {
  design?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  referencePolicy?: unknown;
};

export type ResolvedSavedDesignPack = {
  request: GenerateDeckRequest;
  snapshot?: SavedDesignPackSnapshot;
};

@Injectable()
export class SavedDesignPacksService {
  constructor(
    @InjectRepository(SavedDesignPackEntity)
    private readonly repository: Repository<SavedDesignPackEntity>
  ) {}

  async list(userId: string) {
    const rows = await this.repository.find({
      where: [
        { ownerType: "system" },
        { ownerType: "user", ownerId: userId }
      ],
      order: { ownerType: "ASC", isDefault: "DESC", updatedAt: "DESC" }
    });
    return savedDesignPackListResponseSchema.parse({
      packs: rows.map(toDto)
    });
  }

  async get(packId: string, userId: string): Promise<SavedDesignPack> {
    return toDto(await this.requireAccessible(packId, userId));
  }

  async create(userId: string, rawInput: unknown): Promise<SavedDesignPack> {
    const input = createSavedDesignPackRequestSchema.parse(rawInput);
    await this.assertNameAvailable("user", userId, input.name);
    const now = new Date();

    if (input.isDefault) {
      await this.clearDefaults(userId);
    }

    const saved = await this.repository.save(
      this.repository.create({
        packId: `design_pack_${randomUUID()}`,
        ownerType: "user",
        ownerId: userId,
        name: input.name,
        description: input.description,
        version: 1,
        baseStylePackId: input.baseStylePackId,
        preferences: input.preferences,
        isDefault: input.isDefault,
        createdAt: now,
        updatedAt: now
      })
    );
    return toDto(saved);
  }

  async update(
    packId: string,
    userId: string,
    rawInput: unknown
  ): Promise<SavedDesignPack> {
    const input = updateSavedDesignPackRequestSchema.parse(rawInput);
    const pack = await this.requireOwned(packId, userId);
    if (input.name && input.name !== pack.name) {
      await this.assertNameAvailable("user", userId, input.name, packId);
    }
    if (input.isDefault) {
      await this.clearDefaults(userId, packId);
    }

    applyUpdate(pack, input);
    pack.version += 1;
    pack.updatedAt = new Date();
    return toDto(await this.repository.save(pack));
  }

  async duplicate(
    packId: string,
    userId: string,
    requestedName?: string
  ): Promise<SavedDesignPack> {
    const source = await this.requireAccessible(packId, userId);
    const name = requestedName?.trim() || `${source.name} Copy`;
    return this.create(userId, {
      name,
      description: source.description,
      baseStylePackId: source.baseStylePackId,
      preferences: source.preferences,
      isDefault: false
    });
  }

  async delete(packId: string, userId: string): Promise<{ id: string }> {
    const pack = await this.requireOwned(packId, userId);
    await this.repository.remove(pack);
    return { id: packId };
  }

  async setDefault(packId: string, userId: string): Promise<SavedDesignPack> {
    const pack = await this.requireOwned(packId, userId);
    await this.clearDefaults(userId, packId);
    pack.isDefault = true;
    pack.updatedAt = new Date();
    return toDto(await this.repository.save(pack));
  }

  async resolveGenerationRequest(
    request: GenerateDeckRequest,
    rawBody: unknown,
    userId: string
  ): Promise<ResolvedSavedDesignPack> {
    const selected = request.savedDesignPack
      ? await this.requireAccessible(request.savedDesignPack.id, userId)
      : await this.repository.findOne({
          where: { ownerType: "user", ownerId: userId, isDefault: true }
        });
    if (!selected) {
      return { request };
    }
    if (
      request.savedDesignPack &&
      selected.version !== request.savedDesignPack.version
    ) {
      throw new ConflictException(
        `Saved Design Pack version mismatch: requested ${request.savedDesignPack.version}, current ${selected.version}`
      );
    }

    const raw = isRecord(rawBody) ? (rawBody as RawGenerateDeckBody) : {};
    const merged = applySavedPreferences(request, selected, raw);
    return {
      request: merged,
      snapshot: savedDesignPackSnapshotSchema.parse({
        id: selected.packId,
        name: selected.name,
        version: selected.version,
        baseStylePackId: selected.baseStylePackId,
        preferences: preferencesFromResolvedRequest(merged, selected.preferences)
      })
    };
  }

  private async requireAccessible(packId: string, userId: string) {
    const pack = await this.repository.findOne({ where: { packId } });
    if (!pack) throw new NotFoundException(`Saved Design Pack not found: ${packId}`);
    if (
      pack.ownerType !== "system" &&
      !(pack.ownerType === "user" && pack.ownerId === userId)
    ) {
      throw new ForbiddenException("Saved Design Pack access denied");
    }
    return pack;
  }

  private async requireOwned(packId: string, userId: string) {
    const pack = await this.requireAccessible(packId, userId);
    if (pack.ownerType !== "user" || pack.ownerId !== userId) {
      throw new ForbiddenException("Only personal Saved Design Packs can be changed");
    }
    return pack;
  }

  private async clearDefaults(userId: string, exceptPackId?: string) {
    const packs = await this.repository.find({
      where: { ownerType: "user", ownerId: userId, isDefault: true }
    });
    const changed = packs.filter((pack) => pack.packId !== exceptPackId);
    for (const pack of changed) pack.isDefault = false;
    if (changed.length > 0) await this.repository.save(changed);
  }

  private async assertNameAvailable(
    ownerType: "user",
    ownerId: string,
    name: string,
    exceptPackId?: string
  ) {
    const packs = await this.repository.find({
      where: { ownerType: In([ownerType]), ownerId }
    });
    const duplicate = packs.some(
      (pack) =>
        pack.packId !== exceptPackId &&
        pack.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0
    );
    if (duplicate) {
      throw new ConflictException(`Saved Design Pack name already exists: ${name}`);
    }
  }
}

function applySavedPreferences(
  request: GenerateDeckRequest,
  pack: SavedDesignPackEntity,
  raw: RawGenerateDeckBody
): GenerateDeckRequest {
  const preferences = pack.preferences;
  const rawDesign = isRecord(raw.design) ? raw.design : {};
  const rawMetadata = isRecord(raw.metadata) ? raw.metadata : {};
  const design = { ...request.design };
  const metadata = { ...request.metadata };

  if (!("stylePackId" in rawDesign)) design.stylePackId = pack.baseStylePackId;
  if (!("paletteOverride" in rawDesign)) design.paletteOverride = preferences.palette;
  if (!("densityTarget" in rawDesign)) design.densityTarget = preferences.density;
  if (!("layoutDiversity" in rawDesign)) {
    design.layoutDiversity = preferences.layoutPreference === "stable" ? "stable" : "varied";
  }
  if (!("mediaPolicy" in rawDesign)) design.mediaPolicy = preferences.mediaPolicy;
  if (!("referencePolicy" in rawDesign)) design.referencePolicy = preferences.referencePolicy;
  if (!("tone" in rawMetadata)) metadata.tone = preferences.tone;

  if (
    !("fontOverride" in rawDesign) &&
    preferences.typography.headingFontFamily &&
    preferences.typography.bodyFontFamily
  ) {
    design.fontOverride = {
      fontId: savedFontId(preferences.typography.headingFontFamily),
      name: preferences.typography.headingFontFamily,
      headingFontFamily: preferences.typography.headingFontFamily,
      bodyFontFamily: preferences.typography.bodyFontFamily,
      fallbackFamily: preferences.typography.fallbackFamily ?? "Arial",
      weights: [],
      supportsKorean: true,
      pptxEmbeddable: true,
      moodTags: [],
      license: "",
      sourceUrl: "",
      recommendedTitleSize: Math.round(48 * preferences.typography.titleSizeScale),
      recommendedBodySize: Math.max(
        18,
        Math.round(22 * preferences.typography.bodySizeScale)
      ),
      lineHeight: preferences.typography.lineHeight ?? 1.24,
      widthFactor: 1,
      overflowRisk: "medium"
    };
  }

  const referencePolicy =
    raw.referencePolicy === undefined ? preferences.referencePolicy : request.referencePolicy;
  return {
    ...request,
    savedDesignPack: { id: pack.packId, version: pack.version },
    metadata,
    design,
    visualPlanPolicy: {
      mediaPolicy: design.mediaPolicy
    },
    referencePolicy,
    brief: {
      ...request.brief,
      referencePolicy:
        request.brief.referencePolicy === "topic-only" && raw.referencePolicy === undefined
          ? preferences.referencePolicy
          : request.brief.referencePolicy
    }
  };
}

function preferencesFromResolvedRequest(
  request: GenerateDeckRequest,
  fallback: SavedDesignPackPreferences
): SavedDesignPackPreferences {
  const font = request.design.fontOverride;
  return {
    ...fallback,
    palette: request.design.paletteOverride ?? fallback.palette,
    typography: font
      ? {
          headingFontFamily: font.headingFontFamily,
          bodyFontFamily: font.bodyFontFamily,
          fallbackFamily: font.fallbackFamily,
          titleSizeScale: font.recommendedTitleSize / 48,
          bodySizeScale: font.recommendedBodySize / 22,
          lineHeight: Math.max(1.2, font.lineHeight)
        }
      : fallback.typography,
    tone: request.metadata.tone,
    density: request.design.densityTarget,
    layoutPreference:
      request.design.layoutDiversity === "stable" ? "stable" : fallback.layoutPreference,
    mediaPolicy: request.design.mediaPolicy,
    referencePolicy: request.referencePolicy ?? request.brief.referencePolicy
  };
}

function applyUpdate(pack: SavedDesignPackEntity, input: UpdateSavedDesignPackRequest) {
  if (input.name !== undefined) pack.name = input.name;
  if (input.description !== undefined) pack.description = input.description;
  if (input.baseStylePackId !== undefined) pack.baseStylePackId = input.baseStylePackId;
  if (input.preferences !== undefined) pack.preferences = input.preferences;
  if (input.isDefault !== undefined) pack.isDefault = input.isDefault;
}

function toDto(entity: SavedDesignPackEntity): SavedDesignPack {
  return savedDesignPackSchema.parse({
    id: entity.packId,
    ownerType: entity.ownerType,
    ownerId: entity.ownerId,
    name: entity.name,
    description: entity.description,
    version: entity.version,
    baseStylePackId: entity.baseStylePackId,
    preferences: entity.preferences,
    isDefault: entity.isDefault,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString()
  });
}

function savedFontId(fontFamily: string) {
  return fontFamily.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "saved-font";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
