import { describe, expect, it } from "vitest";

import { databaseOptions } from "./data-source";

describe("database migration registry", () => {
  it("registers the latest migrations in order", () => {
    const migrations = databaseOptions.migrations;
    expect(Array.isArray(migrations)).toBe(true);
    const migrationNames = Array.isArray(migrations)
      ? migrations.map((migration) => (migration as { name?: string }).name)
      : [];
    const latest = migrationNames.at(-1);
    expect(migrationNames).toContain("AddSlidePracticeContentHash2026072101000");
    expect(migrationNames.indexOf("AddUserDisplayNames2026072104000")).toBeLessThan(
      migrationNames.indexOf("AddCommunityTemplateEngagement2026072105000"),
    );
    expect(
      migrationNames.indexOf("AddCommunityTemplateEngagement2026072105000"),
    ).toBeLessThan(
      migrationNames.indexOf("AddCommunityTemplateGovernance2026072106000"),
    );
    expect(
      migrationNames.indexOf("AddCommunityTemplateGovernance2026072106000"),
    ).toBeLessThan(
      migrationNames.indexOf("AddCommunityCategoriesAndTags2026072107000"),
    );
    expect(
      migrationNames.indexOf("AddCommunityCategoriesAndTags2026072107000"),
    ).toBeLessThan(
      migrationNames.indexOf(
        "AddPresentationSessionPurposeAndAudienceAccess2026072301000",
      ),
    );
    expect(latest).toBe(
      "AddPresentationSessionPurposeAndAudienceAccess2026072301000",
    );
  });
});
