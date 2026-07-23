import { describe, expect, it } from "vitest";

import { databaseOptions } from "./data-source";

describe("databaseOptions", () => {
  it("keeps TypeORM query logging disabled to protect user content", () => {
    expect(databaseOptions.logging).toBe(false);
  });

  it("registers the AI deck stage checkpoint migration", () => {
    const migrations = Array.isArray(databaseOptions.migrations)
      ? databaseOptions.migrations
      : [];
    expect(
      migrations.some(
        (migration) =>
          typeof migration === "function" &&
          migration.name === "CreateAiDeckGenerationStages2026071502000",
      ),
    ).toBe(true);
    expect(
      migrations.some(
        (migration) =>
          typeof migration === "function" &&
          migration.name ===
            "CreateAiDeckReferenceExtractionArtifacts2026071503000",
      ),
    ).toBe(true);
    expect(
      migrations.some(
        (migration) =>
          typeof migration === "function" &&
          migration.name === "CreateAiDeckPlanningArtifacts2026071601000",
      ),
    ).toBe(true);
    expect(
      migrations.some(
        (migration) =>
          typeof migration === "function" &&
          migration.name === "ExpandAiDeckStageDispatchRecovery2026071601100",
      ),
    ).toBe(true);
  });

  it("registers the rehearsal audio retention migration", () => {
    const migrations = Array.isArray(databaseOptions.migrations)
      ? databaseOptions.migrations
      : [];

    expect(
      migrations.some(
        (migration) =>
          typeof migration === "function" &&
          migration.name === "AddRehearsalAudioRetention2026071603000",
      ),
    ).toBe(true);
  });

  it("registers the rehearsal transcript artifact migration", () => {
    const migrations = Array.isArray(databaseOptions.migrations)
      ? databaseOptions.migrations
      : [];

    expect(
      migrations.some(
        (migration) =>
          typeof migration === "function" &&
          migration.name === "AddRehearsalTranscriptArtifacts2026071603000",
      ),
    ).toBe(true);
  });

  it("registers the presentation session activity expansion", () => {
    const migrations = Array.isArray(databaseOptions.migrations)
      ? databaseOptions.migrations
      : [];
    const names = migrations.map((migration) =>
      typeof migration === "function" ? migration.name : "",
    );

    expect(names).toContain("ExpandPresentationSessionsForActivities2026071701000");
    expect(names).toContain(
      "AddPresentationPasscodeDisplayCiphertext2026072401000"
    );
  });

  it("registers the activity runtime migration after the session expansion", () => {
    const migrations = Array.isArray(databaseOptions.migrations)
      ? databaseOptions.migrations
      : [];
    const names = migrations.map((migration) =>
      typeof migration === "function" ? migration.name : "",
    );

    expect(names.indexOf("CreateActivityRuntime2026071702000")).toBeGreaterThan(
      names.indexOf("ExpandPresentationSessionsForActivities2026071701000"),
    );
    expect(
      names.indexOf("CreatePresentationSessionAudienceRegistry2026071703000")
    ).toBeGreaterThan(names.indexOf("CreateActivityRuntime2026071702000"));
    expect(names.indexOf("RepairActivityRetentionPrivacy2026071704000")).toBeGreaterThan(
      names.indexOf("CreatePresentationSessionAudienceRegistry2026071703000"),
    );
  });

  it("registers the SmartArt typography migration after its layout migrations", () => {
    const migrations = Array.isArray(databaseOptions.migrations)
      ? databaseOptions.migrations
      : [];
    const names = migrations.map((migration) =>
      typeof migration === "function" ? migration.name : "",
    );

    expect(names.indexOf("AddSmartArtTemplateLayouts2026071702000")).toBeGreaterThan(
      names.indexOf("CreateSmartArtLayouts2026071701000"),
    );
    expect(names.indexOf("IncreaseSmartArtTypography2026071703000")).toBeGreaterThan(
      names.indexOf("AddSmartArtTemplateLayouts2026071702000"),
    );
  });

  it("registers project member pins after the existing project migrations", () => {
    const migrations = Array.isArray(databaseOptions.migrations)
      ? databaseOptions.migrations
      : [];
    const names = migrations.map((migration) =>
      typeof migration === "function" ? migration.name : "",
    );

    expect(names).toContain("AddProjectMemberPins2026071801000");
    expect(names.indexOf("AddProjectMemberPins2026071801000")).toBeGreaterThan(
      names.indexOf("CreateProjectMembers2026063001000"),
    );
  });

  it("registers community template storage after project membership", () => {
    const migrations = Array.isArray(databaseOptions.migrations)
      ? databaseOptions.migrations
      : [];
    const names = migrations.map((migration) =>
      typeof migration === "function" ? migration.name : "",
    );

    expect(names).toContain("CreateCommunityTemplates2026072101000");
    expect(
      names.indexOf("CreateCommunityTemplates2026072101000"),
    ).toBeGreaterThan(names.indexOf("AddProjectMemberPins2026071801000"));
  });
});
