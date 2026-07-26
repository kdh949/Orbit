import { randomUUID } from "node:crypto";
import { applyDeckPatch } from "@orbit/editor-core/patches";
import {
  applyDesignAgentProposalResponseSchema,
  createDesignAgentMessageResponseSchema,
  deckPatchOperationSchema,
  designAgentMessageSchema,
  designAgentCapabilities,
  designAgentProposalSchema,
  type ApplyDesignAgentProposalResponse,
  type CreateDesignAgentMessageRequest,
  type CreateDesignAgentMessageResponse,
  type Deck,
  type DeckCanvas,
  type DeckElement,
  type DeckPatchOperation,
  type DesignAgentContext,
  type DesignAgentMessage,
  type DesignAgentProposal,
  type Slide,
  type SmartArtItem,
  type SmartArtRequest,
} from "@orbit/shared/deck";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { Repository } from "typeorm";
import { DecksService } from "../decks/decks.service";
import { SmartArtLayoutEntity } from "../smart-art-layouts/smart-art-layout.entity";
import { SmartArtLayoutsService } from "../smart-art-layouts/smart-art-layouts.service";
import { DesignAgentMessageEntity } from "./design-agent-message.entity";
import { DesignAgentProposalEntity } from "./design-agent-proposal.entity";
import { DesignAgentPythonClient } from "./design-agent-python.client";

@Injectable()
export class DesignAgentService {
  constructor(
    @InjectRepository(DesignAgentMessageEntity)
    private readonly messagesRepository: Repository<DesignAgentMessageEntity>,
    @InjectRepository(DesignAgentProposalEntity)
    private readonly proposalsRepository: Repository<DesignAgentProposalEntity>,
    private readonly decksService: DecksService,
    private readonly pythonClient: DesignAgentPythonClient,
    private readonly smartArtLayoutsService: SmartArtLayoutsService,
    @InjectPinoLogger(DesignAgentService.name)
    private readonly logger: PinoLogger,
  ) {}

