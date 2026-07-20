import { rehearsalTranscriptArtifactSchema } from "@orbit/shared";
import type { StoragePort } from "@orbit/storage";
import { createHash } from "node:crypto";
import type { DataSource } from "typeorm";

type TranscriptSegment = {
  text: string;
  startSeconds?: number | null;
  endSeconds?: number | null;
};

export type RehearsalTranscriptArtifactInput = {
  projectId: string;
  runId: string;
  runCreatedAt: Date | string;
  transcriptJsonFileId: string | null;
  transcriptTextFileId: string | null;
  transcriptJsonStatus: string | null;
  transcriptTextStatus: string | null;
  liveTranscript?: string | null;
  transcription: {
    transcript: string;
    language: string;
    provider: string;
    durationSeconds?: number | null;
    segments: TranscriptSegment[];
  };
};

export type RehearsalTranscriptArtifactRefs = {
  jsonFileId: string;
  textFileId: string;
};

type TranscriptArtifactStorage = Pick<
  StoragePort,
  "headObject" | "putObject" | "removeObject"
>;

export async function storeRehearsalTranscriptArtifacts(
  dataSource: DataSource,
  storage: TranscriptArtifactStorage,
  input: RehearsalTranscriptArtifactInput,
): Promise<RehearsalTranscriptArtifactRefs> {
  const date = formatAsiaSeoulDate(input.runCreatedAt);
  const baseKey = `rehearsals/${date}/${input.projectId}/${input.runId}`;
  const jsonKey = `${baseKey}/transcript.json`;
  const textKey = `${baseKey}/transcript.txt`;
  const jsonFileId = transcriptFileId(
    input.projectId,
    input.runId,
    "rehearsal-transcript-json",
  );
  const textFileId = transcriptFileId(
    input.projectId,
    input.runId,
    "rehearsal-transcript-text",
  );
  const refs = { jsonFileId, textFileId };

  const [existingJsonObject, existingTextObject] = await Promise.all([
    storage.headObject(jsonKey),
    storage.headObject(textKey),
  ]);
  if (
    input.transcriptJsonFileId === jsonFileId &&
    input.transcriptTextFileId === textFileId &&
    input.transcriptJsonStatus === "uploaded" &&
    input.transcriptTextStatus === "uploaded" &&
    existingJsonObject &&
    existingTextObject
  ) {
    return refs;
  }

  const artifact = rehearsalTranscriptArtifactSchema.parse({
    text: input.transcription.transcript,
    liveTranscript: input.liveTranscript ?? null,
    language: input.transcription.language,
    duration: input.transcription.durationSeconds ?? 0,
    provider: input.transcription.provider,
    segments: input.transcription.segments.map((segment) => ({
      text: segment.text,
      start: segment.startSeconds ?? null,
      end: segment.endSeconds ?? null,
    })),
  });
  const jsonBody = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const textBody = Buffer.from(input.transcription.transcript, "utf8");
  const newObjectKeys: string[] = [];

  try {
    if (!existingJsonObject) newObjectKeys.push(jsonKey);
    await storage.putObject({
      key: jsonKey,
      body: jsonBody,
      contentType: "application/json; charset=utf-8",
      purpose: "rehearsal-transcript-json",
    });

    if (!existingTextObject) newObjectKeys.push(textKey);
    await storage.putObject({
      key: textKey,
      body: textBody,
      contentType: "text/plain; charset=utf-8",
      purpose: "rehearsal-transcript-text",
    });

    await dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `
          WITH json_asset AS (
            INSERT INTO project_assets (
              file_id, project_id, storage_key, original_name, mime_type, size,
              url, purpose, status, created_at, uploaded_at, deleted_at
            )
            VALUES (
              $3, $1, $5, 'transcript.json', 'application/json; charset=utf-8',
              $7, $9, 'rehearsal-transcript-json', 'uploaded', now(), now(), null
            )
            ON CONFLICT (file_id) DO UPDATE
            SET storage_key = EXCLUDED.storage_key,
                original_name = EXCLUDED.original_name,
                mime_type = EXCLUDED.mime_type,
                size = EXCLUDED.size,
                url = EXCLUDED.url,
                status = 'uploaded',
                uploaded_at = now(),
                deleted_at = null
            WHERE project_assets.project_id = EXCLUDED.project_id
              AND project_assets.purpose = EXCLUDED.purpose
            RETURNING file_id
          ),
          text_asset AS (
            INSERT INTO project_assets (
              file_id, project_id, storage_key, original_name, mime_type, size,
              url, purpose, status, created_at, uploaded_at, deleted_at
            )
            VALUES (
              $4, $1, $6, 'transcript.txt', 'text/plain; charset=utf-8',
              $8, $10, 'rehearsal-transcript-text', 'uploaded', now(), now(), null
            )
            ON CONFLICT (file_id) DO UPDATE
            SET storage_key = EXCLUDED.storage_key,
                original_name = EXCLUDED.original_name,
                mime_type = EXCLUDED.mime_type,
                size = EXCLUDED.size,
                url = EXCLUDED.url,
                status = 'uploaded',
                uploaded_at = now(),
                deleted_at = null
            WHERE project_assets.project_id = EXCLUDED.project_id
              AND project_assets.purpose = EXCLUDED.purpose
            RETURNING file_id
          )
          UPDATE rehearsal_runs
          SET transcript_json_file_id = (SELECT file_id FROM json_asset),
              transcript_text_file_id = (SELECT file_id FROM text_asset),
              transcript_retained = true,
              updated_at = now()
          WHERE project_id = $1
            AND run_id = $2
            AND EXISTS (SELECT 1 FROM json_asset)
            AND EXISTS (SELECT 1 FROM text_asset)
          RETURNING run_id
        `,
        [
          input.projectId,
          input.runId,
          jsonFileId,
          textFileId,
          jsonKey,
          textKey,
          jsonBody.byteLength,
          textBody.byteLength,
          `internal://rehearsals/${input.runId}/transcript.json`,
          `internal://rehearsals/${input.runId}/transcript.txt`,
        ],
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`Rehearsal run not found for transcript artifacts: ${input.runId}`);
      }
    });

    return refs;
  } catch (error) {
    await Promise.allSettled(newObjectKeys.map((key) => storage.removeObject(key)));
    throw error;
  }
}

function transcriptFileId(projectId: string, runId: string, purpose: string): string {
  const digest = createHash("sha256")
    .update(`${projectId}:${runId}:${purpose}`)
    .digest("hex")
    .slice(0, 32);
  return `file_rehearsal_transcript_${digest}`;
}

function formatAsiaSeoulDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Rehearsal run created_at is invalid.");
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const readPart = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  return `${readPart("year")}-${readPart("month")}-${readPart("day")}`;
}
