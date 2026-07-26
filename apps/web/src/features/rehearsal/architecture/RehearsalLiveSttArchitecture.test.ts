import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workspaceSourcePath = fileURLToPath(
  new URL("../RehearsalWorkspace.tsx", import.meta.url),
);
const liveSttSessionSourcePath = fileURLToPath(
  new URL("../hooks/useLiveSttSession.ts", import.meta.url),
);
const preflightSourcePath = fileURLToPath(
  new URL("../preflight/RehearsalPreflightScreen.tsx", import.meta.url),
);

describe("rehearsal Live STT boundary", () => {
  it("owns runtime engine selection and port replacement in the session hook", () => {
    const source = fs.readFileSync(liveSttSessionSourcePath, "utf8");
    const preflightSource = fs.readFileSync(preflightSourcePath, "utf8");

    expect(source).toContain(
      'const shouldUseSherpaCompatibility = !engineId || engineId === "sherpa"',
    );
    expect(source).toContain("shouldUseSherpaCompatibility && legacyAdapter");
    expect(source).toContain("return createLiveSttPort(engineId,");
    expect(source).toContain("options.initialPort");
    expect(source).toContain("cachedPort?.engineId === engineId");
    expect(source).toContain('cachedPort.engineId !== "openai-realtime"');
    expect(source).toContain("cachedPort?.dispose()");
    expect(source).toContain("await fetchLiveSttRuntimeConfig()");
    expect(source).toContain("return options.fallbackEngineId");
    expect(preflightSource).toContain("props.resolveLiveSttEngine()");
    expect(preflightSource).toContain("props.createLiveSttPort(engineId)");
  });

  it("updates slide bias through the session-owned port", () => {
    const workspaceSource = fs.readFileSync(workspaceSourcePath, "utf8");
    const sessionSource = fs.readFileSync(liveSttSessionSourcePath, "utf8");

    expect(workspaceSource).toContain(
      "liveSttSession.updateBias(deck, currentSlideIndex",
    );
    expect(workspaceSource).toContain("nearbySlides: getNearbySlides");
    expect(sessionSource).toContain(
      "void portRef.current?.updateBiasPhrases(getBiasPhrasesFromContext(context))",
    );
    expect(sessionSource).toContain(
      "const next = buildLiveSttBiasContext(slide, contextOptions)",
    );
  });
});
