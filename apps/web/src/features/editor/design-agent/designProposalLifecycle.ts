import type { Deck } from "@orbit/shared/deck";
import type { DesignProposalPreview } from "./designProposalPreview";
import { isDesignProposalStale } from "./designProposalPreview";

export const designProposalLifecycles = [
  "idle",
  "generating",
  "proposal-ready",
  "stale",
  "applying",
  "applied",
  "failed",
] as const;

export type DesignProposalLifecycle =
  (typeof designProposalLifecycles)[number];

export function resolveDesignProposalLifecycle(
  lifecycle: DesignProposalLifecycle,
  currentDeck: Deck,
  preview: DesignProposalPreview | null,
): DesignProposalLifecycle {
  if (preview && isDesignProposalStale(currentDeck, preview.proposal)) {
    return "stale";
  }
  return lifecycle;
}

export function canApplyDesignProposal(lifecycle: DesignProposalLifecycle) {
  return lifecycle === "proposal-ready" || lifecycle === "failed";
}
