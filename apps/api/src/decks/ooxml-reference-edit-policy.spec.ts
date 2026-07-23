import { describe, expect, it } from "vitest";
import { deckSchema, templateBlueprintSchema } from "@orbit/shared";

import {
  findReferencePatchViolation,
  findReferenceReplacementViolation,
} from "./ooxml-reference-edit-policy";

const sha256 = "a".repeat(64);
const deck = deckSchema.parse({
  deckId: "deck_reference_1",
  projectId: "project_1",
  title: "Reference",
  version: 1,
  metadata: {
    sourceType: "import",
    ooxmlReferenceTemplateSnapshot: {
      catalogTemplateId: "operating-review",
      catalogTemplateVersion: 1,
      sourceSha256: sha256,
      generationId: "job_1",
    },
  },
  canvas: { preset: "wide-16-9", width: 1920, height: 1080, aspectRatio: "16:9" },
  slides: [{
    slideId: "slide_1",
    order: 1,
    title: "Slide",
    elements: [
      {
        elementId: "el_text",
        type: "text",
        x: 10,
        y: 20,
        width: 400,
        height: 100,
        zIndex: 1,
        locked: false,
        props: { text: "before", fontSize: 24 },
      },
      {
        elementId: "el_decoration",
        type: "rect",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 0,
        locked: true,
        props: { fill: "#FFFFFF" },
      },
      {
        elementId: "el_image",
        type: "image",
        x: 20,
        y: 120,
        width: 320,
        height: 180,
        zIndex: 2,
        locked: false,
        props: { src: "/before.png", alt: "before" },
      },
      {
        elementId: "el_table",
        type: "table",
        x: 20,
        y: 320,
        width: 500,
        height: 200,
        zIndex: 3,
        locked: false,
        props: { rows: [[{ text: "before" }]] },
      },
      {
        elementId: "el_chart",
        type: "chart",
        x: 560,
        y: 320,
        width: 500,
        height: 300,
        zIndex: 4,
        locked: false,
        props: { type: "bar", title: "Chart", data: [{ label: "A", value: 1 }] },
      },
    ],
  }],
});
const blueprint = templateBlueprintSchema.parse({
  templateId: "template_reference_1",
  sourceFileId: "file_source",
  sourcePackageFileId: "file_source",
  currentPackageFileId: "file_current",
  referenceTemplateSnapshot: {
    catalogTemplateId: "operating-review",
    catalogTemplateVersion: 1,
    sourceSha256: sha256,
    sourceSlideIds: ["cover-01"],
    slotAssignmentCount: 4,
  },
  slotEditPolicies: [{
    slotId: "slot_title",
    elementId: "el_text",
    mutationPolicy: ["text-content"],
    frameLocked: true,
  }, {
    slotId: "slot_image",
    elementId: "el_image",
    mutationPolicy: ["image-source"],
    frameLocked: true,
    imageCapacity: {
      minAspectRatio: 1,
      maxAspectRatio: 2,
      cropPolicy: "preserve-frame",
      alphaRequired: false,
      maskRequired: false,
    },
  }, {
    slotId: "slot_table", elementId: "el_table", mutationPolicy: ["table-cell-text"], frameLocked: true,
  }, {
    slotId: "slot_chart", elementId: "el_chart", mutationPolicy: ["chart-data"], frameLocked: true,
  }],
  slides: [{
    slideId: "slide_1",
    slideIndex: 1,
    sourceSlideIndex: 1,
    elementSources: [{
      elementId: "el_text",
      elementType: "text",
      slidePart: "ppt/slides/slide1.xml",
      shapeId: "2",
      sourceType: "shape",
      writable: true,
    }, {
      elementId: "el_image", elementType: "image", slidePart: "ppt/slides/slide1.xml", shapeId: "3", sourceType: "image", writable: true,
    }, {
      elementId: "el_table", elementType: "table", slidePart: "ppt/slides/slide1.xml", shapeId: "4", sourceType: "table", writable: true,
    }, {
      elementId: "el_chart", elementType: "chart", slidePart: "ppt/slides/slide1.xml", shapeId: "5", sourceType: "chart", writable: true,
    }],
  }],
});

