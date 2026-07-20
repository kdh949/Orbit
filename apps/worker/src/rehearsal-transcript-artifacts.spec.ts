import type { StoragePort } from "@orbit/storage";
import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";

import { storeRehearsalTranscriptArtifacts } from "./rehearsal-transcript-artifacts";

const input = {
  projectId: "project-a",
  runId: "run-a",
  runCreatedAt: "2026-07-15T15:30:00.000Z",
  transcriptJsonFileId: null,
  transcriptTextFileId: null,
  transcriptJsonStatus: null,
  transcriptTextStatus: null,
  liveTranscript: "브라우저에서 인식한 전체 문장",
  transcription: {
    transcript: "안녕하세요. 발표를 시작하겠습니다.",
    language: "ko",
    provider: "whisperx",
    durationSeconds: 5.4,
    segments: [
      { text: "안녕하세요.", startSeconds: 0, endSeconds: 2.1 },
      { text: "발표를 시작하겠습니다.", startSeconds: 2.1, endSeconds: 5.4 },
    ],
  },
};

describe("storeRehearsalTranscriptArtifacts", () => {
  it("stores JSON and text artifacts and links them in one DB transaction", async () => {
    const storage = createStorage();
    const { dataSource, query, transaction } = createDataSource();

    const refs = await storeRehearsalTranscriptArtifacts(
      dataSource,
      storage,
      input,
    );

    expect(refs.jsonFileId).toMatch(/^file_rehearsal_transcript_[a-f0-9]{32}$/);
    expect(refs.textFileId).toMatch(/^file_rehearsal_transcript_[a-f0-9]{32}$/);
    expect(storage.putObject).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        key: "rehearsals/2026-07-16/project-a/run-a/transcript.json",
        contentType: "application/json; charset=utf-8",
        purpose: "rehearsal-transcript-json",
      }),
    );
    expect(storage.putObject).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        key: "rehearsals/2026-07-16/project-a/run-a/transcript.txt",
        contentType: "text/plain; charset=utf-8",
        purpose: "rehearsal-transcript-text",
      }),
    );

    const jsonCall = vi.mocked(storage.putObject).mock.calls[0]?.[0];
    const jsonBody = JSON.parse(Buffer.from(jsonCall?.body ?? []).toString("utf8"));
    expect(jsonBody).toEqual({
      text: input.transcription.transcript,
      liveTranscript: input.liveTranscript,
      language: "ko",
      duration: 5.4,
      provider: "whisperx",
      segments: [
        { text: "안녕하세요.", start: 0, end: 2.1 },
        { text: "발표를 시작하겠습니다.", start: 2.1, end: 5.4 },
      ],
    });
    const textCall = vi.mocked(storage.putObject).mock.calls[1]?.[0];
    expect(Buffer.from(textCall?.body ?? []).toString("utf8")).toBe(
      input.transcription.transcript,
    );

    expect(transaction).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WITH json_asset AS"),
      expect.arrayContaining([
        "project-a",
        "run-a",
        refs.jsonFileId,
        refs.textFileId,
      ]),
    );
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "transcript_retained = true",
    );
    expect(storage.removeObject).not.toHaveBeenCalled();
  });

  it("returns existing uploaded artifacts without writing duplicates", async () => {
    const firstStorage = createStorage();
    const firstDataSource = createDataSource();
    const refs = await storeRehearsalTranscriptArtifacts(
      firstDataSource.dataSource,
      firstStorage,
      input,
    );
    const storage = createStorage({
      headObject: vi.fn(async () => ({
        contentLength: 10,
        contentType: "application/octet-stream",
      })),
    });
    const { dataSource, transaction } = createDataSource();

    await expect(
      storeRehearsalTranscriptArtifacts(dataSource, storage, {
        ...input,
        transcriptJsonFileId: refs.jsonFileId,
        transcriptTextFileId: refs.textFileId,
        transcriptJsonStatus: "uploaded",
        transcriptTextStatus: "uploaded",
      }),
    ).resolves.toEqual(refs);

    expect(storage.putObject).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("removes newly uploaded objects when the DB transaction fails", async () => {
    const storage = createStorage();
    const { dataSource } = createDataSource({
      transactionError: new Error("database unavailable"),
    });

    await expect(
      storeRehearsalTranscriptArtifacts(dataSource, storage, input),
    ).rejects.toThrow("database unavailable");

    expect(storage.removeObject).toHaveBeenCalledTimes(2);
    expect(storage.removeObject).toHaveBeenCalledWith(
      "rehearsals/2026-07-16/project-a/run-a/transcript.json",
    );
    expect(storage.removeObject).toHaveBeenCalledWith(
      "rehearsals/2026-07-16/project-a/run-a/transcript.txt",
    );
  });

  it("compensates the first upload when the second upload fails", async () => {
    const storage = createStorage({
      putObject: vi
        .fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("text upload failed")),
    });
    const { dataSource, transaction } = createDataSource();

    await expect(
      storeRehearsalTranscriptArtifacts(dataSource, storage, input),
    ).rejects.toThrow("text upload failed");

    expect(storage.removeObject).toHaveBeenCalledTimes(2);
    expect(transaction).not.toHaveBeenCalled();
  });
});

function createStorage(overrides: Partial<StoragePort> = {}) {
  return {
    headObject: vi.fn(async () => null),
    putObject: vi.fn(async (value) => ({
      key: value.key,
      url: `http://minio/${value.key}`,
      contentType: value.contentType,
      purpose: value.purpose,
      size:
        typeof value.body === "string" ? value.body.length : value.body.byteLength,
    })),
    removeObject: vi.fn(async () => undefined),
    ...overrides,
  } as Pick<StoragePort, "headObject" | "putObject" | "removeObject">;
}

function createDataSource(options: { transactionError?: Error } = {}) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => [
    { run_id: "run-a" },
  ]);
  const transaction = vi.fn(async (callback: (manager: { query: typeof query }) => unknown) => {
    if (options.transactionError) throw options.transactionError;
    return callback({ query });
  });
  return {
    query,
    transaction,
    dataSource: { transaction } as unknown as DataSource,
  };
}
