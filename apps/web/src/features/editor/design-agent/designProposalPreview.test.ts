import { createDemoDeck } from "@orbit/editor-core";
import type { DesignAgentProposal } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";
import {
  buildDesignProposalPreview,
  isDesignProposalStale,
} from "./designProposalPreview";

describe("design proposal preview", () => {
  it("builds a candidate without mutating the request-time base deck", () => {
    const baseDeck = createDemoDeck();
    const beforeJson = JSON.stringify(baseDeck);
    const proposal = proposalFor(baseDeck);

    const preview = buildDesignProposalPreview(baseDeck, proposal);

    expect(JSON.stringify(baseDeck)).toBe(beforeJson);
    expect(preview.baseDeck).toBe(baseDeck);
    expect(preview.candidateDeck).not.toBe(baseDeck);
    expect(preview.candidateDeck.version).toBe(baseDeck.version + 1);
    expect(preview.candidateDeck.slides[0]?.style.backgroundColor).toBe("#111827");
  });

  it("marks the proposal stale only when the current deck version diverges", () => {
    const baseDeck = createDemoDeck();
    const proposal = proposalFor(baseDeck);

    expect(isDesignProposalStale(baseDeck, proposal)).toBe(false);
    expect(isDesignProposalStale({ ...baseDeck, version: baseDeck.version + 1 }, proposal)).toBe(true);
  });
});

function proposalFor(deck: ReturnType<typeof createDemoDeck>): DesignAgentProposal {
  const createdAt = "2026-07-21T00:00:00.000Z";
  const slideId = deck.slides[0]!.slideId;
  return {
    proposalId: "design_proposal_preview",
    projectId: deck.projectId,
    deckId: deck.deckId,
    slideId,
    requestMessageId: "design_message_request",
    responseMessageId: "design_message_response",
    baseVersion: deck.version,
    title: "배경 개선",
    operations: [{
      type: "update_slide_style",
      slideId,
      style: { backgroundColor: "#111827" },
    }],
    affectedElementIds: [],
    warnings: [],
    status: "pending",
    createdAt,
    updatedAt: createdAt,
  };
}
