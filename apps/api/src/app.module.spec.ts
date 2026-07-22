import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { AppModule } from "./app.module";

describe("AppModule", () => {
  it("does not register legacy AI PPT producer modules", () => {
    const moduleNames = (
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as Array<{
        name?: string;
      }>
    ).map((module) => module.name);

    expect(moduleNames).not.toContain("PptxImportsModule");
    expect(moduleNames).not.toContain("AiTemplateDeckGenerationModule");
    expect(moduleNames).toContain("PptxOoxmlGenerationsModule");
    expect(moduleNames).toContain("OoxmlReferenceTemplateGenerationsModule");
    expect(moduleNames).toContain("GenerateDeckModule");
    expect(moduleNames).toContain("CommunityTemplatesModule");
  });
});
