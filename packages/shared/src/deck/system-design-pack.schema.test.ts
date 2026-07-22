import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { systemDesignPackRegistrySchema } from "./system-design-pack.schema";

const fixturePath = resolve(
  process.cwd(),
  "src/deck/fixtures/system-design-pack-registry.json"
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("system design pack registry", () => {
  it("accepts the shared versioned catalog fixture", () => {
    expect(systemDesignPackRegistrySchema.parse(fixture)).toMatchObject({
      catalogVersion: 1,
      packs: [{ id: "neutral-light", version: 1 }]
    });
  });

  it("rejects unknown fields", () => {
    expect(
      systemDesignPackRegistrySchema.safeParse({ ...fixture, arbitrary: true })
        .success
    ).toBe(false);
  });

  it("rejects duplicate layout IDs", () => {
    expect(
      systemDesignPackRegistrySchema.safeParse({
        ...fixture,
        layouts: [...fixture.layouts, structuredClone(fixture.layouts[0])]
      }).success
    ).toBe(false);
  });

  it("rejects invalid content capacity", () => {
    const candidate = structuredClone(fixture);
    candidate.layouts[0].contentCapacity.itemMin = 3;
    candidate.layouts[0].contentCapacity.itemMax = 1;
    expect(systemDesignPackRegistrySchema.safeParse(candidate).success).toBe(false);
  });

  it("rejects unapproved provenance for active packs", () => {
    const candidate = structuredClone(fixture);
    candidate.packs[0].provenance.licenseStatus = "pending";
    expect(systemDesignPackRegistrySchema.safeParse(candidate).success).toBe(false);
  });
});
