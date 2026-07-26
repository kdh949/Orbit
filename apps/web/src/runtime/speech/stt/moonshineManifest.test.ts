import { describe, expect, it, vi } from "vitest";
import {
  loadMoonshineModelManifest,
  resolveMoonshineModelManifest,
  type MoonshineModelManifest,
} from "./moonshineManifest";

describe("moonshineManifest", () => {
  it("manifest asset URL을 manifest 위치 기준으로 해석한다", () => {
    const resolved = resolveMoonshineModelManifest(
      manifestFixture(),
      "http://localhost/models/live-stt/moonshine/korean/manifest.json",
    );

    expect(resolved.runtime.worker).toBe(
      "http://localhost/models/live-stt/moonshine/korean/moonshine-worker.js",
    );
    expect(resolved.model.model).toBe(
      "http://localhost/models/live-stt/moonshine/korean/moonshine.onnx",
    );
  });

  it("provider와 language를 검증한다", async () => {
    await expect(
      loadMoonshineModelManifest({
        manifestUrl: "/manifest.json",
        fetcher: vi.fn(async () =>
          jsonResponse({ ...manifestFixture(), provider: "other" }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("provider must be moonshine");

    await expect(
      loadMoonshineModelManifest({
        manifestUrl: "/manifest.json",
        fetcher: vi.fn(async () =>
          jsonResponse({ ...manifestFixture(), language: "en" }),
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("language must be ko");
  });

  it("manifest fetch 실패를 예측 가능한 오류로 변환한다", async () => {
    await expect(
      loadMoonshineModelManifest({
        manifestUrl: "/missing.json",
        fetcher: vi.fn(async () => ({
          ok: false,
          status: 404,
        })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Moonshine model manifest is unavailable: 404");
  });
});

function manifestFixture(): MoonshineModelManifest {
  return {
    provider: "moonshine",
    modelId: "moonshine-korean-local",
    version: "2026-07-03",
    baseUrl: ".",
    sampleRate: 16000,
    language: "ko",
    runtime: {
      worker: "moonshine-worker.js",
      wasm: "moonshine.wasm",
    },
    model: {
      model: "moonshine.onnx",
      tokens: "tokens.txt",
    },
  };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}
