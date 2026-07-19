import type { Deck, DeckPatch } from "@orbit/shared";
import {
  createDemoDeck,
  createElementId
} from "../../../../../../../packages/editor-core/src/index";
import { describe, expect, it, vi } from "vitest";

import {
  canAcceptCanvasImageDrop,
  createRehydratedPptxImportState,
  getCanvasDropPlacement,
  getDroppedFiles,
  getImageBatchStatusMessage,
  getImageInsertCapability,
  getPlacedImageInsertFrame,
  performImageFileInsert,
  selectFirstEditorImageFile
} from "./useEditorFileTransfer";

vi.mock("../utils/slideRenderUtils", () => ({
  createSlideScopedUploadFile: (file: File) => file
}));

describe("useEditorFileTransfer image insert action", () => {
  it("rehydrates a persisted PPTX quality report after reload", () => {
    const qualityReport = {
      compositeScore: 82,
      metrics: {
        geometry: 90,
        text: 80,
        color: 80,
        layer: 90,
        editability: 60,
        pixelSimilarity: null
      },
      weights: {
        geometry: 25 as const,
        text: 15 as const,
        color: 10 as const,
        layer: 10 as const,
        editability: 10 as const,
        pixelSimilarity: 30 as const
      },
      editabilityCoverage: 0.6,
      appliedCap: null,
      slideReports: [],
      notes: ["pixel renderer unavailable"]
    };

    expect(
      createRehydratedPptxImportState({ qualityReport })
    ).toMatchObject({
      status: "succeeded",
      message: "저장된 PPTX 가져오기 품질",
      qualityReport
    });
    expect(createRehydratedPptxImportState(null).status).toBe("idle");
  });

  it("selects only the first fully valid image and reports every other file", () => {
    const invalid = mockFile("notes.txt", "text/plain", 12);
    const emptyPng = mockFile("empty.png", "image/png", 0);
    const png = mockFile("first.png", "image/png", 12);
    const webp = mockFile("second.webp", "image/webp", 12);

    expect(selectFirstEditorImageFile([invalid, emptyPng, png, webp])).toEqual({
      errorMessage: "",
      file: png,
      ignoredCount: 3
    });
    expect(getImageBatchStatusMessage(3)).toBe(
      "이미지 1개를 추가했습니다. 나머지 3개 파일은 건너뛰었습니다."
    );
  });

  it("uses the shared validation message when a batch has no valid image", () => {
    const selection = selectFirstEditorImageFile([
      mockFile("remote.html", "text/html", 20),
      mockFile("empty.png", "image/png", 0)
    ]);

    expect(selection.file).toBeNull();
    expect(selection.errorMessage).toBe(
      "JPG, PNG, WebP 이미지 파일만 업로드할 수 있습니다."
    );
  });

  it("keeps the natural ratio around the pointer and clamps the frame", () => {
    const canvas = createDemoDeck().canvas;
    const topLeft = getPlacedImageInsertFrame(
      canvas,
      { height: 600, width: 1200 },
      { centerX: 10, centerY: 10 }
    );
    const bottomRight = getPlacedImageInsertFrame(
      canvas,
      { height: 600, width: 1200 },
      { centerX: canvas.width, centerY: canvas.height }
    );

    expect(topLeft).toEqual({ height: 260, width: 520, x: 0, y: 0 });
    expect(bottomRight).toEqual({
      height: 260,
      width: 520,
      x: canvas.width - 520,
      y: canvas.height - 260
    });
    expect(topLeft.width / topLeft.height).toBe(2);
  });

  it("reads local Files without touching URL, HTML, or text payloads", () => {
    const getData = vi.fn(() => "https://example.com/remote.png");
    const dataTransfer: Pick<DataTransfer, "files" | "getData"> = {
      files: [] as unknown as FileList,
      getData
    };

    expect(getDroppedFiles(dataTransfer)).toEqual([]);
    expect(getData).not.toHaveBeenCalled();
    expect(
      getCanvasDropPlacement({
        clientX: 260,
        clientY: 170,
        rect: { left: 60, top: 70 },
        stageScale: 0.5
      })
    ).toEqual({ centerX: 400, centerY: 200 });
  });

  it.each([
    { canMutateDeck: false },
    { hasBlockingDialog: true },
    { hasCurrentSlide: false },
    { inlineTextEditing: true },
    { insertCapabilityEnabled: false },
    { isUploadPending: true },
    { speakerNotesEditing: true }
  ])("suppresses drop for blocked editor state %#", (override) => {
    expect(
      canAcceptCanvasImageDrop({
        canMutateDeck: true,
        hasBlockingDialog: false,
        hasCurrentSlide: true,
        inlineTextEditing: false,
        insertCapabilityEnabled: true,
        isUploadPending: false,
        speakerNotesEditing: false,
        ...override
      })
    ).toBe(false);
  });

  it("allows imported Deck insertion on imported and authored OOXML slides", () => {
    const deck = createDemoDeck();
    deck.metadata.sourceType = "import";

    expect(getImageInsertCapability(deck, deck.slides[0]!.slideId)).toEqual({
      enabled: false,
      reason:
        "원본 PPTX 위치를 확인할 수 없는 슬라이드에는 이미지를 추가할 수 없습니다."
    });

    deck.slides[0]!.ooxmlOrigin = "imported";
    expect(getImageInsertCapability(deck, deck.slides[0]!.slideId)).toEqual({
      enabled: true,
      reason: null
    });

    deck.slides[0]!.ooxmlOrigin = "authored";
    expect(getImageInsertCapability(deck, deck.slides[0]!.slideId)).toEqual({
      enabled: true,
      reason: null
    });
  });

  it("marks an image inserted into an imported Deck as authored", async () => {
    const deck = createDemoDeck();
    deck.metadata.sourceType = "import";
    deck.slides[0]!.ooxmlOrigin = "imported";
    const slideId = deck.slides[0]!.slideId;
    let committedPatch: DeckPatch | null = null;

    await performImageFileInsert({
      activeDeck: deck,
      commitPatch: (patch) => {
        committedPatch = typeof patch === "function" ? patch(deck) : patch;
        return true;
      },
      file: mockFile("photo.png", "image/png", 32),
      readNaturalSize: async () => ({ height: 100, width: 100 }),
      resolveUploadProject: async () => "project_upload",
      target: { slideId, type: "insert" },
      upload: async () => ({ url: "/assets/photo.png" })
    });

    const operation = (committedPatch as DeckPatch | null)?.operations[0];
    expect(operation?.type).toBe("add_element");
    if (operation?.type !== "add_element") throw new Error("add patch expected");
    expect(operation.element.ooxmlOrigin).toBe("authored");
  });

  it("uploads before creating one image patch at the clamped pointer", async () => {
    const deck = createDemoDeck();
    const slideId = deck.slides[0]!.slideId;
    const file = mockFile("photo.png", "image/png", 32);
    const events: string[] = [];
    let committedPatch: DeckPatch | null = null;
    const commitPatch = vi.fn((patch, baseDeck?: Deck) => {
      events.push("commit");
      committedPatch =
        typeof patch === "function" ? patch(baseDeck ?? deck) : patch;
      return true;
    });

    const result = await performImageFileInsert({
      activeDeck: deck,
      commitPatch,
      file,
      placement: { centerX: 20, centerY: 20 },
      readNaturalSize: async () => {
        events.push("natural-size");
        return { height: 400, width: 800 };
      },
      resolveUploadProject: async () => {
        events.push("resolve-project");
        return "project_upload";
      },
      target: { slideId, type: "insert" },
      upload: async () => {
        events.push("upload-complete");
        return {
          url: "/api/v1/projects/project_upload/assets/file_image/content"
        };
      }
    });

    expect(events).toEqual([
      "natural-size",
      "resolve-project",
      "upload-complete",
      "commit"
    ]);
    expect(commitPatch).toHaveBeenCalledTimes(1);
    const operation = (committedPatch as DeckPatch | null)?.operations[0];
    expect(operation?.type).toBe("add_element");
    if (operation?.type !== "add_element") throw new Error("add patch expected");
    expect(operation.element).toMatchObject({
      elementId: result.elementId,
      height: 260,
      type: "image",
      width: 520,
      x: 0,
      y: 0,
      props: {
        alt: "photo.png",
        fit: "contain",
        focusX: 0.5,
        focusY: 0.5,
        src: "/api/v1/projects/project_upload/assets/file_image/content"
      }
    });
  });

  it("allocates the id and z-index from the latest Deck after upload", async () => {
    const activeDeck = createDemoDeck();
    const slideId = activeDeck.slides[0]!.slideId;
    const concurrentDeck = structuredClone(activeDeck);
    concurrentDeck.version += 1;
    const staleCandidateId = createElementId(activeDeck);
    const concurrentElement = structuredClone(
      concurrentDeck.slides[0]!.elements[0]!
    );
    concurrentElement.elementId = staleCandidateId;
    concurrentElement.zIndex = 50;
    concurrentDeck.slides[0]!.elements.push(concurrentElement);
    let committedPatch: DeckPatch | null = null;
    const commitPatch = vi.fn(
      (patch: DeckPatch | ((deck: Deck) => DeckPatch)) => {
        committedPatch =
          typeof patch === "function" ? patch(concurrentDeck) : patch;
        return true;
      }
    );

    const result = await performImageFileInsert({
      activeDeck,
      commitPatch,
      file: mockFile("photo.png", "image/png", 32),
      readNaturalSize: async () => ({ height: 100, width: 100 }),
      resolveUploadProject: async () => "project_upload",
      target: { slideId, type: "insert" },
      upload: async () => ({ url: "/assets/photo.png" })
    });

    const operation = (committedPatch as DeckPatch | null)?.operations[0];
    expect(operation?.type).toBe("add_element");
    if (operation?.type !== "add_element") throw new Error("add patch expected");
    expect(operation.element.elementId).not.toBe(staleCandidateId);
    expect(operation.element.zIndex).toBe(51);
    expect(result.elementId).toBe(operation.element.elementId);
  });

  it("does not create a patch when validation or upload fails", async () => {
    const deck = createDemoDeck();
    const slideId = deck.slides[0]!.slideId;
    const commitPatch = vi.fn(() => true);
    const upload = vi.fn(async () => {
      throw new Error("업로드가 취소되었습니다.");
    });
    const base = {
      activeDeck: deck,
      commitPatch,
      readNaturalSize: vi.fn(async () => ({ height: 100, width: 100 })),
      resolveUploadProject: vi.fn(async () => "project_upload"),
      target: { slideId, type: "insert" as const },
      upload
    };

    await expect(
      performImageFileInsert({
        ...base,
        file: mockFile("notes.txt", "text/plain", 12)
      })
    ).rejects.toThrow("JPG, PNG, WebP 이미지 파일만 업로드할 수 있습니다.");
    expect(upload).not.toHaveBeenCalled();
    expect(commitPatch).not.toHaveBeenCalled();

    await expect(
      performImageFileInsert({
        ...base,
        file: mockFile("photo.webp", "image/webp", 12)
      })
    ).rejects.toThrow("업로드가 취소되었습니다.");
    expect(commitPatch).not.toHaveBeenCalled();
  });
});

function mockFile(name: string, type: string, size: number) {
  return { name, size, type } as File;
}
