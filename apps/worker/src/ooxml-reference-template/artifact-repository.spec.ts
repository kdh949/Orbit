import { describe, expect, it, vi } from "vitest";

import {
  OoxmlReferenceTemplateArtifactRepository,
  slideRenderShardKey,
} from "./artifact-repository";

const artifactId = "365f849f-2ed0-4b0f-91a6-7144b1992928";
const identity = {
  jobId: "job-ooxml-reference-1",
  projectId: "project-a",
  stage: "content-planning" as const,
  shardKey: "",
};
const payload = {
  outline: [{ order: 1, title: "운영 리뷰" }],
  assignmentCount: 4,
};

describe("OoxmlReferenceTemplateArtifactRepository", () => {
  it("stores a successful artifact without an update path", async () => {
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => [
      artifactRow(),
    ]);
    const repository = new OoxmlReferenceTemplateArtifactRepository({ query });

    await expect(repository.storeSucceeded(identity, payload)).resolves.toEqual(
      {
        artifactId,
        ...identity,
        payload,
      },
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "ON CONFLICT (job_id, stage, shard_key) DO NOTHING",
      ),
      expect.arrayContaining([
        expect.any(String),
        identity.jobId,
        identity.projectId,
        identity.stage,
        identity.shardKey,
        payload,
      ]),
    );
    expect(query.mock.calls[0]?.[0]).not.toContain("DO UPDATE");
    expect(query.mock.calls[0]?.[0]).toContain(
      "jobs.status IN ('queued','running')",
    );
  });

  it("returns the immutable successful artifact on retry", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([artifactRow()]);
    const repository = new OoxmlReferenceTemplateArtifactRepository({ query });

    await expect(repository.storeSucceeded(identity, payload)).resolves.toEqual(
      {
        artifactId,
        ...identity,
        payload,
      },
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("fails closed when an immutable retry conflicts with the stored payload", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        artifactRow({ payload_json: { outline: [], assignmentCount: 0 } }),
      ]);
    const repository = new OoxmlReferenceTemplateArtifactRepository({ query });

    await expect(repository.storeSucceeded(identity, payload)).rejects.toThrow(
      "immutable replay conflict",
    );
  });

  it("finds a successful artifact only through the same tenant and generation Job", async () => {
    const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => [
      artifactRow(),
    ]);
    const repository = new OoxmlReferenceTemplateArtifactRepository({ query });

    await expect(repository.findSucceeded(identity)).resolves.toEqual({
      artifactId,
      ...identity,
      payload,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "jobs.type = 'ooxml-reference-template-generation'",
      ),
      [identity.jobId, identity.projectId, identity.stage, identity.shardKey],
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "jobs.status IN ('queued','running','succeeded')",
    );
  });

  it("rejects a row whose stored identity crosses tenant or Job type boundaries", async () => {
    const query = vi.fn(async () => [artifactRow({ project_id: "project-b" })]);
    const repository = new OoxmlReferenceTemplateArtifactRepository({ query });

    await expect(repository.findSucceeded(identity)).rejects.toThrow(
      "identity",
    );
  });

  it("uses a fixed zero-padded slide-render shard and rejects other shard forms", async () => {
    expect(slideRenderShardKey(1)).toBe("001");
    expect(slideRenderShardKey(500)).toBe("500");
    expect(() => slideRenderShardKey(0)).toThrow();

    const repository = new OoxmlReferenceTemplateArtifactRepository({
      query: vi.fn(),
    });
    await expect(
      repository.storeSucceeded(
        { ...identity, stage: "slide-render", shardKey: "1" },
        { slideId: "slide-1", order: 1, renderAssetFileId: "file-render-1" },
      ),
    ).rejects.toThrow("shard");
    await expect(
      repository.storeSucceeded(
        { ...identity, stage: "slide-render", shardKey: "001" },
        { slideId: "slide-1", order: 2, renderAssetFileId: "file-render-1" },
      ),
    ).rejects.toThrow("order");
  });

  it.each([
    { rawPackageBytes: [80, 75, 3, 4] },
    { rawPackageXml: "<p:presentation />" },
    { packageBase64: "UEsDBA==" },
    { blob: Buffer.from([80, 75, 3, 4]) },
    { blob: new Uint16Array([80, 75, 3, 4]) },
    { nested: { storageKey: "private/project-a/generated.pptx" } },
    { nested: [{ signedUrl: "https://private.invalid/file" }] },
  ])(
    "rejects private binary data or locators before querying",
    async (forbidden) => {
      const query = vi.fn();
      const repository = new OoxmlReferenceTemplateArtifactRepository({
        query,
      });

      await expect(
        repository.storeSucceeded(identity, { ...payload, ...forbidden }),
      ).rejects.toThrow("private binary locator");
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("strictly validates slide-render artifacts before persistence", async () => {
    const query = vi.fn();
    const repository = new OoxmlReferenceTemplateArtifactRepository({ query });

    await expect(
      repository.storeSucceeded(
        { ...identity, stage: "slide-render", shardKey: "001" },
        {
          slideId: "slide-1",
          order: 1,
          renderAssetFileId: "file-render-1",
          signedUrl: "https://private.invalid/file",
        },
      ),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it("stores the processor-wrapped render-validation artifact", async () => {
    const renderIdentity = {
      ...identity,
      stage: "render-validation" as const,
    };
    const renderPayload = {
      data: {
        fidelityReport: passedFidelityReport(),
        renderAssets: [
          {
            fileId: "file-render-001",
            originalName: "slide-001.png",
            size: 1024,
          },
        ],
      },
      metrics: { sourceSlideCount: 1, slotCount: 2 },
      issueCodes: [],
    };
    const query = vi.fn(async () => [
      artifactRow({
        stage: renderIdentity.stage,
        payload_json: renderPayload,
      }),
    ]);
    const repository = new OoxmlReferenceTemplateArtifactRepository({ query });

    await expect(
      repository.storeSucceeded(renderIdentity, renderPayload),
    ).resolves.toMatchObject({
      ...renderIdentity,
      payload: renderPayload,
    });
  });

  it("rejects the obsolete direct render-validation payload", async () => {
    const query = vi.fn();
    const repository = new OoxmlReferenceTemplateArtifactRepository({ query });

    await expect(
      repository.storeSucceeded(
        { ...identity, stage: "render-validation" },
        { fidelityReport: passedFidelityReport(), warningCodes: [] },
      ),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

function passedFidelityReport() {
  return {
    status: "passed",
    structuralGate: { passed: true, issueCodes: [] },
    identityControl: {
      status: "passed",
      evaluatedSlideCount: 1,
      packageWarningCount: 0,
      lockedGeometryDriftCount: 0,
    },
    generatedComparison: {
      status: "passed",
      evaluatedSlideCount: 1,
      lockedRegionDriftCount: 0,
      slotOverflowCount: 0,
    },
    warningCodes: [],
  };
}

function artifactRow(overrides: Record<string, unknown> = {}) {
  return {
    artifact_id: artifactId,
    job_id: identity.jobId,
    project_id: identity.projectId,
    stage: identity.stage,
    shard_key: identity.shardKey,
    payload_json: payload,
    created_at: "2026-07-22T00:00:00.000Z",
    updated_at: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}
