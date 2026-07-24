import {
  presentationCompanionMaxPrompterBytes,
  presentationCompanionMaxPrompterRowLength,
  presentationCompanionMaxPrompterRows,
  type PresentationCompanionPrompterRow,
  type PresentationCompanionPrompterState,
} from "@orbit/shared";

export type CompanionPrompterProjection = Omit<
  PresentationCompanionPrompterState,
  "authorityEpochId" | "prompterRevision" | "sessionId"
>;

export type CompanionPrompterSourceRow = {
  isFocusTarget: boolean;
  sentenceId: string;
  status: PresentationCompanionPrompterRow["status"];
  text: string;
};

const prompterEnvelopeHeadroomBytes = 1_024;

export function createCompanionPrompterProjection(input: {
  progressPercent: number;
  rows: readonly CompanionPrompterSourceRow[];
  slideId: string;
  slideIndex: number;
  trackingStatus: CompanionPrompterProjection["trackingStatus"];
}): CompanionPrompterProjection {
  const rows = input.rows.flatMap((row) => {
    const text = row.text.trim();
    return text.length > 0
      ? [{ sentenceId: row.sentenceId, status: row.status, text }]
      : [];
  });
  const base = {
    slideId: input.slideId,
    slideIndex: input.slideIndex,
    trackingStatus: input.trackingStatus,
    progressPercent: clampPercent(input.progressPercent),
  };
  if (rows.length === 0) {
    return {
      ...base,
      availability: "empty",
      focusSentenceId: null,
      rows: [],
    };
  }
  if (
    rows.length > presentationCompanionMaxPrompterRows ||
    rows.some(
      (row) =>
        row.text.length > presentationCompanionMaxPrompterRowLength,
    ) ||
    new TextEncoder().encode(JSON.stringify({ ...base, rows }))
      .byteLength >
      presentationCompanionMaxPrompterBytes -
        prompterEnvelopeHeadroomBytes
  ) {
    return {
      ...base,
      availability: "too-large",
      focusSentenceId: null,
      rows: [],
    };
  }
  const sourceFocusSentenceId =
    input.rows.find((row) => row.isFocusTarget)?.sentenceId ?? null;
  const focusSentenceId = rows.some(
    (row) => row.sentenceId === sourceFocusSentenceId,
  )
    ? sourceFocusSentenceId
    : null;
  return {
    ...base,
    availability: "ready",
    focusSentenceId,
    rows,
  };
}

export function getCompanionPrompterTrackingStatus(
  status: string,
): CompanionPrompterProjection["trackingStatus"] {
  if (status === "starting" || status === "listening") {
    return "listening";
  }
  if (status === "paused") return "paused";
  if (status === "error") return "error";
  return "waiting";
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)));
}
