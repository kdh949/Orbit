import {
  env,
  pipeline,
  type ProgressInfo
} from "@huggingface/transformers";

export const E5_MODEL_ID = "Xenova/multilingual-e5-small" as const;
export const E5_EMBEDDING_DIMENSIONS = 384;
export const E5_PREFIX_MODE = "query-query" as const;

export type E5EmbeddingProgress = {
  status: string;
  file?: string;
  progress?: number;
};

export type E5EmbeddingService = {
  embedQuery: (text: string) => Promise<Float32Array>;
  embedPassages: (texts: readonly string[]) => Promise<Float32Array[]>;
};

type E5ExtractorOutput = {
  data: ArrayLike<number>;
  dims: readonly number[];
};

type E5FeatureExtractor = (
  texts: string | string[],
  options?: { pooling?: "mean"; normalize?: boolean }
) => Promise<E5ExtractorOutput>;

type E5FeatureExtractorLoader = () => Promise<E5FeatureExtractor>;

let sharedExtractorPromise: Promise<E5FeatureExtractor> | null = null;
let sharedServicePromise: Promise<E5EmbeddingService> | null = null;
const progressListeners = new Set<(progress: E5EmbeddingProgress) => void>();

export async function getE5EmbeddingService(
  onProgress?: (progress: E5EmbeddingProgress) => void
): Promise<E5EmbeddingService> {
  if (onProgress) {
    progressListeners.add(onProgress);
  }

  sharedServicePromise ??= loadDefaultE5FeatureExtractor().then((extractor) =>
    createE5EmbeddingService(async () => extractor)
  );

  return sharedServicePromise;
}

export function createE5EmbeddingService(
  loadExtractor: E5FeatureExtractorLoader
): E5EmbeddingService {
  let extractorPromise: Promise<E5FeatureExtractor> | null = null;
  const getExtractor = () => {
    extractorPromise ??= loadExtractor();
    return extractorPromise;
  };

  return {
    async embedQuery(text) {
      const extractor = await getExtractor();
      const output = await extractor(`query: ${normalizeEmbeddingText(text)}`, {
        pooling: "mean",
        normalize: true
      });
      const embeddings = tensorOutputToRows(output, 1);
      return embeddings[0] ?? new Float32Array();
    },
    async embedPassages(texts) {
      if (texts.length === 0) {
        return [];
      }

      const extractor = await getExtractor();
      const output = await extractor(
        texts.map((text) => `query: ${normalizeEmbeddingText(text)}`),
        { pooling: "mean", normalize: true }
      );
      return tensorOutputToRows(output, texts.length);
    }
  };
}

async function loadDefaultE5FeatureExtractor(): Promise<E5FeatureExtractor> {
  sharedExtractorPromise ??= loadE5FeatureExtractor();
  return sharedExtractorPromise;
}

async function loadE5FeatureExtractor(): Promise<E5FeatureExtractor> {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;

  const extractor = await pipeline("feature-extraction", E5_MODEL_ID, {
    progress_callback: emitProgress
  });
  return extractor as E5FeatureExtractor;
}

function emitProgress(progressInfo: ProgressInfo) {
  const progress = normalizeProgress(progressInfo);
  for (const listener of progressListeners) {
    listener(progress);
  }
}

function normalizeProgress(progressInfo: ProgressInfo): E5EmbeddingProgress {
  const value = progressInfo as {
    status?: unknown;
    file?: unknown;
    progress?: unknown;
  };
  return {
    status: typeof value.status === "string" ? value.status : "progress",
    ...(typeof value.file === "string" ? { file: value.file } : {}),
    ...(typeof value.progress === "number" ? { progress: value.progress } : {})
  };
}

function tensorOutputToRows(
  output: E5ExtractorOutput,
  expectedRows: number
): Float32Array[] {
  const dimensions = output.dims;
  if (dimensions.length === 1 && expectedRows === 1) {
    return [toFloat32Array(output.data, 0, dimensions[0] ?? output.data.length)];
  }

  const rows = dimensions[0];
  const columns = dimensions[1];
  if (
    rows !== expectedRows ||
    typeof columns !== "number" ||
    output.data.length !== rows * columns
  ) {
    throw new Error("Unexpected E5 embedding output");
  }

  return Array.from({ length: rows }, (_, rowIndex) =>
    toFloat32Array(output.data, rowIndex * columns, columns)
  );
}

function toFloat32Array(data: ArrayLike<number>, start: number, length: number) {
  if (length <= 0) {
    return new Float32Array();
  }

  const row = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    row[index] = data[start + index] ?? 0;
  }
  return row;
}

function normalizeEmbeddingText(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}
