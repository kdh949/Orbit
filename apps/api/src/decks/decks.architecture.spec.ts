import { describe, expect, it } from "vitest";
import { DecksService } from "./decks.service";
import { DeckAutomationUseCases } from "./use-cases/deck-automation.use-cases";
import { DeckExportUseCases } from "./use-cases/deck-export.use-cases";
import { DeckHistoryUseCases } from "./use-cases/deck-history.use-cases";
import { DeckPatchUseCases } from "./use-cases/deck-patch.use-cases";
import { DeckPersistenceUseCases } from "./use-cases/deck-persistence.use-cases";
import { DeckPptxUseCases } from "./use-cases/deck-pptx.use-cases";

function publicMethods(target: object): string[] {
  return Object.getOwnPropertyNames(target)
    .filter((name) => name !== "constructor")
    .sort();
}

describe("DecksService architecture", () => {
  it("keeps the injectable service as a constructor-only facade", () => {
    expect(publicMethods(DecksService.prototype)).toEqual([]);
  });

  it("owns public workflows in capability-specific use cases", () => {
    expect(publicMethods(DeckPersistenceUseCases.prototype)).toEqual([
      "createInitialDeckInTransaction",
      "getDeck",
      "getDeckForUpdate",
      "putDeck",
    ]);
    expect(publicMethods(DeckPatchUseCases.prototype)).toEqual(["appendPatch"]);
    expect(publicMethods(DeckHistoryUseCases.prototype)).toEqual([
      "getOrCreateSnapshot",
      "getSnapshot",
      "listSnapshots",
      "restoreSnapshot",
    ]);
    expect(publicMethods(DeckPptxUseCases.prototype)).toEqual([
      "getOoxmlSyncState",
      "getPptxImportQuality",
      "getPptxNotesPreview",
      "retryOoxmlSync",
    ]);
    expect(publicMethods(DeckExportUseCases.prototype)).toEqual([
      "createExportJob",
    ]);
    expect(publicMethods(DeckAutomationUseCases.prototype)).toEqual([
      "createSemanticCueExtractionJob",
      "createSpeakerNotesSuggestionJob",
    ]);
  });
});
