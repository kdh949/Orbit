import { describe, expect, it } from "vitest";
import {
  defaultSherpaOnnxModelId,
  resolveSherpaOnnxModelManifest,
  type SherpaOnnxModelManifest
} from "./sherpaOnnxManifest";

describe("sherpaOnnxManifest", () => {
  it("resolves runtime and model asset URLs relative to manifest baseUrl", () => {
    const manifest: SherpaOnnxModelManifest = {
      provider: "sherpa-onnx",
      modelId: defaultSherpaOnnxModelId,
      version: "2024-06-16",
      baseUrl: ".",
      sampleRate: 16000,
      runtime: {
        helpers: ["sherpa-onnx-asr.js"],
        script: "sherpa-onnx-wasm-main-asr.js",
        wasm: "sherpa-onnx-wasm-main-asr.wasm",
        data: "sherpa-onnx-wasm-main-asr.data"
      },
      model: {
        encoder: "encoder.onnx",
        decoder: "decoder.onnx",
        joiner: "joiner.onnx",
        tokens: "tokens.txt",
        bpeVocab: "bpe.model"
      }
    };

    const resolved = resolveSherpaOnnxModelManifest(
      manifest,
      "http://localhost:5173/models/live-stt/korean/manifest.json"
    );

    expect(resolved.runtime.script).toBe(
      "http://localhost:5173/models/live-stt/korean/sherpa-onnx-wasm-main-asr.js"
    );
    expect(resolved.runtime.wasm).toBe(
      "http://localhost:5173/models/live-stt/korean/sherpa-onnx-wasm-main-asr.wasm"
    );
    expect(resolved.runtime.helpers).toEqual([
      "http://localhost:5173/models/live-stt/korean/sherpa-onnx-asr.js"
    ]);
    expect(resolved.model.encoder).toBe(
      "http://localhost:5173/models/live-stt/korean/encoder.onnx"
    );
    expect(resolved.model.tokens).toBe(
      "http://localhost:5173/models/live-stt/korean/tokens.txt"
    );
    expect(resolved.model.bpeVocab).toBe(
      "http://localhost:5173/models/live-stt/korean/bpe.model"
    );
  });
});