describe("OOXML reference edit policy", () => {
  it("allows content-only updates for an allowlisted slot", () => {
    expect(findReferencePatchViolation(deck, blueprint, [{
      type: "update_element_props",
      slideId: "slide_1",
      elementId: "el_text",
      props: { text: "after" },
    }])).toBeNull();
  });

  it("allows image source, table cell text, and chart data without style or frame changes", () => {
    const table = deck.slides[0]!.elements.find(
      (element) => element.type === "table",
    );
    if (!table) throw new Error("table fixture missing");
    const rows = structuredClone(table.props.rows);
    rows[0]![0]!.text = "after";
    expect(findReferencePatchViolation(deck, blueprint, [
      { type: "update_element_props", slideId: "slide_1", elementId: "el_image", props: { src: "/after.png", alt: "after" } },
      { type: "update_element_props", slideId: "slide_1", elementId: "el_table", props: { rows } },
      { type: "update_element_props", slideId: "slide_1", elementId: "el_chart", props: { data: [{ label: "B", value: 2 }] } },
    ])).toBeNull();
  });

  it("blocks image crop, table style, and chart type changes", () => {
    expect(findReferencePatchViolation(deck, blueprint, [{
      type: "update_element_props", slideId: "slide_1", elementId: "el_image", props: { crop: { left: 0.1 } },
    }])?.reason).toContain("src and alt");
    expect(findReferencePatchViolation(deck, blueprint, [{
      type: "update_element_props", slideId: "slide_1", elementId: "el_table", props: { borderWidth: 4 },
    }])?.reason).toContain("cell content");
    expect(findReferencePatchViolation(deck, blueprint, [{
      type: "update_element_props", slideId: "slide_1", elementId: "el_chart", props: { type: "line" },
    }])?.reason).toContain("only allow data");
  });

  it.each([
    "bad\u0000alt",
    "x".repeat(501),
  ])("blocks image alt text that cannot be serialized safely", (alt) => {
    expect(findReferencePatchViolation(deck, blueprint, [{
      type: "update_element_props",
      slideId: "slide_1",
      elementId: "el_image",
      props: { alt },
    }])?.reason).toContain("XML-safe");
  });

  it.each([
    [{ type: "update_element_frame", slideId: "slide_1", elementId: "el_text", frame: { x: 30 } }],
    [{ type: "delete_element", slideId: "slide_1", elementId: "el_text" }],
    [{ type: "add_slide", slide: deck.slides[0] }],
    [{ type: "add_animation", slideId: "slide_1", animation: {
      animationId: "animation_1", elementId: "el_text", type: "fade-in", order: 1,
      startMode: "on-click", durationMs: 300, delayMs: 0, easing: "ease-out",
    } }],
  ] as const)("blocks geometry, lifecycle, and animation mutations", (operation) => {
    expect(findReferencePatchViolation(deck, blueprint, [operation])?.reason).toContain("only allow slot content");
  });

  it("blocks decoration and text style mutations", () => {
    expect(findReferencePatchViolation(deck, blueprint, [{
      type: "update_element_props", slideId: "slide_1", elementId: "el_decoration", props: { fill: "#000000" },
    }])?.reason).toContain("not an editable");
    expect(findReferencePatchViolation(deck, blueprint, [{
      type: "update_element_props", slideId: "slide_1", elementId: "el_text", props: { fontSize: 48 },
    }])?.reason).toContain("only allow text content");
  });

  it("fails closed when the blueprint snapshot is absent", () => {
    expect(findReferencePatchViolation(deck, undefined, [{
      type: "update_element_props", slideId: "slide_1", elementId: "el_text", props: { text: "after" },
    }])?.operation).toBe("policy_resolution");
  });

  it("blocks PUT replacement bypasses while accepting the same content edit", () => {
    const contentEdit = structuredClone(deck);
    const text = contentEdit.slides[0]?.elements[0];
    if (text?.type === "text") text.props.text = "after";
    expect(findReferenceReplacementViolation(deck, contentEdit, blueprint)).toBeNull();

    const geometryEdit = structuredClone(contentEdit);
    const moved = geometryEdit.slides[0]?.elements[0];
    if (moved) moved.x += 10;
    expect(findReferenceReplacementViolation(deck, geometryEdit, blueprint)?.reason).toContain("locked");
  });

  it("does not constrain ordinary Decks", () => {
    const ordinary = deckSchema.parse({ ...deck, metadata: { sourceType: "import" } });
    expect(findReferencePatchViolation(ordinary, undefined, [{
      type: "delete_slide", slideId: "slide_1",
    }])).toBeNull();
  });
});
