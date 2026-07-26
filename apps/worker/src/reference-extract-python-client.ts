import {
  referenceExtractionResultSchema,
  type ReferenceExtractionFile,
  type ReferenceExtractionResult,
} from "@orbit/shared/deck";

const referenceExtractTimeoutMs = 120_000;

export interface ReferenceExtractPythonFile {
  fileId: string;
  originalName: string;
  mimeType: string;
  body: Uint8Array;
}

export interface ParseReferenceFilesWithPythonInput {
  pythonWorkerUrl: string;
  projectId: string;
  files: ReferenceExtractPythonFile[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface ParseSingleReferenceFileWithPythonInput {
  pythonWorkerUrl: string;
  projectId: string;
  file: ReferenceExtractPythonFile;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export type ReferenceExtractPythonClientErrorCode =
  | "REFERENCE_EXTRACT_INPUT_INVALID"
  | "PYTHON_WORKER_EXTRACT_UNAVAILABLE"
  | "PYTHON_WORKER_EXTRACT_FAILED"
  | "PYTHON_WORKER_EXTRACT_INVALID_RESPONSE";

export class ReferenceExtractPythonClientError extends Error {
  override readonly name = "ReferenceExtractPythonClientError";

  constructor(
    readonly code: ReferenceExtractPythonClientErrorCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export function isReferenceExtractPythonClientError(
  error: unknown,
): error is ReferenceExtractPythonClientError {
  return error instanceof ReferenceExtractPythonClientError;
}

export async function parseReferenceFilesWithPython(
  input: ParseReferenceFilesWithPythonInput,
): Promise<ReferenceExtractionResult> {
  validateInput(input);
  const form = new FormData();
  form.append("project_id", input.projectId);
  for (const file of input.files) {
    form.append("file_ids", file.fileId);
    form.append(
      "files",
      new Blob([Buffer.from(file.body)], { type: file.mimeType }),
      file.originalName,
    );
  }

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(
      workerUrl(input.pythonWorkerUrl, "/documents/parse"),
      {
        method: "POST",
        body: form,
        signal: requestSignal(input.signal),
      },
    );
  } catch {
    throw new ReferenceExtractPythonClientError(
      "PYTHON_WORKER_EXTRACT_UNAVAILABLE",
      true,
      "Python worker reference extraction is unavailable.",
    );
  }

  if (!response.ok) {
    await discardResponseBody(response);
    throw new ReferenceExtractPythonClientError(
      "PYTHON_WORKER_EXTRACT_FAILED",
      response.status === 429 || response.status >= 500,
      `Python worker reference extraction failed with status ${response.status}.`,
    );
  }

  let result: ReferenceExtractionResult;
  try {
    result = referenceExtractionResultSchema.parse(await response.json());
  } catch {
    throw invalidResponse();
  }

  const mimeTypes = new Map(
    input.files.map((file) => [file.fileId, file.mimeType]),
  );
  const files = result.files.map((file) => {
    return {
      ...file,
      mimeType: file.mimeType ?? mimeTypes.get(file.fileId),
    };
  });

  return { files };
}

export async function parseSingleReferenceFileWithPython(
  input: ParseSingleReferenceFileWithPythonInput,
): Promise<ReferenceExtractionFile> {
  const result = await parseReferenceFilesWithPython({
    pythonWorkerUrl: input.pythonWorkerUrl,
    projectId: input.projectId,
    files: [input.file],
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  });
  const file = result.files[0];
  if (
    result.files.length !== 1 ||
    !file ||
    file.projectId !== input.projectId ||
    file.fileId !== input.file.fileId
  ) {
    throw invalidResponse();
  }
  return file;
}

function validateInput(input: ParseReferenceFilesWithPythonInput): void {
  requireIdentity(input.pythonWorkerUrl, "pythonWorkerUrl");
  requireIdentity(input.projectId, "projectId");
  if (input.files.length === 0) {
    throw invalidInput("At least one reference file is required.");
  }
  for (const file of input.files) {
    requireIdentity(file.fileId, "fileId");
    requireIdentity(file.originalName, "originalName");
    requireIdentity(file.mimeType, "mimeType");
    if (!(file.body instanceof Uint8Array) || file.body.byteLength === 0) {
      throw invalidInput("Reference file body must be a non-empty Uint8Array.");
    }
  }
}

function requireIdentity(value: string, label: string): void {
  if (!value || value.trim() !== value) {
    throw invalidInput(`${label} must be a non-empty trimmed string.`);
  }
}

function invalidInput(message: string): ReferenceExtractPythonClientError {
  return new ReferenceExtractPythonClientError(
    "REFERENCE_EXTRACT_INPUT_INVALID",
    false,
    message,
  );
}

function invalidResponse(): ReferenceExtractPythonClientError {
  return new ReferenceExtractPythonClientError(
    "PYTHON_WORKER_EXTRACT_INVALID_RESPONSE",
    false,
    "Python worker returned an invalid reference extraction response.",
  );
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(referenceExtractTimeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response body is intentionally ignored so provider details stay private.
  }
}

function workerUrl(baseUrl: string, path: string): string {
  return new URL(
    path,
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  ).toString();
}
