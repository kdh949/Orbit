import type { LiveSttResult } from "../../stt/liveSttPort";

export type SemanticEvidence = {
  transcript: string;
  startMs: number;
  endMs: number;
};

export function createSemanticEvidenceWindow(options: {
  windowMs?: number;
  maxCharacters?: number;
} = {}) {
  const windowMs = options.windowMs ?? 8_000;
  const maxCharacters = options.maxCharacters ?? 600;
  const segmentsBySlideId = new Map<string, LiveSttResult[]>();

  function accept(slideId: string, result: LiveSttResult): SemanticEvidence {
    const current = segmentsBySlideId.get(slideId) ?? [];
    const cutoffMs = Math.max(result.timestampMs[1] - windowMs, 0);
    const segments = [...current, result].filter(
      (segment) => segment.isFinal && segment.timestampMs[1] >= cutoffMs
    );
    segmentsBySlideId.set(slideId, segments);

    const transcript = normalizeText(segments.map((segment) => segment.text).join(" "));
    return {
      transcript: transcript.slice(-maxCharacters),
      startMs: segments[0]?.timestampMs[0] ?? result.timestampMs[0],
      endMs: segments.at(-1)?.timestampMs[1] ?? result.timestampMs[1]
    };
  }

  function clear(slideId?: string) {
    if (slideId === undefined) {
      segmentsBySlideId.clear();
      return;
    }
    segmentsBySlideId.delete(slideId);
  }

  return { accept, clear };
}

function normalizeText(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}
