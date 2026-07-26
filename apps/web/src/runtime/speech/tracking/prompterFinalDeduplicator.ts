import type { LiveSttResult } from "../stt/liveSttPort";
import { normalizeSpeechText } from "./phraseExtractor";

const DEFAULT_DEDUPE_WINDOW_MS = 2_000;

export type PrompterFinalDedupeScope = {
  slideId: string;
  revision: number;
  currentSentenceId: string | null;
};

type ScopedFallbackFingerprint = {
  scopeKey: string;
  seenAtMs: number;
};

export type PrompterFinalDeduplicator = {
  acceptFinal: (result: LiveSttResult, scope: PrompterFinalDedupeScope) => boolean;
  markCommitted: (result: LiveSttResult, scope: PrompterFinalDedupeScope) => void;
  reset: () => void;
};

export function createPrompterFinalDeduplicator(options: {
  now: () => number;
  dedupeWindowMs?: number;
}): PrompterFinalDeduplicator {
  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const fingerprintSalt = createFingerprintSalt();
  const processedRevisionsByUtterance = new Map<string, Set<number>>();
  const committedUtteranceIds = new Set<string>();
  const committedFallbackFingerprints = new Map<string, ScopedFallbackFingerprint>();
  const recentFallbackFingerprints = new Map<string, ScopedFallbackFingerprint>();

  function acceptFinal(result: LiveSttResult, scope: PrompterFinalDedupeScope) {
    const identity = readResultIdentity(result);
    if (identity) {
      if (committedUtteranceIds.has(identity.utteranceId)) {
        return false;
      }

      const revisions = processedRevisionsByUtterance.get(identity.utteranceId) ?? new Set();
      if (revisions.has(identity.resultRevision)) {
        return false;
      }

      revisions.add(identity.resultRevision);
      processedRevisionsByUtterance.set(identity.utteranceId, revisions);
      return true;
    }

    const nowMs = options.now();
    pruneFallbackFingerprints(nowMs);
    const fingerprint = createSaltedTranscriptFingerprint(result.text, fingerprintSalt);
    const scopeKey = createScopeKey(scope);
    const committedFingerprint = committedFallbackFingerprints.get(fingerprint);
    if (committedFingerprint?.scopeKey === scopeKey) {
      return false;
    }
    const recentFingerprint = recentFallbackFingerprints.get(fingerprint);
    if (recentFingerprint?.scopeKey === scopeKey) {
      return false;
    }

    recentFallbackFingerprints.set(fingerprint, { scopeKey, seenAtMs: nowMs });
    return true;
  }

  function markCommitted(result: LiveSttResult, scope: PrompterFinalDedupeScope) {
    const identity = readResultIdentity(result);
    if (identity) {
      committedUtteranceIds.add(identity.utteranceId);
      return;
    }

    const nowMs = options.now();
    pruneFallbackFingerprints(nowMs);
    committedFallbackFingerprints.set(
      createSaltedTranscriptFingerprint(result.text, fingerprintSalt),
      {
        scopeKey: createScopeKey(scope),
        seenAtMs: nowMs
      }
    );
  }

  function reset() {
    processedRevisionsByUtterance.clear();
    committedUtteranceIds.clear();
    committedFallbackFingerprints.clear();
    recentFallbackFingerprints.clear();
  }

  function pruneFallbackFingerprints(nowMs: number) {
    for (const [fingerprint, record] of recentFallbackFingerprints) {
      const ageMs = nowMs - record.seenAtMs;
      if (ageMs < 0 || ageMs > dedupeWindowMs) {
        recentFallbackFingerprints.delete(fingerprint);
      }
    }
    for (const [fingerprint, record] of committedFallbackFingerprints) {
      const ageMs = nowMs - record.seenAtMs;
      if (ageMs < 0 || ageMs > dedupeWindowMs) {
        committedFallbackFingerprints.delete(fingerprint);
      }
    }
  }

  return { acceptFinal, markCommitted, reset };
}

function createScopeKey(scope: PrompterFinalDedupeScope) {
  return JSON.stringify([scope.slideId, scope.revision, scope.currentSentenceId]);
}

function readResultIdentity(result: LiveSttResult): {
  utteranceId: string;
  resultRevision: number;
} | null {
  const utteranceId = result.utteranceId?.trim();
  if (
    !utteranceId ||
    !Number.isSafeInteger(result.resultRevision) ||
    (result.resultRevision ?? -1) < 0
  ) {
    return null;
  }

  return {
    utteranceId,
    resultRevision: result.resultRevision as number
  };
}

function createFingerprintSalt() {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
    return values[0] ?? 0;
  }

  return Math.floor(Math.random() * 0x1_0000_0000);
}

function createSaltedTranscriptFingerprint(transcript: string, salt: number) {
  const normalizedTranscript = normalizeSpeechText(transcript);
  const hashes = [
    (0x811c9dc5 ^ salt) >>> 0,
    (0x9e3779b9 ^ rotateLeft(salt, 7)) >>> 0,
    (0x85ebca6b ^ rotateLeft(salt, 13)) >>> 0,
    (0xc2b2ae35 ^ rotateLeft(salt, 19)) >>> 0
  ];

  for (let index = 0; index < normalizedTranscript.length; index += 1) {
    const code = normalizedTranscript.charCodeAt(index);
    hashes[0] = Math.imul((hashes[0] ?? 0) ^ code, 0x01000193) >>> 0;
    hashes[1] = Math.imul((hashes[1] ?? 0) ^ code, 0x27d4eb2d) >>> 0;
    hashes[2] = Math.imul((hashes[2] ?? 0) ^ code, 0x165667b1) >>> 0;
    hashes[3] = Math.imul((hashes[3] ?? 0) ^ code, 0x9e3779b1) >>> 0;
  }

  return hashes.map((hash) => hash.toString(16).padStart(8, "0")).join("");
}

function rotateLeft(value: number, bits: number) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}
