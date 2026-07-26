import { applyDeckPatch, createDemoDeck } from "@orbit/editor-core";
import type { SemanticCue } from "@orbit/shared/deck";
import {
  isValidElement,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode
} from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SemanticCueReviewPanel } from "./SemanticCueReviewPanel";
import { SemanticCueReviewCard } from "./SemanticCueReviewCard";
import {
  applySemanticCueReviewChoice,
  buildSemanticCueReviewModel,
  createSemanticCueReviewPatch,
  editSemanticCueMeaning,
  nextSemanticCueReviewChoice
} from "./semanticCueReviewModel";

describe("SemanticCueReviewPanel", () => {
  it("renders suggested, stale, visual-only, evidence, and timing states", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0];
    slide.estimatedSeconds = 8;
    slide.elements.push({
      elementId: "el_visual_evidence",
      type: "image",
      role: "media",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      locked: false,
      visible: true,
      props: {
        src: "asset:image",
        alt: "고객 여정 분석",
        fit: "contain",
        focusX: 0.5,
        focusY: 0.5
      }
    });
    slide.semanticCues = [
      cue("scue_visual", {
        importance: "core",
        freshness: "stale",
        revision: 2,
        sourceRefs: [
          {
            kind: "image-analysis",
            refId: "el_visual_evidence",
            sourceHash: "a".repeat(64)
          }
        ],
        qualityWarnings: ["image-source-unverified"]
      }),
      cue("scue_title", {
        importance: "core",
        sourceRefs: [
          {
            kind: "slide-title",
            refId: slide.slideId,
            sourceHash: "b".repeat(64)
          }
        ]
      })
    ];

    const html = renderToString(
      <SemanticCueReviewPanel slide={slide} onChange={vi.fn()} />
    );

    expect(html).toContain("발표 메시지 검토");
    expect(html).toContain("검토 필요");
    expect(html).toContain("슬라이드 변경 후 재검토 필요");
    expect(html).toContain("재생성 변경 · revision");
    expect(html).toContain("이미지 분석만을 근거로 생성됨");
    expect(html).toContain("고객 여정 분석");
    expect(html).toContain("이미지 분석 근거가 확인되지 않았습니다.");
    expect(html).toContain("시간 점검");
    expect(html).toContain('aria-label="발표 메시지 후보"');
    expect(html).toContain('tabindex="0"');
  });

  it("emits reviewed cues for choice, keyboard, wording, and manual interactions", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0];
    slide.semanticCues = [cue("scue_interaction")];
    const onChange = vi.fn();
    const tree = SemanticCueReviewPanel({
      createCueId: () => "scue_manual_test",
      onChange,
      slide
    });
    const elements = flattenElements(tree);
    const card = elements.find(
      (element) => element.type === SemanticCueReviewCard
    );
    expect(card).toBeDefined();
    (card?.props.onReviewChoice as
      | ((choice: "core") => void)
      | undefined)?.("core");
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        cueId: "scue_interaction",
        importance: "core",
        reviewStatus: "approved",
        required: true,
        priority: 1
      })
    ]);

    const keyboardChoice = vi.fn();
    const cardElements = flattenElements(
      SemanticCueReviewCard({
        index: 0,
        item: buildSemanticCueReviewModel(slide).cues[0],
        onEditMeaning: vi.fn(),
        onReviewChoice: keyboardChoice
      })
    );
    const choiceGroup = cardElements.find(
      (element) => element.type === "fieldset"
    );
    const preventDefault = vi.fn();
    const focus = vi.fn();
    (choiceGroup?.props.onKeyDown as
      | ((event: KeyboardEvent<HTMLFieldSetElement>) => void)
      | undefined)?.(
      {
        currentTarget: {
          querySelector: () => ({ focus })
        },
        key: "ArrowRight",
        preventDefault
      } as unknown as KeyboardEvent<HTMLFieldSetElement>
    );
    expect(preventDefault).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(keyboardChoice).toHaveBeenCalledWith("core");

    const editMeaning = vi.fn();
    const editForm = flattenElements(
      SemanticCueReviewCard({
        index: 0,
        item: buildSemanticCueReviewModel(slide).cues[0],
        onEditMeaning: editMeaning,
        onReviewChoice: vi.fn()
      })
    ).find(
      (element) =>
        element.type === "form" &&
        element.props.className === "semantic-cue-edit-form"
    );
    (editForm?.props.onSubmit as
      | ((event: FormEvent<HTMLFormElement>) => void)
      | undefined)?.(
      formEvent({ meaning: "발표자가 수정한 핵심 메시지" })
    );
    expect(editMeaning).toHaveBeenCalledWith("발표자가 수정한 핵심 메시지");
    (card?.props.onEditMeaning as
      | ((meaning: string) => void)
      | undefined)?.("발표자가 수정한 핵심 메시지");
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        meaning: "발표자가 수정한 핵심 메시지",
        origin: "manual",
        reviewStatus: "approved",
        revision: 2
      })
    ]);

    const manualForm = elements.find(
      (element) =>
        element.type === "form" &&
        element.props.className === "semantic-cue-manual-form"
    );
    (manualForm?.props.onSubmit as
      | ((event: FormEvent<HTMLFormElement>) => void)
      | undefined)?.(
      formEvent({ manualMeaning: "직접 추가한 발표 메시지" })
    );
    expect(onChange).toHaveBeenLastCalledWith([
      slide.semanticCues[0],
      expect.objectContaining({
        cueId: "scue_manual_test",
        meaning: "직접 추가한 발표 메시지",
        origin: "manual",
        reviewStatus: "approved"
      })
    ]);
  });

  it("renders a meaningful empty state and labeled manual form", () => {
    const slide = createDemoDeck().slides[0];
    slide.semanticCues = [];

    const html = renderToString(
      <SemanticCueReviewPanel slide={slide} onChange={vi.fn()} />
    );

    expect(html).toContain("아직 제안된 발표 메시지가 없습니다.");
    expect(html).toContain('for="semantic-cue-manual-meaning"');
    expect(html).toContain("직접 메시지 추가");
  });

  it("AI 추출 버튼으로 비어 있는 덱과 기존 덱을 구분해 요청한다", () => {
    const emptySlide = createDemoDeck().slides[0];
    emptySlide.semanticCues = [];
    const onExtract = vi.fn();
    const emptyTree = SemanticCueReviewPanel({
      extractionState: { status: "idle", message: "" },
      onChange: vi.fn(),
      onExtract,
      slide: emptySlide
    });
    const emptyButton = flattenElements(emptyTree).find(
      (element) => element.props.className === "semantic-cue-extract-button"
    );
    expect(emptyButton?.props.children).toBe("AI로 발표 메시지 만들기");
    (emptyButton?.props.onClick as (() => void) | undefined)?.();
    expect(onExtract).toHaveBeenLastCalledWith(false);

    const populatedSlide = createDemoDeck().slides[0];
    populatedSlide.semanticCues = [cue("scue_existing")];
    const populatedTree = SemanticCueReviewPanel({
      extractionState: { status: "idle", message: "" },
      onChange: vi.fn(),
      onExtract,
      slide: populatedSlide
    });
    const populatedButton = flattenElements(populatedTree).find(
      (element) => element.props.className === "semantic-cue-extract-button"
    );
    expect(populatedButton?.props.children).toBe("AI로 전체 덱 다시 분석");
    (populatedButton?.props.onClick as (() => void) | undefined)?.();
    expect(onExtract).toHaveBeenLastCalledWith(true);
  });

  it("AI 추출 중에는 중복 실행을 막고 진행 상태를 알린다", () => {
    const slide = createDemoDeck().slides[0];
    const html = renderToString(
      <SemanticCueReviewPanel
        extractionState={{ status: "running", message: "의미 분석 중..." }}
        onChange={vi.fn()}
        onExtract={vi.fn()}
        slide={slide}
      />
    );

    expect(html).toContain("의미 분석 중...");
    expect(html).toContain("disabled");
  });

  it("remounts the wording input when undo restores another cue revision", () => {
    const slide = createDemoDeck().slides[0];
    slide.semanticCues = [cue("scue_undo")];
    const before = flattenElements(
      SemanticCueReviewCard({
        index: 0,
        item: buildSemanticCueReviewModel(slide).cues[0],
        onEditMeaning: vi.fn(),
        onReviewChoice: vi.fn()
      })
    ).find(
      (element) =>
        element.type === "input" && element.props.name === "meaning"
    );

    slide.semanticCues = [
      editSemanticCueMeaning(slide.semanticCues[0], "수정한 발표 메시지")
    ];
    const after = flattenElements(
      SemanticCueReviewCard({
        index: 0,
        item: buildSemanticCueReviewModel(slide).cues[0],
        onEditMeaning: vi.fn(),
        onReviewChoice: vi.fn()
      })
    ).find(
      (element) =>
        element.type === "input" && element.props.name === "meaning"
    );

    expect(before?.key).not.toBe(after?.key);
    expect(after?.props.defaultValue).toBe("수정한 발표 메시지");
  });

  it("supports imported deck preparation through patch round-trip", () => {
    const deck = createDemoDeck();
    deck.metadata.sourceType = "import";
    const slide = deck.slides[0];
    const suggested = cue("scue_imported");
    slide.semanticCues = [suggested];
    const approved = applySemanticCueReviewChoice(suggested, "core");

    const applied = applyDeckPatch(
      deck,
      createSemanticCueReviewPatch(deck, slide.slideId, [approved])
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.deck.slides[0].semanticCues[0]).toMatchObject({
      cueId: suggested.cueId,
      reviewStatus: "approved",
      importance: "core"
    });

    const restored = applyDeckPatch(
      applied.deck,
      createSemanticCueReviewPatch(applied.deck, slide.slideId, [suggested])
    );
    expect(restored.ok).toBe(true);
    if (restored.ok) {
      expect(restored.deck.slides[0].semanticCues[0].reviewStatus).toBe(
        "suggested"
      );
    }
  });
});

