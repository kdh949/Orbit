import { applyDeckPatch, createDemoDeck } from "@orbit/editor-core";
import { deckElementSchema, type DeckPatch } from "@orbit/shared/deck";
import type { Repository } from "typeorm";
import { describe, expect, it, vi } from "vitest";
import type { DecksService } from "../decks/decks.service";
import type { SmartArtLayoutEntity } from "../smart-art-layouts/smart-art-layout.entity";
import type { SmartArtLayoutsService } from "../smart-art-layouts/smart-art-layouts.service";
import { DesignAgentMessageEntity } from "./design-agent-message.entity";
import { DesignAgentProposalEntity } from "./design-agent-proposal.entity";
import type { DesignAgentPythonClient } from "./design-agent-python.client";
import {
  allowsUnselectedSmartArtSources,
  DesignAgentService,
} from "./design-agent.service";

describe("allowsUnselectedSmartArtSources", () => {
  it("allows reconfigure wording to use visible slide elements", () => {
    expect(allowsUnselectedSmartArtSources("현재 디자인 재구성좀 해줘")).toBe(true);
  });

  it.each([
    "현재 페이지 가운데 텍스트를 도식화해줘",
    "이 슬라이드를 스마트아트로 바꿔줘",
    "가운데 텍스트를 중심으로 꾸며줘",
    "Redesign the current slide as SmartArt",
  ])("allows visible slide sources for whole-slide wording: %s", (question) => {
    expect(allowsUnselectedSmartArtSources(question)).toBe(true);
  });

  it("keeps selection-only requests restricted", () => {
    expect(allowsUnselectedSmartArtSources("선택한 항목을 스마트아트로 바꿔줘")).toBe(false);
  });

  it.each([
    "보기 좋게 꾸며줘",
    "도형도 넣어서 디자인해줘",
    "좀 다른 디자인 없어?",
    "Beautify this content",
  ])("allows visible slide sources for broad preset requests: %s", (question) => {
    expect(allowsUnselectedSmartArtSources(question)).toBe(true);
  });

  it("keeps explicit small edits on the direct edit path", () => {
    expect(allowsUnselectedSmartArtSources("글자 색상만 바꿔서 꾸며줘")).toBe(false);
  });
});

describe("DesignAgentService.applyProposal", () => {
  it("applies a pending proposal through the shared deck patch path", async () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const proposal = {
      proposalId: "design_proposal_1",
      projectId: deck.projectId,
      deckId: deck.deckId,
      slideId: slide.slideId,
      requestMessageId: "design_message_1",
      responseMessageId: "design_message_2",
      baseVersion: deck.version,
      title: "AI design proposal",
      summary: "Move the element.",
      operations: [{
        type: "update_slide_style",
        slideId: slide.slideId,
        style: { layout: "title-content" },
      }],
      interpretedIntent: null,
      affectedElementIds: [],
      warnings: [],
      status: "pending",
      appliedChangeId: null,
      rejectedReason: null,
      createdAt: new Date("2026-07-11T00:00:00.000Z"),
      updatedAt: new Date("2026-07-11T00:00:00.000Z"),
    } as unknown as DesignAgentProposalEntity;
    const proposalsRepository = {
      findOne: vi.fn(async () => proposal),
      save: vi.fn(async (value: DesignAgentProposalEntity) => value),
    } as unknown as Repository<DesignAgentProposalEntity>;
    const nextDeck = { ...deck, version: deck.version + 1 };
    const decksService = {
      getDeck: vi.fn(async () => ({ projectId: deck.projectId, deck, updatedAt: "2026-07-11T00:00:00.000Z" })),
      appendPatch: vi.fn(async (_projectId: string, body: { patch: DeckPatch }) => ({
        deck: nextDeck,
        changeRecord: {
          changeId: "change_design_1",
          deckId: deck.deckId,
          beforeVersion: deck.version,
          afterVersion: nextDeck.version,
          source: "ai",
          actorUserId: body.patch.actorUserId,
          createdAt: "2026-07-11T00:00:01.000Z",
          operations: body.patch.operations,
        },
        snapshot: null,
        updatedAt: "2026-07-11T00:00:01.000Z",
      })),
    } as unknown as DecksService;
    const service = new DesignAgentService(
      {} as Repository<DesignAgentMessageEntity>,
      proposalsRepository,
      decksService,
      {} as DesignAgentPythonClient,
      {} as SmartArtLayoutsService,
      { info: vi.fn(), warn: vi.fn() } as never,
    );

    const result = await service.applyProposal(deck.projectId, proposal.proposalId, "user_demo_1");

    expect(result.deck.version).toBe(deck.version + 1);
    expect(result.proposal.status).toBe("applied");
    expect(result.proposal.appliedChangeId).toBe("change_design_1");
    expect(decksService.appendPatch).toHaveBeenCalledWith(deck.projectId, {
      patch: {
        deckId: deck.deckId,
        baseVersion: deck.version,
        source: "ai",
        actorUserId: "user_demo_1",
        operations: proposal.operations,
      },
      snapshotReason: "patch-applied",
    });
  });
});

