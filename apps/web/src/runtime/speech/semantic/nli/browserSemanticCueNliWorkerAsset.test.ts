import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveBrowserSemanticCueNliWorkerUrl } from "./browserSemanticCueNliWorkerAsset";

const currentDir = dirname(fileURLToPath(import.meta.url));

describe("resolveBrowserSemanticCueNliWorkerUrl", () => {
  it("uses the source worker module in dev so Vite serves it as an ES module", () => {
    expect(
      resolveBrowserSemanticCueNliWorkerUrl({
        DEV: true,
        BASE_URL: "/"
      })
    ).toBe("/src/runtime/speech/semantic/nli/browserSemanticCueNliWorker.ts");
  });

  it("uses the separately built worker asset in production", () => {
    expect(
      resolveBrowserSemanticCueNliWorkerUrl({
        DEV: false,
        BASE_URL: "/"
      })
    ).toBe("/semantic-cue-nli-worker.js");
  });

  it("preserves a configured production base URL", () => {
    expect(
      resolveBrowserSemanticCueNliWorkerUrl({
        DEV: false,
        BASE_URL: "/orbit/"
      })
    ).toBe("/orbit/semantic-cue-nli-worker.js");
  });

  it("uses the sequence classification logits instead of deriving neutral and contradiction", async () => {
    const source = await readFile(resolve(currentDir, "browserSemanticCueNliWorker.ts"), "utf8");

    expect(source).toContain("AutoModelForSequenceClassification");
    expect(source).toContain("mapPairwiseNliLogits");
    expect(source).toContain("text_pair");
    expect(source).not.toContain("unresolvedScore");
  });
});
