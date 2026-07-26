export const defaultSherpaOnnxModelId =
  "sherpa-onnx-streaming-zipformer-korean-2024-06-16";

export const defaultSherpaOnnxManifestUrl =
  `/models/live-stt/${defaultSherpaOnnxModelId}/manifest.json`;

export type SherpaOnnxFileMetadata = {
  bytes?: number;
  sha256?: string;
};

export type SherpaOnnxModelManifest = {
  provider: "sherpa-onnx";
  modelId: string;
  version: string;
  baseUrl: string;
  sampleRate: number;
  numThreads?: number;
  decodingMethod?: "greedy_search" | "modified_beam_search";
  runtime: {
    helpers?: string[];
    script: string;
    wasm?: string;
    data?: string;
  };
  model: {
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
    bpeVocab?: string;
  };
  files?: Record<string, SherpaOnnxFileMetadata>;
};

export type ResolvedSherpaOnnxModelManifest = Omit<
  SherpaOnnxModelManifest,
  "baseUrl" | "runtime" | "model"
> & {
  baseUrl: string;
  manifestUrl: string;
  runtime: {
    helpers: string[];
    script: string;
    wasm: string | null;
    data: string | null;
  };
  model: {
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
    bpeVocab: string | null;
  };
};

export async function loadSherpaOnnxModelManifest(
  options: {
    manifestUrl?: string;
    fetcher?: typeof fetch;
  } = {}
): Promise<ResolvedSherpaOnnxModelManifest> {
  const manifestUrl = options.manifestUrl ?? defaultSherpaOnnxManifestUrl;
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(manifestUrl, {
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Live STT model manifest is unavailable: ${response.status}`);
  }

  return resolveSherpaOnnxModelManifest(
    parseSherpaOnnxModelManifest(await response.json()),
    manifestUrl
  );
}

export function resolveSherpaOnnxModelManifest(
  manifest: SherpaOnnxModelManifest,
  manifestUrl: string
): ResolvedSherpaOnnxModelManifest {
  const baseUrl = resolveManifestUrl(manifest.baseUrl, manifestUrl);

  return {
    ...manifest,
    manifestUrl: resolveManifestUrl("", manifestUrl),
    baseUrl,
    runtime: {
      helpers: (manifest.runtime.helpers ?? []).map((helper) =>
        resolveAssetUrl(helper, baseUrl)
      ),
      script: resolveAssetUrl(manifest.runtime.script, baseUrl),
      wasm: manifest.runtime.wasm
        ? resolveAssetUrl(manifest.runtime.wasm, baseUrl)
        : null,
      data: manifest.runtime.data
        ? resolveAssetUrl(manifest.runtime.data, baseUrl)
        : null
    },
    model: {
      encoder: resolveAssetUrl(manifest.model.encoder, baseUrl),
      decoder: resolveAssetUrl(manifest.model.decoder, baseUrl),
      joiner: resolveAssetUrl(manifest.model.joiner, baseUrl),
      tokens: resolveAssetUrl(manifest.model.tokens, baseUrl),
      bpeVocab: manifest.model.bpeVocab
        ? resolveAssetUrl(manifest.model.bpeVocab, baseUrl)
        : null
    }
  };
}

function parseSherpaOnnxModelManifest(value: unknown): SherpaOnnxModelManifest {
  if (!isRecord(value)) {
    throw new Error("Live STT model manifest must be an object.");
  }

  const provider = readString(value, "provider");
  if (provider !== "sherpa-onnx") {
    throw new Error("Live STT model manifest provider must be sherpa-onnx.");
  }

  const runtime = readRecord(value, "runtime");
  const model = readRecord(value, "model");
  const rawDecodingMethod = readOptionalString(value, "decodingMethod");
  if (
    rawDecodingMethod &&
    rawDecodingMethod !== "greedy_search" &&
    rawDecodingMethod !== "modified_beam_search"
  ) {
    throw new Error("Live STT decodingMethod is not supported.");
  }
  const decodingMethod: SherpaOnnxModelManifest["decodingMethod"] =
    rawDecodingMethod === "greedy_search" ||
    rawDecodingMethod === "modified_beam_search"
      ? rawDecodingMethod
      : undefined;

  return {
    provider,
    modelId: readString(value, "modelId"),
    version: readString(value, "version"),
    baseUrl: readString(value, "baseUrl"),
    sampleRate: readPositiveInteger(value, "sampleRate"),
    numThreads: readOptionalPositiveInteger(value, "numThreads"),
    decodingMethod,
    runtime: {
      helpers: readOptionalStringArray(runtime, "helpers"),
      script: readString(runtime, "script"),
      wasm: readOptionalString(runtime, "wasm"),
      data: readOptionalString(runtime, "data")
    },
    model: {
      encoder: readString(model, "encoder"),
      decoder: readString(model, "decoder"),
      joiner: readString(model, "joiner"),
      tokens: readString(model, "tokens"),
      bpeVocab: readOptionalString(model, "bpeVocab")
    },
    files: readOptionalFiles(value)
  };
}

function resolveManifestUrl(path: string, manifestUrl: string) {
  return new URL(path || ".", new URL(manifestUrl, readLocationHref())).toString();
}

function resolveAssetUrl(path: string, baseUrl: string) {
  return new URL(path, baseUrl).toString();
}

function readRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`Live STT model manifest ${key} must be an object.`);
  }

  return value;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Live STT model manifest ${key} is required.`);
  }

  return value.trim();
}

function readOptionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Live STT model manifest ${key} must be a string.`);
  }

  return value.trim();
}

function readOptionalStringArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Live STT model manifest ${key} must be an array.`);
  }

  return value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`Live STT model manifest ${key} must contain strings.`);
    }

    return item.trim();
  });
}

function readPositiveInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Live STT model manifest ${key} must be a positive integer.`);
  }

  return value;
}

function readOptionalPositiveInteger(
  record: Record<string, unknown>,
  key: string
) {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Live STT model manifest ${key} must be a positive integer.`);
  }

  return value;
}

function readOptionalFiles(record: Record<string, unknown>) {
  const value = record.files;
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error("Live STT model manifest files must be an object.");
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, metadata]) => {
      if (!isRecord(metadata)) {
        throw new Error(`Live STT model manifest files.${key} must be an object.`);
      }

      return [
        key,
        {
          bytes: readOptionalPositiveInteger(metadata, "bytes"),
          sha256: readOptionalString(metadata, "sha256")
        }
      ];
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readLocationHref() {
  return typeof window === "undefined" ? "http://localhost/" : window.location.href;
}