  async createMessage(
    projectId: string,
    actorUserId: string,
    input: CreateDesignAgentMessageRequest,
  ): Promise<CreateDesignAgentMessageResponse> {
    const currentDeck = await this.assertCurrentContext(projectId, input.context);

    const sessionId = input.sessionId ?? `design_session_${randomUUID()}`;
    const history = await this.loadHistory(projectId, actorUserId, sessionId);
    const now = new Date();
    const requestMessage = await this.messagesRepository.save(
      this.messagesRepository.create({
        messageId: `design_message_${randomUUID()}`,
        sessionId,
        projectId,
        actorUserId,
        deckId: input.context.deckId,
        slideId: input.context.slide.slideId,
        role: "user",
        content: input.content,
        status: "pending",
        contextJson: input.context,
        errorCode: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    try {
      const availableSmartArtLayouts = (
        await this.smartArtLayoutsService.listActiveCatalog()
      ).map((layout) => ({
        layoutId: layout.layoutId,
        layoutType: layout.layoutType,
        name: layout.name,
        itemCountMin: layout.itemCountMin,
        itemCountMax: layout.itemCountMax,
      }));
      const aiResult = await this.pythonClient.propose({
        projectId,
        sessionId,
        question: input.content,
        ...(input.intentPreset ? { intentPreset: input.intentPreset } : {}),
        context: input.context,
        history,
        availableSmartArtLayouts,
        capabilities: designAgentCapabilities,
      });
      const responseNow = new Date();
      const responseMessage = await this.messagesRepository.save(
        this.messagesRepository.create({
          messageId: `design_message_${randomUUID()}`,
          sessionId,
          projectId,
          actorUserId,
          deckId: input.context.deckId,
          slideId: input.context.slide.slideId,
          role: "assistant",
          content: aiResult.message,
          status: "succeeded",
          contextJson: null,
          errorCode: null,
          errorMessage: null,
          createdAt: responseNow,
          updatedAt: responseNow,
        }),
      );

      requestMessage.status = "succeeded";
      requestMessage.updatedAt = responseNow;
      await this.messagesRepository.save(requestMessage);

      const smartArtOperations = aiResult.smartArtRequest
        ? await this.expandSmartArtRequest(
            aiResult.smartArtRequest,
            input.context,
            aiResult.interpretedIntent.target,
          )
        : [];
      const smartArtDeletedElementIds = new Set(
        smartArtOperations.flatMap((operation) =>
          operation.type === "delete_element" ? [operation.elementId] : [],
        ),
      );
      if (
        aiResult.operations.some(
          (operation) =>
            "elementId" in operation &&
            smartArtDeletedElementIds.has(operation.elementId),
        )
      ) {
        throw new BadRequestException(
          "SmartArt replacement elements must not also be targeted by direct operations.",
        );
      }

      const operations = [...aiResult.operations, ...smartArtOperations];
      if (operations.length > 0) {
        const preview = applyDeckPatch(currentDeck, {
          deckId: input.context.deckId,
          baseVersion: input.context.baseVersion,
          source: "ai",
          operations,
        });
        if (!preview.ok) {
          throw new BadRequestException(
            `Design agent proposal is invalid: ${preview.error.code}${
              preview.error.details?.[0] ? ` (${preview.error.details[0]})` : ""
            }`,
          );
        }
      }
      const affectedElementIds = Array.from(
        new Set([
          ...aiResult.affectedElementIds,
          ...operations.flatMap((operation) => {
            if (operation.type === "add_element") return [operation.element.elementId];
            if ("elementId" in operation) return [operation.elementId];
            return [];
          }),
        ]),
      );

      const proposal =
        operations.length > 0
          ? await this.proposalsRepository.save(
              this.proposalsRepository.create({
                proposalId: `design_proposal_${randomUUID()}`,
                projectId,
                deckId: input.context.deckId,
                slideId: input.context.slide.slideId,
                requestMessageId: requestMessage.messageId,
                responseMessageId: responseMessage.messageId,
                baseVersion: input.context.baseVersion,
                title: "AI 디자인 변경안",
                summary: aiResult.message,
                operations,
                interpretedIntent: aiResult.interpretedIntent,
                affectedElementIds,
                warnings: aiResult.warnings,
                status: "pending",
                appliedChangeId: null,
                rejectedReason: null,
                createdAt: responseNow,
                updatedAt: responseNow,
              }),
            )
          : null;

      this.logger.info(
        {
          event: "design_agent.proposal.completed",
          projectId,
          deckId: input.context.deckId,
          slideId: input.context.slide.slideId,
          sessionId,
          intentPreset: input.intentPreset ?? null,
          operationCount: operations.length,
          smartArtLayoutType: aiResult.smartArtRequest?.layoutType ?? null,
          warningCount: aiResult.warnings.length,
        },
        "Design agent response completed.",
      );

      return createDesignAgentMessageResponseSchema.parse({
        sessionId,
        requestMessage: toMessageDto(requestMessage),
        responseMessage: toMessageDto(responseMessage),
        ...(proposal ? { proposal: toProposalDto(proposal) } : {}),
        uiAction: aiResult.uiAction,
      });
    } catch (error) {
      requestMessage.status = "failed";
      requestMessage.errorCode = "DESIGN_AGENT_REQUEST_FAILED";
      requestMessage.errorMessage = toSafeErrorMessage(error);
      requestMessage.updatedAt = new Date();
      await this.messagesRepository.save(requestMessage);

      this.logger.warn(
        {
          event: "design_agent.proposal.failed",
          projectId,
          deckId: input.context.deckId,
          slideId: input.context.slide.slideId,
          sessionId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        "Design agent request failed.",
      );
      throw error;
    }
  }

  async applyProposal(
    projectId: string,
    proposalId: string,
    actorUserId: string,
  ): Promise<ApplyDesignAgentProposalResponse> {
    const proposal = await this.proposalsRepository.findOne({
      where: { projectId, proposalId },
    });
    if (!proposal) {
      throw new NotFoundException("Design agent proposal was not found.");
    }
    if (proposal.status !== "pending") {
      throw new ConflictException("Design agent proposal is not pending.");
    }

    const current = await this.decksService.getDeck(projectId);
    if (
      current.deck.deckId !== proposal.deckId ||
      current.deck.version !== proposal.baseVersion
    ) {
      proposal.status = "stale";
      proposal.updatedAt = new Date();
      await this.proposalsRepository.save(proposal);
      throw new ConflictException("Design agent proposal baseVersion is stale.");
    }
    if (!current.deck.slides.some((slide) => slide.slideId === proposal.slideId)) {
      proposal.status = "stale";
      proposal.updatedAt = new Date();
      await this.proposalsRepository.save(proposal);
      throw new ConflictException("Design agent proposal slide no longer exists.");
    }

    const applied = await this.decksService.appendPatch(projectId, {
      patch: {
        deckId: proposal.deckId,
        baseVersion: proposal.baseVersion,
        source: "ai",
        actorUserId,
        operations: proposal.operations,
      },
      snapshotReason: "patch-applied",
    });

    proposal.status = "applied";
    proposal.appliedChangeId = applied.changeRecord.changeId;
    proposal.updatedAt = new Date();
    const savedProposal = await this.proposalsRepository.save(proposal);

    this.logger.info(
      {
        event: "design_agent.proposal.applied",
        projectId,
        deckId: proposal.deckId,
        slideId: proposal.slideId,
        proposalId,
        changeId: applied.changeRecord.changeId,
        operationCount: proposal.operations.length,
      },
      "Design agent proposal applied.",
    );

    return applyDesignAgentProposalResponseSchema.parse({
      proposal: toProposalDto(savedProposal),
      deck: applied.deck,
      changeRecord: applied.changeRecord,
      snapshot: applied.snapshot,
      updatedAt: applied.updatedAt,
    });
  }

  private async assertCurrentContext(
    projectId: string,
    context: DesignAgentContext,
  ): Promise<Deck> {
    const current = await this.decksService.getDeck(projectId);
    if (current.deck.deckId !== context.deckId) {
      throw new BadRequestException("Design agent deckId does not match project deck.");
    }
    if (current.deck.version !== context.baseVersion) {
      throw new BadRequestException("Design agent baseVersion is stale.");
    }
    if (!current.deck.slides.some((slide) => slide.slideId === context.slide.slideId)) {
      throw new BadRequestException("Design agent slide does not exist in project deck.");
    }
    return current.deck;
  }

  private async loadHistory(
    projectId: string,
    actorUserId: string,
    sessionId: string,
  ) {
    const messages = await this.messagesRepository.find({
      where: { projectId, actorUserId, sessionId, status: "succeeded" },
      order: { createdAt: "DESC" },
      take: 10,
    });
    return messages.reverse().map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  private async expandSmartArtRequest(
    smartArtRequest: SmartArtRequest,
    context: DesignAgentContext,
    target: "selected-elements" | "current-slide",
  ): Promise<DeckPatchOperation[]> {
    const selectedElementIds = new Set(context.selectedElementIds);
    const visibleElementIds = new Set(
      context.slide.elements
        .filter((element) => element.visible !== false)
        .map((element) => element.elementId),
    );
    const allowsSlideSources = target === "current-slide";
    for (const elementId of smartArtRequest.sourceElementIds) {
      if (
        !visibleElementIds.has(elementId) ||
        (!allowsSlideSources && !selectedElementIds.has(elementId))
      ) {
        throw new BadRequestException(
          allowsSlideSources
            ? "SmartArt sourceElementIds must reference visible slide elements."
            : "SmartArt sourceElementIds must reference visible selected elements.",
        );
      }
    }

    const layout = await this.smartArtLayoutsService.findActiveById(
      smartArtRequest.layoutId,
    );
    if (
      !layout ||
      layout.layoutType !== smartArtRequest.layoutType ||
      smartArtRequest.items.length < layout.itemCountMin ||
      smartArtRequest.items.length > layout.itemCountMax
    ) {
      throw new BadRequestException(
        `SmartArt layout is unavailable: ${smartArtRequest.layoutId}/${smartArtRequest.items.length}`,
      );
    }

    const operations = buildSmartArtOperations(
      layout,
      smartArtRequest.items,
      context.slide.slideId,
      context.canvas,
      smartArtRequest.sourceElementIds,
    );
    return replaceOverlappingSmartArtElements(
      context.slide,
      context.canvas,
      smartArtRequest.sourceElementIds,
      operations,
    );
  }
}

export function allowsUnselectedSmartArtSources(question: string) {
  const normalized = question.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const broadPresetRequest = [
    "꾸며줘",
    "꾸며 줘",
    "디자인해줘",
    "디자인 해줘",
    "보기 좋게",
    "예쁘게",
    "이쁘게",
    "재디자인",
    "다른 디자인",
    "다른 스타일",
    "다르게",
    "재구성",
    "구성 바꿔",
    "구성을 바꿔",
    "reconfigure",
    "redesign",
    "another design",
    "beautify",
    "decorate",
  ].some((phrase) => normalized.includes(phrase));
  const explicitSmallEdit = [
    "색상만",
    "색만",
    "글자 크기",
    "폰트만",
    "정렬만",
    "위치만",
    "간격만",
    "투명도",
    "회전",
    "애니메이션",
  ].some((phrase) => normalized.includes(phrase));
  return (broadPresetRequest && !explicitSmallEdit) || [
    "현재 페이지",
    "이 페이지",
    "페이지 전체",
    "현재 슬라이드",
    "이 슬라이드",
    "슬라이드 전체",
    "가운데 텍스트",
    "중앙 텍스트",
    "current page",
    "this page",
    "whole page",
    "current slide",
    "this slide",
    "whole slide",
    "center text",
    "centre text",
  ].some((phrase) => normalized.includes(phrase));
}

export function buildSmartArtOperations(
  layout: SmartArtLayoutEntity,
  items: SmartArtItem[],
  slideId: string,
  canvas: DeckCanvas,
  sourceElementIds: string[] = [],
): DeckPatchOperation[] {
  const instanceId = randomUUID().slice(0, 8);
  const operations: DeckPatchOperation[] = sourceElementIds.map((elementId) =>
    deckPatchOperationSchema.parse({ type: "delete_element", slideId, elementId }),
  );
  const generatedElements: Array<{
    elementId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
  }> = [];

  for (const template of layout.elements) {
    if (template.itemIndex !== null && template.itemIndex >= items.length) continue;

    const item = template.itemIndex !== null ? items[template.itemIndex] : null;
    const props = { ...template.props };
    if (template.textField && item) {
      props.text = (template.textField === "title" ? item.title : item.description) ?? "";
    }

    const element = {
      elementId: `el_smartart_${instanceId}_${template.elementIdSuffix}`,
      type: template.type,
      role: template.role,
      x: template.xFrac * canvas.width,
      y: template.yFrac * canvas.height,
      width: template.widthFrac * canvas.width,
      height: template.heightFrac * canvas.height,
      rotation: template.rotation,
      opacity: 1,
      zIndex: template.zIndex,
      locked: false,
      visible: true,
      props,
    };
    operations.push(
      deckPatchOperationSchema.parse({
        type: "add_element",
        slideId,
        element,
      }),
    );
    generatedElements.push(element);
  }

  if (generatedElements.length > 0) {
    const minX = Math.min(...generatedElements.map((element) => element.x));
    const minY = Math.min(...generatedElements.map((element) => element.y));
    const maxX = Math.max(
      ...generatedElements.map((element) => element.x + element.width),
    );
    const maxY = Math.max(
      ...generatedElements.map((element) => element.y + element.height),
    );
    operations.push(
      deckPatchOperationSchema.parse({
        type: "add_element",
        slideId,
        element: {
          elementId: `el_smartart_${instanceId}_group`,
          type: "group",
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          rotation: 0,
          opacity: 1,
          zIndex: Math.max(...generatedElements.map((element) => element.zIndex)) + 1,
          locked: false,
          visible: true,
          props: {
            childElementIds: generatedElements.map((element) => element.elementId),
          },
        },
      }),
    );
  }

  return operations;
}

type ElementBounds = Pick<DeckElement, "x" | "y" | "width" | "height">;
const SMART_ART_REPLACEMENT_PADDING_RATIO = 0.03;

function replaceOverlappingSmartArtElements(
  slide: Slide,
  canvas: DeckCanvas,
  sourceElementIds: string[],
  smartArtOperations: DeckPatchOperation[],
): DeckPatchOperation[] {
  const generatedElements = smartArtOperations.flatMap((operation) =>
    operation.type === "add_element" ? [operation.element] : [],
  );
  const footprint = getSmartArtFootprint(generatedElements, canvas);
  if (!footprint) return smartArtOperations;

  const replacementElementIds = findSmartArtReplacementElementIds(
    slide,
    canvas,
    footprint,
    sourceElementIds,
  );
  return [
    ...replacementElementIds.map((elementId) =>
      deckPatchOperationSchema.parse({
        type: "delete_element",
        slideId: slide.slideId,
        elementId,
      }),
    ),
    ...smartArtOperations.filter((operation) => operation.type !== "delete_element"),
  ];
}

function getSmartArtFootprint(
  elements: DeckElement[],
  canvas: DeckCanvas,
): ElementBounds | null {
  if (elements.length === 0) return null;

  const paddingX = canvas.width * SMART_ART_REPLACEMENT_PADDING_RATIO;
  const paddingY = canvas.height * SMART_ART_REPLACEMENT_PADDING_RATIO;
  const left = Math.max(0, Math.min(...elements.map((element) => element.x)) - paddingX);
  const top = Math.max(0, Math.min(...elements.map((element) => element.y)) - paddingY);
  const right = Math.min(
    canvas.width,
    Math.max(...elements.map((element) => element.x + element.width)) + paddingX,
  );
  const bottom = Math.min(
    canvas.height,
    Math.max(...elements.map((element) => element.y + element.height)) + paddingY,
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function findSmartArtReplacementElementIds(
  slide: Slide,
  canvas: DeckCanvas,
  footprint: ElementBounds,
  sourceElementIds: string[],
): string[] {
  const explicitSourceIds = new Set(sourceElementIds);
  const protectedElementIds = getProtectedSmartArtReplacementElementIds(slide, canvas);
  const replacementElementIds = new Set(sourceElementIds);

  for (const element of slide.elements) {
    if (
      protectedElementIds.has(element.elementId) ||
      !elementBoundsOverlap(element, footprint)
    ) {
      continue;
    }
    replacementElementIds.add(element.elementId);
  }

  const groups = slide.elements.filter((element) => element.type === "group");
  let expandedGroup = true;
  while (expandedGroup) {
    expandedGroup = false;
    for (const group of groups) {
      const memberIds = [group.elementId, ...group.props.childElementIds];
      if (!memberIds.some((elementId) => replacementElementIds.has(elementId))) {
        continue;
      }
      for (const elementId of memberIds) {
        if (
          replacementElementIds.has(elementId) ||
          (protectedElementIds.has(elementId) && !explicitSourceIds.has(elementId))
        ) {
          continue;
        }
        replacementElementIds.add(elementId);
        expandedGroup = true;
      }
    }
  }

  return [
    ...slide.elements
      .filter(
        (element) =>
          element.type !== "group" && replacementElementIds.has(element.elementId),
      )
      .map((element) => element.elementId),
    ...slide.elements
      .filter(
        (element) =>
          element.type === "group" && replacementElementIds.has(element.elementId),
      )
      .map((element) => element.elementId),
  ];
}

function getProtectedSmartArtReplacementElementIds(slide: Slide, canvas: DeckCanvas) {
  const protectedElementIds = new Set(
    slide.elements
      .filter(
        (element) =>
          element.visible === false ||
          element.role === "background" ||
          coversCanvas(element, canvas),
      )
      .map((element) => element.elementId),
  );

  const groups = slide.elements.filter((element) => element.type === "group");
  let expandedGroup = true;
  while (expandedGroup) {
    expandedGroup = false;
    for (const group of groups) {
      if (!protectedElementIds.has(group.elementId)) continue;
      for (const childElementId of group.props.childElementIds) {
        if (protectedElementIds.has(childElementId)) continue;
        protectedElementIds.add(childElementId);
        expandedGroup = true;
      }
    }
  }

  return protectedElementIds;
}

function coversCanvas(element: DeckElement, canvas: DeckCanvas) {
  const toleranceX = canvas.width * 0.01;
  const toleranceY = canvas.height * 0.01;
  return (
    element.x <= toleranceX &&
    element.y <= toleranceY &&
    element.x + element.width >= canvas.width - toleranceX &&
    element.y + element.height >= canvas.height - toleranceY
  );
}

function elementBoundsOverlap(first: ElementBounds, second: ElementBounds) {
  const overlapWidth =
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const overlapHeight =
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return overlapWidth > 0 && overlapHeight > 0;
}

function toMessageDto(entity: DesignAgentMessageEntity): DesignAgentMessage {
  return designAgentMessageSchema.parse({
    messageId: entity.messageId,
    sessionId: entity.sessionId,
    projectId: entity.projectId,
    deckId: entity.deckId,
    slideId: entity.slideId,
    role: entity.role,
    content: entity.content,
    status: entity.status,
    ...(entity.errorCode ? { errorCode: entity.errorCode } : {}),
    ...(entity.errorMessage ? { errorMessage: entity.errorMessage } : {}),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  });
}

function toProposalDto(entity: DesignAgentProposalEntity): DesignAgentProposal {
  return designAgentProposalSchema.parse({
    proposalId: entity.proposalId,
    projectId: entity.projectId,
    deckId: entity.deckId,
    slideId: entity.slideId,
    requestMessageId: entity.requestMessageId,
    ...(entity.responseMessageId
      ? { responseMessageId: entity.responseMessageId }
      : {}),
    baseVersion: entity.baseVersion,
    title: entity.title,
    ...(entity.summary ? { summary: entity.summary } : {}),
    operations: entity.operations,
    ...(entity.interpretedIntent
      ? { interpretedIntent: entity.interpretedIntent }
      : {}),
    affectedElementIds: entity.affectedElementIds,
    warnings: entity.warnings,
    status: entity.status,
    ...(entity.appliedChangeId
      ? { appliedChangeId: entity.appliedChangeId }
      : {}),
    ...(entity.rejectedReason
      ? { rejectedReason: entity.rejectedReason }
      : {}),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  });
}

function toSafeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Design agent request failed.";
  return error.message.slice(0, 1_000);
}
