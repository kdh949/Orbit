import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";

vi.mock("@orbit/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@orbit/config")>();
  return {
    ...actual,
    loadOrbitConfig: () => ({
      APP_ENV: "test",
      WEB_ORIGIN: "http://localhost:5173",
      SESSION_SECRET: "activity-test-session-secret",
      COOKIE_SECRET: "activity-test-cookie-secret",
      AUTH_COOKIE_SECURE: false,
    }),
  };
});

import { PresentationSessionAccessService } from "../presentation-sessions/presentation-session-access.service";
import { PresentationSessionPersistenceModule } from "../presentation-sessions/presentation-session-persistence.module";
import { ActivitiesModule } from "./activities.module";
import { ActivityRealtimeGateway } from "./activity-realtime.gateway";
import { AudienceActiveActivityController } from "./audience-active-activity.controller";
import { AudienceActivityController } from "./audience-activity.controller";

describe("ActivitiesModule", () => {
  it("resolves presentation access through the acyclic persistence boundary", () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      ActivitiesModule,
    ) as unknown[];
    const exportedProviders = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      PresentationSessionPersistenceModule,
    ) as unknown[];

    expect(imports).toContain(PresentationSessionPersistenceModule);
    expect(exportedProviders).toContain(PresentationSessionAccessService);
    expect(
      Reflect.getMetadata("design:paramtypes", ActivityRealtimeGateway),
    ).toContain(PresentationSessionAccessService);
    expect(
      Reflect.getMetadata("design:paramtypes", AudienceActivityController),
    ).toContain(PresentationSessionAccessService);
    expect(
      Reflect.getMetadata(
        "design:paramtypes",
        AudienceActiveActivityController,
      ),
    ).toContain(PresentationSessionAccessService);
  });
});
