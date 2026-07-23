import { readDiagnosticSessionEvents } from "./diagnosticStore";
import type { OrbitDiagnosticEvent } from "./diagnosticTypes";

export type DiagnosticExportFile = {
  blob: Blob;
  fileName: string;
  mediaType: string;
};

type DiagnosticExportOptions = {
  compressionSupported?: boolean;
};

export async function createDiagnosticExport(
  events: readonly OrbitDiagnosticEvent[],
  sessionId: string,
  options: DiagnosticExportOptions = {}
): Promise<DiagnosticExportFile> {
  const jsonl = buildDiagnosticJsonl(events);
  const compressionSupported =
    options.compressionSupported ??
    typeof CompressionStream === "function";
  if (compressionSupported && typeof CompressionStream === "function") {
    const compressed = new Blob([jsonl])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    return {
      blob: await new Response(compressed).blob(),
      fileName: `orbit-diagnostics-${sanitizeFilePart(sessionId)}.jsonl.gz`,
      mediaType: "application/gzip"
    };
  }
  return {
    blob: new Blob([jsonl], { type: "application/x-ndjson" }),
    fileName: `orbit-diagnostics-${sanitizeFilePart(sessionId)}.jsonl`,
    mediaType: "application/x-ndjson"
  };
}

export async function exportDiagnosticSession(args: {
  flush?: () => Promise<void>;
  sessionId: string;
}) {
  await args.flush?.();
  const events = await readDiagnosticSessionEvents(
    args.sessionId,
    Number.MAX_SAFE_INTEGER
  );
  const file = await createDiagnosticExport(events, args.sessionId);
  await saveDiagnosticExport(file);
  return file;
}

export function buildDiagnosticJsonl(
  events: readonly OrbitDiagnosticEvent[]
) {
  return events.map((event) => JSON.stringify(event)).join("\n") +
    (events.length > 0 ? "\n" : "");
}

async function saveDiagnosticExport(file: DiagnosticExportFile) {
  const picker = getDiagnosticSaveFilePicker();
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: file.fileName,
        types: [
          {
            description: "Orbit presentation diagnostics",
            accept: {
              [file.mediaType]: [
                file.fileName.endsWith(".gz") ? ".jsonl.gz" : ".jsonl"
              ]
            }
          }
        ]
      });
      const writable = await handle.createWritable();
      await writable.write(file.blob);
      await writable.close();
      return;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        return;
      }
    }
  }

  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

type DiagnosticSaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{
    accept: Record<string, string[]>;
    description: string;
  }>;
}) => Promise<{
  createWritable: () => Promise<{
    close: () => Promise<void>;
    write: (blob: Blob) => Promise<void>;
  }>;
}>;

function getDiagnosticSaveFilePicker(): DiagnosticSaveFilePicker | null {
  if (typeof window === "undefined") {
    return null;
  }
  const candidate = (
    window as Window & {
      showSaveFilePicker?: DiagnosticSaveFilePicker;
    }
  ).showSaveFilePicker;
  return candidate?.bind(window) ?? null;
}