describe("semanticCueReviewModel", () => {
  it("keeps compatibility fields aligned with review choices", () => {
    const suggested = cue("scue_choice");

    expect(applySemanticCueReviewChoice(suggested, "core")).toMatchObject({
      importance: "core",
      reviewStatus: "approved",
      required: true,
      priority: 1
    });
    expect(applySemanticCueReviewChoice(suggested, "supporting")).toMatchObject({
      importance: "supporting",
      reviewStatus: "approved",
      required: false,
      priority: 2
    });
    expect(applySemanticCueReviewChoice(suggested, "excluded")).toMatchObject({
      importance: "optional",
      reviewStatus: "excluded",
      required: false,
      priority: 3
    });
  });

  it("increments revision and marks user-edited wording as manual", () => {
    expect(editSemanticCueMeaning(cue("scue_edit"), "새 발표 의도")).toMatchObject({
      meaning: "새 발표 의도",
      origin: "manual",
      reviewStatus: "approved",
      revision: 2,
      nliHypotheses: ["발표자는 새 발표 의도"]
    });
  });

  it("cycles review choices with arrow keys", () => {
    expect(nextSemanticCueReviewChoice(null, "ArrowRight")).toBe("core");
    expect(nextSemanticCueReviewChoice("core", "ArrowLeft")).toBe("excluded");
    expect(nextSemanticCueReviewChoice("excluded", "ArrowRight")).toBe("core");
  });

  it("shows stale and regeneration diff without approving suggestions", () => {
    const slide = createDemoDeck().slides[0];
    slide.semanticCues = [
      cue("scue_diff", {
        freshness: "stale",
        revision: 3,
        reviewStatus: "suggested"
      })
    ];

    const model = buildSemanticCueReviewModel(slide);

    expect(model.suggestedCount).toBe(1);
    expect(model.approvedCount).toBe(0);
    expect(model.cues[0]).toMatchObject({
      isRegenerated: true,
      isStale: true,
      reviewChoice: null,
      reviewLabel: "검토 필요"
    });
  });
});

