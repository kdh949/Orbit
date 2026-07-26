import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rehearsalWorkspaceSource = fs.readFileSync(
  fileURLToPath(new URL("./RehearsalWorkspace.tsx", import.meta.url)),
  "utf8",
);

const rehearsalRoutesSource = fs.readFileSync(
  fileURLToPath(new URL("./rehearsalRoutes.ts", import.meta.url)),
  "utf8",
);

const webRehearsalApiSource = fs.readFileSync(
  fileURLToPath(new URL("./api/rehearsalApi.ts", import.meta.url)),
  "utf8",
);

const serverRehearsalApiSource = fs.readFileSync(
  fileURLToPath(
    new URL(
      "../../../../api/src/rehearsals/rehearsals.service.ts",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("rehearsal mode isolation", () => {
  it("keeps the existing rehearsal lifecycle on rehearsal-only endpoints", () => {
    expect(webRehearsalApiSource).toContain(
      "/api/v1/projects/${encodeURIComponent(projectId)}/rehearsals",
    );
    expect(webRehearsalApiSource).toContain(
      "/api/v1/rehearsals/${encodeURIComponent(runId)}/audio/complete",
    );
    expect(rehearsalRoutesSource).toContain(
      "/rehearsal/${encodeURIComponent(projectId)}/report/${encodeURIComponent(runId)}",
    );
    expect(rehearsalWorkspaceSource).toContain('from "./rehearsalRoutes"');
    expect(rehearsalWorkspaceSource).not.toContain("presentation-runs");
    expect(webRehearsalApiSource).not.toContain("presentation-runs");
  });

  it("keeps rehearsal analysis persistence independent from presentation runs", () => {
    expect(serverRehearsalApiSource).toContain('type: "rehearsal-stt"');
    expect(serverRehearsalApiSource).toContain("RehearsalRunEntity");
    expect(serverRehearsalApiSource).not.toContain("PresentationRunEntity");
    expect(serverRehearsalApiSource).not.toContain(
      'type: "presentation-analysis"',
    );
  });
});
