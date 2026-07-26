import { describe, expect, it, vi } from "vitest";

import {
  createE5EmbeddingService,
  E5_EMBEDDING_DIMENSIONS,
  E5_MODEL_ID,
  E5_PREFIX_MODE
} from "./e5EmbeddingService";

describe("createE5EmbeddingService", () => {
  it("spike 결정대로 query-query prefix를 강제하고 mean pooling normalization으로 호출한다", async () => {
    const extractor = vi.fn(async (texts: string | string[]) => ({
      data: new Float32Array(Array.isArray(texts) ? [1, 0, 0, 1] : [0.5, 0.5]),
      dims: Array.isArray(texts) ? [2, 2] : [1, 2]
    }));
    const loader = vi.fn(async () => extractor);
    const service = createE5EmbeddingService(loader);

    await expect(service.embedQuery("  latest final transcript  ")).resolves.toEqual(
      new Float32Array([0.5, 0.5])
    );
    await expect(service.embedPassages(["first sentence", "second sentence"])).resolves.toEqual([
      new Float32Array([1, 0]),
      new Float32Array([0, 1])
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(extractor).toHaveBeenNthCalledWith(1, "query: latest final transcript", {
      pooling: "mean",
      normalize: true
    });
    expect(extractor).toHaveBeenNthCalledWith(
      2,
      ["query: first sentence", "query: second sentence"],
      {
        pooling: "mean",
        normalize: true
      }
    );
  });

  it("빈 passage 배열은 모델을 호출하지 않고 빈 배열을 반환한다", async () => {
    const loader = vi.fn(async () =>
      vi.fn(async () => ({ data: new Float32Array(), dims: [0, E5_EMBEDDING_DIMENSIONS] }))
    );
    const service = createE5EmbeddingService(loader);

    await expect(service.embedPassages([])).resolves.toEqual([]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("batch embedding 차원이 맞지 않으면 recoverable error로 실패한다", async () => {
    const service = createE5EmbeddingService(async () =>
      vi.fn(async () => ({ data: new Float32Array([1, 2, 3]), dims: [2, 2] }))
    );

    await expect(service.embedPassages(["first", "second"])).rejects.toThrow(
      "Unexpected E5 embedding output"
    );
  });
});

describe("E5 constants", () => {
  it("spike의 multilingual-e5-small query-query 정책과 384차원 출력을 고정한다", () => {
    expect(E5_MODEL_ID).toBe("Xenova/multilingual-e5-small");
    expect(E5_PREFIX_MODE).toBe("query-query");
    expect(E5_EMBEDDING_DIMENSIONS).toBe(384);
  });
});