function cue(
  cueId: string,
  overrides: Partial<SemanticCue> = {}
): SemanticCue {
  return {
    cueId,
    slideId: "slide_1",
    meaning: "고객 문제의 원인을 설명한다",
    reportLabel: "고객 문제 원인",
    presenterTag: "문제 원인",
    cueType: "problem",
    importance: "supporting",
    reviewStatus: "suggested",
    freshness: "current",
    origin: "ai",
    revision: 1,
    sourceRefs: [],
    qualityWarnings: [],
    required: false,
    priority: 2,
    candidateKeywords: ["고객 문제"],
    aliases: {},
    requiredConcepts: ["고객 문제"],
    nliHypotheses: ["발표자는 고객 문제의 원인을 설명했다"],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: [],
    ...overrides
  };
}

function flattenElements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) {
    return node.flatMap(flattenElements);
  }
  if (!isValidElement<Record<string, unknown>>(node)) {
    return [];
  }
  return [node, ...flattenElements(node.props.children as ReactNode)];
}

function formEvent(values: Record<string, string>): FormEvent<HTMLFormElement> {
  return {
    preventDefault: vi.fn(),
    currentTarget: {
      elements: {
        namedItem: (name: string) => ({ value: values[name] ?? "" })
      },
      reset: vi.fn()
    }
  } as unknown as FormEvent<HTMLFormElement>;
}
