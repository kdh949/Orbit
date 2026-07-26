import { ForbiddenException } from "@nestjs/common";
import type {
  GenerateDeckRequest,
  SavedDesignPackPreferences,
} from "@orbit/shared/deck";
import type { Repository } from "typeorm";
import { describe, expect, it } from "vitest";
import { SavedDesignPackEntity } from "./saved-design-pack.entity";
import { SavedDesignPacksService } from "./saved-design-packs.service";

const preferences: SavedDesignPackPreferences = {
  palette: { primary: "#123456", background: "#FFFFFF" },
  typography: {
    headingFontFamily: "Pretendard",
    bodyFontFamily: "Pretendard",
    titleSizeScale: 1,
    bodySizeScale: 1,
    lineHeight: 1.24
  },
  tone: "confident",
  density: "low",
  titleStyle: "action",
  layoutPreference: "stable",
  imageDensity: "low",
  mediaPolicy: "public-assets",
  referencePolicy: "research-first",
  qaStrictness: "strict"
};

function repositoryFixture(initial: SavedDesignPackEntity[] = []) {
  const rows = [...initial];
  const repository = {
    create: (input: Partial<SavedDesignPackEntity>) => input as SavedDesignPackEntity,
    save: async (input: SavedDesignPackEntity | SavedDesignPackEntity[]) => {
      const values = Array.isArray(input) ? input : [input];
      for (const value of values) {
        const index = rows.findIndex((row) => row.packId === value.packId);
        if (index >= 0) rows[index] = value;
        else rows.push(value);
      }
      return input;
    },
    remove: async (input: SavedDesignPackEntity) => {
      const index = rows.findIndex((row) => row.packId === input.packId);
      if (index >= 0) rows.splice(index, 1);
      return input;
    },
    findOne: async ({ where }: { where: Partial<SavedDesignPackEntity> }) =>
      rows.find((row) => matches(row, where)) ?? null,
    find: async ({ where }: { where: Partial<SavedDesignPackEntity> | Partial<SavedDesignPackEntity>[] }) => {
      const clauses = Array.isArray(where) ? where : [where];
      return rows.filter((row) => clauses.some((clause) => matches(row, clause)));
    }
  } as unknown as Repository<SavedDesignPackEntity>;
  return { rows, repository };
}

function entity(overrides: Partial<SavedDesignPackEntity> = {}): SavedDesignPackEntity {
  return {
    packId: "design_pack_1",
    ownerType: "user",
    ownerId: "user_1",
    name: "Personal",
    description: "",
    version: 1,
    baseStylePackId: "brandlogy-modern",
    preferences,
    isDefault: false,
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
    updatedAt: new Date("2026-07-11T00:00:00.000Z"),
    ...overrides
  };
}

describe("SavedDesignPacksService", () => {
  it("isolates personal packs while exposing system presets", async () => {
    const fixture = repositoryFixture([
      entity(),
      entity({ packId: "design_pack_other", ownerId: "user_2" }),
      entity({ packId: "system_report", ownerType: "system", ownerId: "orbit" })
    ]);
    const service = new SavedDesignPacksService(fixture.repository);

    const listed = await service.list("user_1");
    expect(listed.packs.map((pack) => pack.id)).toEqual([
      "design_pack_1",
      "system_report"
    ]);
    await expect(service.get("design_pack_other", "user_1")).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("keeps only one personal default", async () => {
    const fixture = repositoryFixture([
      entity({ packId: "design_pack_1", isDefault: true }),
      entity({ packId: "design_pack_2", name: "Second" })
    ]);
    const service = new SavedDesignPacksService(fixture.repository);

    await service.setDefault("design_pack_2", "user_1");

    expect(fixture.rows.find((row) => row.packId === "design_pack_1")?.isDefault).toBe(false);
    expect(fixture.rows.find((row) => row.packId === "design_pack_2")?.isDefault).toBe(true);
  });

  it("applies saved preferences below explicit session overrides", async () => {
    const fixture = repositoryFixture([entity()]);
    const service = new SavedDesignPacksService(fixture.repository);
    const request = baseRequest({
      savedDesignPack: { id: "design_pack_1", version: 1 },
      design: {
        visualRhythm: "clean",
        densityTarget: "medium",
        mediaPolicy: "minimal",
        layoutDiversity: "varied",
        paletteOverride: { primary: "#ABCDEF" }
      }
    });

    const resolved = await service.resolveGenerationRequest(
      request,
      { design: { paletteOverride: { primary: "#ABCDEF" } } },
      "user_1"
    );

    expect(resolved.request.design.paletteOverride?.primary).toBe("#ABCDEF");
    expect(resolved.request.design.densityTarget).toBe("low");
    expect(resolved.request.design.layoutDiversity).toBe("stable");
    expect(resolved.request.design.mediaPolicy).toBe("public-assets");
    expect(resolved.request.design.fontOverride?.recommendedBodySize).toBeGreaterThanOrEqual(18);
    expect(resolved.snapshot?.id).toBe("design_pack_1");
    expect(resolved.snapshot?.preferences).toMatchObject({
      palette: { primary: "#ABCDEF" },
      typography: {
        headingFontFamily: "Pretendard",
        bodyFontFamily: "Pretendard"
      },
      layoutPreference: "stable"
    });
    expect(resolved.request).not.toHaveProperty("generationMode");
    expect(resolved.request).not.toHaveProperty("design.engineVersion");
  });

  it("restores the default pack without a deprecated mode selector", async () => {
    const fixture = repositoryFixture([entity({ isDefault: true })]);
    const service = new SavedDesignPacksService(fixture.repository);

    const resolved = await service.resolveGenerationRequest(
      baseRequest({}),
      {},
      "user_1"
    );

    expect(resolved.request.savedDesignPack).toEqual({
      id: "design_pack_1",
      version: 1
    });
    expect(resolved.snapshot).toMatchObject({
      id: "design_pack_1",
      version: 1,
      baseStylePackId: "brandlogy-modern"
    });
  });
});

function baseRequest(overrides: Partial<GenerateDeckRequest>): GenerateDeckRequest {
  return {
    topic: "Saved pack",
    brief: { referencePolicy: "topic-only" },
    targetDurationMinutes: 10,
    slideCountRange: { min: 5, max: 8 },
    template: "default",
    metadata: { audience: "general", purpose: "inform", tone: "professional" },
    design: {
      visualRhythm: "auto",
      densityTarget: "medium",
      mediaPolicy: "balanced",
      layoutDiversity: "stable"
    },
    referenceFileIds: [],
    references: [],
    referenceKeywords: [],
    referenceContext: [],
    coachingContext: null,
    ...overrides
  };
}

function matches(row: SavedDesignPackEntity, where: Partial<SavedDesignPackEntity>) {
  return Object.entries(where).every(([key, value]) => {
    if (typeof value === "object" && value !== null && "_value" in value) return true;
    return row[key as keyof SavedDesignPackEntity] === value;
  });
}
