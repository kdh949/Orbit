export const defaultMoonshineModelId = "moonshine-korean-local";
export const defaultMoonshineManifestUrl = `/models/live-stt/moonshine/${defaultMoonshineModelId}/manifest.json`;

export type MoonshineModelManifest = {
  provider: "moonshine";
  modelId: string;
  version: string;
  baseUrl: string;
  sampleRate: number;
  language: "ko";
  runtime: {
    worker: string;
    wasm?: string;
    data?: string;
  };
  model: {
    model: string;
    tokens?: string;
  };
};

export type ResolvedMoonshineModelManifest = Omit<
  MoonshineModelManifest,
  "baseUrl" | "runtime" | "model"
> & {
  baseUrl: string;
  manifestUrl: string;
  runtime: {
    worker: string;
    wasm: string | null;
    data: string | null;
  };
  model: {
    model: string;
    tokens: string | null;
  };
};

export async function loadMoonshineModelManifest(
  options: {
    manifestUrl?: string;
    fetcher?: typeof fetch;
  } = {},
) {
  const manifestUrl = options.manifestUrl ?? defaultMoonshineManifestUrl;
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(manifestUrl, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Moonshine model manifest is unavailable: ${response.status}`,
    );
  }

  return resolveMoonshineModelManifest(
    parseMoonshineModelManifest(await response.json()),
    manifestUrl,
  );
}

export function resolveMoonshineModelManifest(
  manifest: MoonshineModelManifest,
  manifestUrl: string,
): ResolvedMoonshineModelManifest {
  const baseUrl = resolveManifestUrl(manifest.baseUrl, manifestUrl);

  return {
    ...manifest,
    baseUrl,
    manifestUrl: resolveManifestUrl("", manifestUrl),
    runtime: {
      worker: resolveAssetUrl(manifest.runtime.worker, baseUrl),
      wasm: manifest.runtime.wasm
        ? resolveAssetUrl(manifest.runtime.wasm, baseUrl)
        : null,
      data: manifest.runtime.data
        ? resolveAssetUrl(manifest.runtime.data, baseUrl)
        : null,
    },
    model: {
      model: resolveAssetUrl(manifest.model.model, baseUrl),
      tokens: manifest.model.tokens
        ? resolveAssetUrl(manifest.model.tokens, baseUrl)
        : null,
    },
  };
}

function parseMoonshineModelManifest(value: unknown): MoonshineModelManifest {
  if (!isRecord(value)) {
    throw new Error("Moonshine model manifest must be an object.");
  }

  const provider = readString(value, "provider");
  if (provider !== "moonshine") {
    throw new Error("Moonshine model manifest provider must be moonshine.");
  }

  const language = readString(value, "language");
  if (language !== "ko") {
    throw new Error("Moonshine model manifest language must be ko.");
  }

  const runtime = readRecord(value, "runtime");
  const model = readRecord(value, "model");

  return {
    provider,
    modelId: readString(value, "modelId"),
    version: readString(value, "version"),
    baseUrl: readString(value, "baseUrl"),
    sampleRate: readPositiveInteger(value, "sampleRate"),
    language,
    runtime: {
      worker: readString(runtime, "worker"),
      wasm: readOptionalString(runtime, "wasm"),
      data: readOptionalString(runtime, "data"),
    },
    model: {
      model: readString(model, "model"),
      tokens: readOptionalString(model, "tokens"),
    },
  };
}

function resolveManifestUrl(path: string, manifestUrl: string) {
  return new URL(
    path || ".",
    new URL(manifestUrl, readLocationHref()),
  ).toString();
}

function resolveAssetUrl(path: string, baseUrl: string) {
  return new URL(path, baseUrl).toString();
}

function readRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`Moonshine model manifest ${key} must be an object.`);
  }

  return value;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Moonshine model manifest ${key} must be a non-empty string.`,
    );
  }

  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Moonshine model manifest ${key} must be a string.`);
  }

  return value;
}

function readPositiveInteger(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(
      `Moonshine model manifest ${key} must be a positive integer.`,
    );
  }

  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLocationHref() {
  return globalThis.location?.href ?? "http://localhost/";
}
