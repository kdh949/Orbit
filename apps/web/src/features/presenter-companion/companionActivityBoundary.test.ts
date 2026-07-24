import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const companionRendererSource = read(
  "./CompanionAudienceRenderer.tsx",
);
const activityAudienceSource = read(
  "../activity-slides/rendering/ActivityAudienceSlideRenderer.tsx",
);
const activityResultSource = read(
  "../activity-slides/rendering/ActivityResultSlideRenderer.tsx",
);
const activityQrSource = read(
  "../activity-slides/rendering/ActivityQrElementContent.tsx",
);

describe("companion activity authentication boundary", () => {
  it("provides companion-scoped projections to every activity renderer", () => {
    expect(companionRendererSource).toContain(
      "<CompanionActivityProjectionProvider",
    );
    expect(activityAudienceSource).toContain(
      "if (usesProvidedProjection) {",
    );
    expect(activityResultSource).toContain(
      "if (usesProvidedProjection) {",
    );
    expect(activityQrSource).toContain(
      "providedRuntime",
    );
    expect(activityQrSource).toContain(
      ": subscribeActivityQrRuntime(input, listener)",
    );
  });
});

function read(relativePath: string) {
  return fs.readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}
