import { applyDeckPatch } from "@orbit/editor-core/patches";
import type { Deck, DesignAgentProposal } from "@orbit/shared/deck";

export type DesignProposalPreview = {
  baseDeck: Deck;
  candidateDeck: Deck;
  proposal: DesignAgentProposal;
};

export function buildDesignProposalPreview(
  baseDeck: Deck,
  proposal: DesignAgentProposal
): DesignProposalPreview {
  const previewResult = applyDeckPatch(baseDeck, {
    deckId: proposal.deckId,
    baseVersion: proposal.baseVersion,
    source: "ai",
    operations: proposal.operations
  });
  if (!previewResult.ok) {
    const detail = previewResult.error.details?.[0];
    throw new Error(
      `AI 제안의 미리보기를 만들지 못했습니다: ${
        detail ?? previewResult.error.message
      }`,
    );
  }

  return {
    baseDeck,
    candidateDeck: previewResult.deck,
    proposal
  };
}

export function isDesignProposalStale(
  currentDeck: Deck,
  proposal: DesignAgentProposal
) {
  return currentDeck.version !== proposal.baseVersion;
}