describe("DesignAgentService.createMessage smart art expansion", () => {
  it("expands a smartArtRequest into add_element operations using the matched preset", async () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const canvas = deck.canvas;
    const sourceElementId = slide.elements.find((element) => element.visible)?.elementId;
    expect(sourceElementId).toBeTruthy();

    const savedMessages: DesignAgentMessageEntity[] = [];
    const messagesRepository = {
      create: vi.fn((value: Partial<DesignAgentMessageEntity>) => value as DesignAgentMessageEntity),
      save: vi.fn(async (value: DesignAgentMessageEntity) => {
        savedMessages.push(value);
        return value;
      }),
      find: vi.fn(async () => []),
    } as unknown as Repository<DesignAgentMessageEntity>;

    let savedProposal: DesignAgentProposalEntity | undefined;
    const proposalsRepository = {
      create: vi.fn(
        (value: Partial<DesignAgentProposalEntity>) => value as DesignAgentProposalEntity,
      ),
      save: vi.fn(async (value: DesignAgentProposalEntity) => {
        savedProposal = value;
        return value;
      }),
    } as unknown as Repository<DesignAgentProposalEntity>;

    const decksService = {
      getDeck: vi.fn(async () => ({
        projectId: deck.projectId,
        deck,
        updatedAt: "2026-07-17T00:00:00.000Z",
      })),
    } as unknown as DecksService;

    const fakeLayout = {
      layoutId: "smart_art_list_vertical_3",
      layoutType: "list",
      name: "Vertical list",
      itemCountMin: 2,
      itemCountMax: 3,
      isActive: true,
      elements: [
        {
          elementIdSuffix: "row_bg_0",
          type: "rect",
          itemIndex: 0,
          role: "decoration",
          xFrac: 0.1,
          yFrac: 0.2,
          widthFrac: 0.8,
          heightFrac: 0.1,
          rotation: 0,
          zIndex: 100,
          props: { fill: "#F1F1F1", stroke: "#C8C8C6", strokeWidth: 1, borderRadius: 4 },
        },
        {
          elementIdSuffix: "text_0",
          type: "text",
          itemIndex: 0,
          role: "body",
          xFrac: 0.15,
          yFrac: 0.22,
          widthFrac: 0.7,
          heightFrac: 0.05,
          rotation: 0,
          zIndex: 101,
          textField: "title",
          props: { fontSize: 26, fontWeight: "normal", color: "#222222", align: "left", verticalAlign: "middle", lineHeight: 1.15 },
        },
        {
          elementIdSuffix: "text_1",
          type: "text",
          itemIndex: 1,
          role: "body",
          xFrac: 0.15,
          yFrac: 0.32,
          widthFrac: 0.7,
          heightFrac: 0.05,
          rotation: 0,
          zIndex: 102,
          textField: "title",
          props: { fontSize: 26, fontWeight: "normal", color: "#222222", align: "left", verticalAlign: "middle", lineHeight: 1.15 },
        },
      ],
    } as unknown as SmartArtLayoutEntity;

    const smartArtLayoutsService = {
      listActiveCatalog: vi.fn(async () => [fakeLayout]),
      findActiveById: vi.fn(async () => fakeLayout),
    } as unknown as SmartArtLayoutsService;

    const pythonClient = {
      propose: vi.fn(async () => ({
        message: "여기 리스트 스마트아트를 만들었어요.",
        interpretedIntent: { target: "current-slide", action: "add smart art" },
        operations: [],
        affectedElementIds: [],
        warnings: [],
        smartArtRequest: {
          layoutId: "smart_art_list_vertical_3",
          layoutType: "list",
          sourceElementIds: [sourceElementId!],
          items: [{ title: "기획" }, { title: "개발" }],
        },
      })),
    } as unknown as DesignAgentPythonClient;

    const service = new DesignAgentService(
      messagesRepository,
      proposalsRepository,
      decksService,
      pythonClient,
      smartArtLayoutsService,
      { info: vi.fn(), warn: vi.fn() } as never,
    );

    await service.createMessage(deck.projectId, "user_demo_1", {
      content: "이 목록을 스마트아트로 만들어줘: 1.기획 2.개발",
      intentPreset: "redesign-slide",
      context: {
        deckId: deck.deckId,
        baseVersion: deck.version,
        canvas,
        slide,
        selectedElementIds: [sourceElementId!],
        theme: deck.theme,
      },
    });

    expect(smartArtLayoutsService.findActiveById).toHaveBeenCalledWith(
      "smart_art_list_vertical_3",
    );
    expect(pythonClient.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        question: "이 목록을 스마트아트로 만들어줘: 1.기획 2.개발",
        intentPreset: "redesign-slide",
      }),
    );
    const deletedElementIds = (savedProposal?.operations ?? []).flatMap((operation) =>
      operation.type === "delete_element" ? [operation.elementId] : [],
    );
    expect(deletedElementIds).toContain(sourceElementId);
    expect(
      (savedProposal?.operations ?? []).filter((operation) => operation.type === "add_element"),
    ).toHaveLength(4);
    const texts = savedProposal?.operations
      .filter((op) => op.type === "add_element" && op.element.type === "text")
      .map((op) => (op.type === "add_element" ? (op.element.props as { text?: string }).text : undefined));
    expect(texts).toEqual(["기획", "개발"]);
    const groupOperation = savedProposal?.operations.find(
      (operation) => operation.type === "add_element" && operation.element.type === "group",
    );
    expect(groupOperation).toMatchObject({
      type: "add_element",
      element: {
        type: "group",
        locked: false,
        props: { childElementIds: expect.arrayContaining([]) },
      },
    });
    if (groupOperation?.type === "add_element" && groupOperation.element.type === "group") {
      expect(groupOperation.element.props.childElementIds).toHaveLength(3);
    }
  });

  it("replaces overlapping current-slide graphics when no elements are selected", async () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const canvas = deck.canvas;
    slide.animations = [];
    slide.actions = [];
    slide.semanticCues = [];
    slide.elements = [
      deckElementSchema.parse({
        elementId: "el_slide_background",
        type: "rect",
        role: "background",
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
        zIndex: 0,
        props: { fill: "#FFFFFF" },
      }),
      deckElementSchema.parse({
        elementId: "el_header_title",
        type: "text",
        role: "title",
        x: 80,
        y: 40,
        width: 1200,
        height: 80,
        zIndex: 10,
        props: { text: "Orbit의 혁신적 분석과 피드백 제공" },
      }),
      deckElementSchema.parse({
        elementId: "el_header_intro",
        type: "text",
        role: "body",
        x: 80,
        y: 130,
        width: 1500,
        height: 65,
        zIndex: 11,
        props: { text: "발표 결과를 분석해 구체적인 개선 행동을 제시합니다." },
      }),
      deckElementSchema.parse({
        elementId: "el_old_graphic_primary",
        type: "rect",
        role: "decoration",
        x: 160,
        y: 250,
        width: 1600,
        height: 150,
        zIndex: 20,
        props: { fill: "#C4B5FD" },
      }),
      deckElementSchema.parse({
        elementId: "el_old_graphic_ungrouped_label",
        type: "text",
        role: "body",
        x: 160,
        y: 760,
        width: 1600,
        height: 60,
        zIndex: 21,
        props: { text: "기존 순서 그래픽과 가까운 하단 항목" },
      }),
      deckElementSchema.parse({
        elementId: "el_old_graphic_tail",
        type: "text",
        role: "body",
        x: 160,
        y: 820,
        width: 1600,
        height: 100,
        zIndex: 22,
        props: { text: "기존 순서 그래픽의 하단 설명" },
      }),
      deckElementSchema.parse({
        elementId: "el_old_graphic_group",
        type: "group",
        x: 150,
        y: 230,
        width: 1620,
        height: 690,
        zIndex: 23,
        props: {
          childElementIds: ["el_old_graphic_primary", "el_old_graphic_tail"],
        },
      }),
      deckElementSchema.parse({
        elementId: "el_hidden_overlap",
        type: "rect",
        role: "decoration",
        x: 200,
        y: 280,
        width: 500,
        height: 120,
        zIndex: 24,
        visible: false,
        props: { fill: "#111827" },
      }),
      deckElementSchema.parse({
        elementId: "el_footer",
        type: "text",
        role: "footer",
        x: 80,
        y: 980,
        width: 600,
        height: 40,
        zIndex: 30,
        props: { text: "ORBIT" },
      }),
    ];

    const messagesRepository = {
      create: vi.fn((value: Partial<DesignAgentMessageEntity>) => value as DesignAgentMessageEntity),
      save: vi.fn(async (value: DesignAgentMessageEntity) => value),
      find: vi.fn(async () => []),
    } as unknown as Repository<DesignAgentMessageEntity>;

    let savedProposal: DesignAgentProposalEntity | undefined;
    const proposalsRepository = {
      create: vi.fn(
        (value: Partial<DesignAgentProposalEntity>) => value as DesignAgentProposalEntity,
      ),
      save: vi.fn(async (value: DesignAgentProposalEntity) => {
        savedProposal = value;
        return value;
      }),
    } as unknown as Repository<DesignAgentProposalEntity>;

    const decksService = {
      getDeck: vi.fn(async () => ({
        projectId: deck.projectId,
        deck,
        updatedAt: "2026-07-18T00:00:00.000Z",
      })),
    } as unknown as DecksService;

    const fakeLayout = {
      layoutId: "smart_art_process_horizontal_4",
      layoutType: "process",
      name: "Horizontal process",
      itemCountMin: 4,
      itemCountMax: 4,
      isActive: true,
      elements: Array.from({ length: 4 }, (_, index) => [
        {
          elementIdSuffix: `card_${index}`,
          type: "rect",
          itemIndex: index,
          role: "decoration",
          xFrac: 0.08 + index * 0.21,
          yFrac: 0.34,
          widthFrac: 0.19,
          heightFrac: 0.36,
          rotation: 0,
          zIndex: 100 + index * 10,
          props: { fill: "#EFF6FF", stroke: "#CBD5E1", strokeWidth: 1 },
        },
        {
          elementIdSuffix: `title_${index}`,
          type: "text",
          itemIndex: index,
          role: "title",
          xFrac: 0.1 + index * 0.21,
          yFrac: 0.48,
          widthFrac: 0.15,
          heightFrac: 0.08,
          rotation: 0,
          zIndex: 101 + index * 10,
          textField: "title",
          props: {
            fontSize: 24,
            fontWeight: "bold",
            color: "#0F172A",
            align: "left",
            verticalAlign: "top",
            lineHeight: 1.1,
          },
        },
      ]).flat(),
    } as unknown as SmartArtLayoutEntity;

    const smartArtLayoutsService = {
      listActiveCatalog: vi.fn(async () => [fakeLayout]),
      findActiveById: vi.fn(async () => fakeLayout),
    } as unknown as SmartArtLayoutsService;

    const pythonClient = {
      propose: vi.fn(async () => ({
        message: "1, 2, 3, 4번 항목을 순차 다이어그램으로 변경했어요.",
        interpretedIntent: {
          target: "current-slide",
          action: "replace with process smart art",
        },
        operations: [],
        affectedElementIds: [],
        warnings: [],
        smartArtRequest: {
          layoutId: "smart_art_process_horizontal_4",
          layoutType: "process",
          sourceElementIds: [],
          items: [
            { title: "발표 시간 분석" },
            { title: "Pause 구간 감지" },
            { title: "핵심 키워드 평가" },
            { title: "개선 행동 검증" },
          ],
        },
      })),
    } as unknown as DesignAgentPythonClient;

    const service = new DesignAgentService(
      messagesRepository,
      proposalsRepository,
      decksService,
      pythonClient,
      smartArtLayoutsService,
      { info: vi.fn(), warn: vi.fn() } as never,
    );

    await service.createMessage(deck.projectId, "user_demo_1", {
      content: "1, 2, 3, 4번을 순차 다이어그램 형태로 바꿔줘.",
      context: {
        deckId: deck.deckId,
        baseVersion: deck.version,
        canvas,
        slide,
        selectedElementIds: [],
        theme: deck.theme,
      },
    });

    expect(smartArtLayoutsService.findActiveById).toHaveBeenCalledWith(
      "smart_art_process_horizontal_4",
    );
    const operations = savedProposal?.operations ?? [];
    const deletedElementIds = operations.flatMap((operation) =>
      operation.type === "delete_element" ? [operation.elementId] : [],
    );
    expect(deletedElementIds).toEqual([
      "el_old_graphic_primary",
      "el_old_graphic_ungrouped_label",
      "el_old_graphic_tail",
      "el_old_graphic_group",
    ]);
    expect(deletedElementIds).not.toContain("el_slide_background");
    expect(deletedElementIds).not.toContain("el_header_title");
    expect(deletedElementIds).not.toContain("el_header_intro");
    expect(deletedElementIds).not.toContain("el_hidden_overlap");
    expect(deletedElementIds).not.toContain("el_footer");

    const groupOperation = operations.find(
      (operation) => operation.type === "add_element" && operation.element.type === "group",
    );
    expect(groupOperation).toMatchObject({
      type: "add_element",
      element: {
        type: "group",
        props: { childElementIds: expect.any(Array) },
      },
    });
    if (groupOperation?.type === "add_element" && groupOperation.element.type === "group") {
      expect(groupOperation.element.props.childElementIds).toHaveLength(8);
    }

    const previewResult = applyDeckPatch(deck, {
      deckId: deck.deckId,
      baseVersion: deck.version,
      source: "ai",
      operations,
    });
    expect(previewResult.ok).toBe(true);
    if (previewResult.ok) {
      const previewElementIds = previewResult.deck.slides[0]!.elements.map(
        (element) => element.elementId,
      );
      expect(previewElementIds).toEqual(
        expect.arrayContaining([
          "el_slide_background",
          "el_header_title",
          "el_header_intro",
          "el_hidden_overlap",
          "el_footer",
        ]),
      );
      expect(previewElementIds).not.toContain("el_old_graphic_primary");
      expect(previewElementIds).not.toContain("el_old_graphic_ungrouped_label");
      expect(previewElementIds).not.toContain("el_old_graphic_tail");
      expect(previewElementIds).not.toContain("el_old_graphic_group");
    }
  });
});
