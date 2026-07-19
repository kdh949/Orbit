import { applyDeckPatch } from "@orbit/editor-core";
import type {
  ApplyDesignAgentProposalResponse,
  Deck,
  DesignImageGenerationResult,
  DesignImageReferenceAttachment,
  DesignAgentProposal,
  SelectedDesignImageReference,
  SpeakerNotesSuggestionMode,
  Slide
} from "@orbit/shared";
import { IconArrowUp as ArrowUp, IconPhoto as Photo } from "@tabler/icons-react";
import {
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction
} from "react";
import {
  applyDesignAgentProposal,
  createDesignAgentMessage,
  createDesignImageGeneration,
  pollDesignImageGeneration
} from "../../design-agent/designAgentApi";
import {
  getAssetValidationMessage,
  uploadProjectAsset
} from "../../../projects/ProjectAssetWorkspace";
import {
  parseProjectAssetDescriptor,
  resolveEditorAssetUrl
} from "../../shared/editorAssetUrl";
import { DesignProposalPreviewModal } from "./DesignProposalPreviewModal";

export type AiChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  tone?: "error";
  imagePreview?: {
    result: DesignImageGenerationResult;
    slideId: string;
  };
};

export type AiChatState = {
  messages: AiChatMessage[];
  projectId: string;
  sessionId: string | null;
};

type PendingPreview = {
  candidateDeck: Deck;
  proposal: DesignAgentProposal;
};

type SelectedImagePreview = {
  reference: SelectedDesignImageReference;
  previewUrl: string;
};

type AiChatPanelProps = {
  projectId: string;
  deck: Deck;
  currentSlide: Slide | null;
  selectedElementIds: string[];
  chatState: AiChatState;
  onChatStateChange: Dispatch<SetStateAction<AiChatState>>;
  onProposalApplied: (response: ApplyDesignAgentProposalResponse) => void;
  onGeneratedImageInsert: (
    result: DesignImageGenerationResult,
    slideId: string
  ) => boolean;
  onSpeakerNotesAssistantRequest: (mode: SpeakerNotesSuggestionMode) => void;
  designEditingEnabled?: boolean;
};

export function createInitialAiChatState(projectId: string): AiChatState {
  return {
    messages: [
      {
        id: "assistant-welcome",
        role: "assistant",
        content: "현재 슬라이드에서 바꾸고 싶은 디자인을 말씀해 주세요."
      }
    ],
    projectId,
    sessionId: null
  };
}

const smartArtSuggestion = "현재 가운데에 있는 내용을 내용에 맞는 SmartArt 형태로 디자인해줘.";

export function AiChatPanel(props: AiChatPanelProps) {
  const designEditingEnabled = props.designEditingEnabled ?? true;
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isUploadingReferenceImage, setIsUploadingReferenceImage] = useState(false);
  const [referenceImages, setReferenceImages] = useState<
    DesignImageReferenceAttachment[]
  >([]);
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null);
  const [mode, setMode] = useState<"design" | "image">("design");
  const referenceImageInputRef = useRef<HTMLInputElement | null>(null);
  const maxReferenceImages = 3;
  const selectedImagePreview = getSelectedImagePreview(
    props.projectId,
    props.currentSlide,
    props.selectedElementIds,
  );
  const isFirstSlide = Boolean(
    props.currentSlide && props.deck.slides[0]?.slideId === props.currentSlide.slideId,
  );

  function applySuggestedPrompt(prompt: string) {
    setMode("design");
    setDraft(prompt);
  }

  async function handleReferenceImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || !props.currentSlide || !designEditingEnabled) return;
    const remainingSlots = maxReferenceImages - referenceImages.length;
    if (remainingSlots <= 0) {
      appendErrorMessage("이미지 참고자료는 최대 3개까지만 첨부할 수 있습니다.");
      return;
    }

    const selectedFiles = files.slice(0, remainingSlots);
    const invalidFile = selectedFiles.find((file) => {
      const validationMessage = getAssetValidationMessage(file);
      return validationMessage || !toDesignImageReferenceMimeType(file.type);
    });
    if (invalidFile) {
      appendErrorMessage("이미지 생성 참고자료는 JPG, PNG, WebP 이미지만 첨부할 수 있습니다.");
      return;
    }

    setIsUploadingReferenceImage(true);
    try {
      const uploadedImages = await Promise.all(
        selectedFiles.map(async (file) => {
          const uploaded = await uploadProjectAsset(
            props.projectId,
            file,
            "reference-material",
          );
          const mimeType = toDesignImageReferenceMimeType(uploaded.mimeType);
          if (!mimeType) {
            throw new Error("이미지 생성 참고자료는 JPG, PNG, WebP 이미지만 첨부할 수 있습니다.");
          }
          return {
            fileId: uploaded.fileId,
            fileName: uploaded.originalName,
            mimeType,
          } satisfies DesignImageReferenceAttachment;
        }),
      );
      setReferenceImages((current) => {
        const next = [...current];
        for (const image of uploadedImages) {
          if (!next.some((item) => item.fileId === image.fileId)) {
            next.push(image);
          }
        }
        return next.slice(0, maxReferenceImages);
      });
    } catch (error) {
      appendErrorMessage(error);
    } finally {
      setIsUploadingReferenceImage(false);
    }
  }

  function removeReferenceImage(fileId: string) {
    setReferenceImages((current) =>
      current.filter((image) => image.fileId !== fileId)
    );
  }

  function updateMessages(
    updater: (current: AiChatMessage[]) => AiChatMessage[]
  ) {
    props.onChatStateChange((current) =>
      current.projectId === props.projectId
        ? { ...current, messages: updater(current.messages) }
        : current
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !props.currentSlide || !designEditingEnabled || isSending) return;

    updateMessages((current) => [
      ...current,
      { id: `user-${crypto.randomUUID()}`, role: "user", content }
    ]);
    setDraft("");
    setIsSending(true);

    try {
      if (mode === "image") {
        const slideId = props.currentSlide.slideId;
        const generation = await createDesignImageGeneration(props.projectId, {
          prompt: content,
          deckId: props.deck.deckId,
          slideId,
          baseVersion: props.deck.version,
          ...(selectedImagePreview
            ? { selectedImageReference: selectedImagePreview.reference }
            : {}),
          referenceImages
        });
        const result = await pollDesignImageGeneration(generation.job.jobId);
        updateMessages((current) => [
          ...current,
          {
            id: `generated-image-${generation.job.jobId}`,
            role: "assistant",
            content: "이미지를 생성했습니다. 슬라이드에 추가하기 전에 확인해 주세요.",
            imagePreview: { result, slideId }
          }
        ]);
        return;
      }

      const result = await createDesignAgentMessage(props.projectId, {
        ...(props.chatState.sessionId
          ? { sessionId: props.chatState.sessionId }
          : {}),
        content,
        context: {
          deckId: props.deck.deckId,
          baseVersion: props.deck.version,
          canvas: props.deck.canvas,
          slide: props.currentSlide,
          selectedElementIds: props.selectedElementIds,
          theme: props.deck.theme
        }
      });
      props.onChatStateChange((current) =>
        current.projectId === props.projectId
          ? { ...current, sessionId: result.sessionId }
          : current
      );

      if (result.uiAction?.type === "open-speaker-notes-assistant") {
        props.onSpeakerNotesAssistantRequest(result.uiAction.mode);
      }

      if (result.proposal) {
        const previewResult = applyDeckPatch(props.deck, {
          deckId: result.proposal.deckId,
          baseVersion: result.proposal.baseVersion,
          source: "ai",
          operations: result.proposal.operations
        });
        if (!previewResult.ok) {
          const detail = previewResult.error.details?.[0];
          throw new Error(
            `AI 제안의 미리보기를 만들지 못했습니다: ${
              detail ?? previewResult.error.message
            }`,
          );
        }
        setPendingPreview({
          candidateDeck: previewResult.deck,
          proposal: result.proposal
        });
      }

      const warningText = result.proposal?.warnings.length
        ? `\n\n주의: ${result.proposal.warnings.join(" ")}`
        : "";
      updateMessages((current) => [
        ...current,
        {
          id: result.responseMessage.messageId,
          role: "assistant",
          content: `${result.responseMessage.content}${
            result.proposal ? "\n\n미리보기를 확인해 주세요." : ""
          }${warningText}`
        }
      ]);
    } catch (error) {
      appendErrorMessage(error);
    } finally {
      setIsSending(false);
    }
  }

  function dismissGeneratedImage(messageId: string) {
    updateMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? { ...message, imagePreview: undefined }
          : message
      )
    );
  }

  function insertGeneratedImage(message: AiChatMessage) {
    if (!message.imagePreview) return;
    const inserted = props.onGeneratedImageInsert(
      message.imagePreview.result,
      message.imagePreview.slideId
    );
    if (!inserted) return;
    updateMessages((current) =>
      current.map((candidate) =>
        candidate.id === message.id
          ? {
              ...candidate,
              content: "생성한 이미지를 슬라이드에 추가했습니다.",
              imagePreview: undefined
            }
          : candidate
      )
    );
  }

  async function handleApplyPreview() {
    if (!pendingPreview || isApplying) return;
    setIsApplying(true);
    try {
      const applied = await applyDesignAgentProposal(
        props.projectId,
        pendingPreview.proposal.proposalId
      );
      props.onProposalApplied(applied);
      setPendingPreview(null);
      updateMessages((current) => [
        ...current,
        {
          id: `applied-${applied.proposal.proposalId}`,
          role: "assistant",
          content: "선택한 디자인을 슬라이드에 적용했습니다."
        }
      ]);
    } catch (error) {
      appendErrorMessage(error);
    } finally {
      setIsApplying(false);
    }
  }

  function appendErrorMessage(error: unknown) {
    updateMessages((current) => [
      ...current,
      {
        id: `error-${crypto.randomUUID()}`,
        role: "assistant",
        content:
          error instanceof Error
            ? `요청을 처리하지 못했습니다. ${error.message}`
            : "요청을 처리하지 못했습니다.",
        tone: "error"
      }
    ]);
  }

  const canSend = Boolean(
    draft.trim() &&
      props.currentSlide &&
      designEditingEnabled &&
      !isSending &&
      !isUploadingReferenceImage
  );

  return (
    <section className="ai-chat-panel" aria-label="AI 채팅">
      {!designEditingEnabled && props.currentSlide ? (
        <p className="ai-chat-editing-locked" role="status">
          특수 장표는 AI 디자인 대신 장표 설정에서 관리합니다.
        </p>
      ) : null}
      <div className="ai-chat-history" aria-live="polite">
        {props.chatState.messages.map((message) => (
          <div className={`ai-chat-message ${message.role}`} key={message.id}>
            <span className="ai-chat-avatar" aria-hidden="true">
              {message.role === "assistant" ? "AI" : "Y"}
            </span>
            <div className="ai-chat-message-stack">
              {message.role === "user" ? (
                <div className="ai-chat-message-meta" aria-hidden="true">
                  <strong>You</strong>
                  <span>now</span>
                </div>
              ) : null}
              <p className={message.tone === "error" ? "error" : undefined}>
                {message.content}
              </p>
            </div>
            {message.imagePreview ? (
              <div className="ai-generated-image-card">
                <img
                  alt={message.imagePreview.result.prompt}
                  src={message.imagePreview.result.url}
                />
                <p>{message.imagePreview.result.prompt}</p>
                <div className="ai-generated-image-actions">
                  <button
                    type="button"
                    disabled={!props.deck.slides.some(
                      (slide) => slide.slideId === message.imagePreview?.slideId
                    )}
                    onClick={() => insertGeneratedImage(message)}
                  >
                    슬라이드에 추가
                  </button>
                  <button type="button" onClick={() => dismissGeneratedImage(message.id)}>
                    닫기
                  </button>
                </div>
                {!props.deck.slides.some(
                  (slide) => slide.slideId === message.imagePreview?.slideId
                ) ? (
                  <span role="alert">대상 슬라이드가 삭제되어 추가할 수 없습니다.</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        {isSending ? (
          <div className="ai-chat-message assistant">
            <span className="ai-chat-avatar" aria-hidden="true">AI</span>
            <div className="ai-chat-message-stack">
              <p>{mode === "image" ? "이미지를 생성하고 있습니다..." : "디자인을 검토하고 있습니다..."}</p>
            </div>
          </div>
        ) : null}
      </div>

      {mode === "design" && designEditingEnabled && props.currentSlide ? (
        <div aria-label="추천 AI 요청" className="ai-chat-suggestions">
          <button
            type="button"
            disabled={isSending}
            onClick={() => applySuggestedPrompt(smartArtSuggestion)}
          >
            가운데 내용을 SmartArt로 디자인
          </button>
          {isFirstSlide ? (
            <button
              type="button"
              disabled={isSending}
              onClick={() => props.onSpeakerNotesAssistantRequest("icebreaker")}
            >
              아이스브레이킹 인트로 추가
            </button>
          ) : null}
        </div>
      ) : null}

      <form className="ai-chat-composer" onSubmit={handleSubmit}>
        <div aria-label="AI 작업 모드" className="ai-chat-mode-switch" role="group">
          <button
            aria-pressed={mode === "design"}
            className={mode === "design" ? "active" : ""}
            disabled={isSending}
            type="button"
            onClick={() => setMode("design")}
          >
            디자인
          </button>
          <button
            aria-pressed={mode === "image"}
            className={mode === "image" ? "active" : ""}
            disabled={isSending}
            type="button"
            onClick={() => setMode("image")}
          >
            <Photo aria-hidden="true" size={14} /> 이미지 생성
          </button>
        </div>
        {selectedImagePreview ? (
          <div className="ai-chat-selected-image" aria-label="선택한 이미지 썸네일">
            <img
              alt={selectedImagePreview.reference.alt || "선택한 이미지"}
              src={selectedImagePreview.previewUrl}
            />
            <div>
              <strong>선택한 이미지</strong>
              <span>
                {mode === "image"
                  ? "이미지 생성에 자동 사용됨"
                  : "이미지 생성 모드에서 자동 사용됨"}
              </span>
            </div>
          </div>
        ) : null}
        {mode === "image" ? (
          <>
            <div className="ai-chat-reference-images-header">
              <span>참고 이미지</span>
              <button
                type="button"
                onClick={() => referenceImageInputRef.current?.click()}
                disabled={
                  !designEditingEnabled ||
                  !props.currentSlide ||
                  isUploadingReferenceImage ||
                  referenceImages.length >= maxReferenceImages
                }
                aria-label="이미지 생성 참고 이미지 첨부하기"
              >
                {isUploadingReferenceImage ? "첨부중..." : "이미지 첨부"}
              </button>
              <span>{referenceImages.length}/{maxReferenceImages}</span>
            </div>
            <div className="ai-chat-reference-images" aria-live="polite">
              {referenceImages.map((image) => (
                <div key={image.fileId} className="ai-chat-reference-image-item">
                  <span>이미지: {image.fileName}</span>
                  <button
                    type="button"
                    onClick={() => removeReferenceImage(image.fileId)}
                    aria-label={`${image.fileName} 삭제`}
                    disabled={!designEditingEnabled || !props.currentSlide}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <input
              ref={referenceImageInputRef}
              type="file"
              accept=".jpeg,.jpg,.png,.webp,image/jpeg,image/png,image/webp"
              multiple
              onChange={handleReferenceImageSelection}
              style={{ display: "none" }}
            />
          </>
        ) : null}
        <div className="ai-chat-input-shell">
          <textarea
            aria-label="AI에게 메시지 보내기"
            placeholder={designEditingEnabled
              ? mode === "image"
                ? "만들고 싶은 이미지를 설명해 주세요"
                : "바꾸고 싶은 디자인을 말씀해 주세요"
              : "장표 설정에서 내용을 관리해 주세요"}
            rows={1}
            value={draft}
            disabled={isSending || !props.currentSlide || !designEditingEnabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
          <button aria-label="메시지 보내기" disabled={!canSend} type="submit">
            <ArrowUp size={17} strokeWidth={2.4} />
          </button>
        </div>
      </form>

      {pendingPreview ? (
        <DesignProposalPreviewModal
          deck={pendingPreview.candidateDeck}
          slideId={pendingPreview.proposal.slideId}
          summary={pendingPreview.proposal.summary ?? pendingPreview.proposal.title}
          warnings={pendingPreview.proposal.warnings}
          isApplying={isApplying}
          onApply={() => void handleApplyPreview()}
          onClose={() => setPendingPreview(null)}
        />
      ) : null}
    </section>
  );
}

function getSelectedImagePreview(
  projectId: string,
  slide: Slide | null,
  selectedElementIds: string[],
): SelectedImagePreview | null {
  if (!slide || selectedElementIds.length !== 1) return null;
  const element = slide.elements.find(
    (candidate) => candidate.elementId === selectedElementIds[0],
  );
  if (!element || element.type !== "image" || !element.props.src) return null;
  const descriptor = parseProjectAssetDescriptor(element.props.src);
  if (!descriptor || descriptor.projectId !== projectId) return null;
  return {
    previewUrl: resolveEditorAssetUrl(element.props.src),
    reference: {
      elementId: element.elementId,
      fileId: descriptor.fileId,
      projectId: descriptor.projectId,
      src: element.props.src,
      ...(element.props.alt ? { alt: element.props.alt } : {}),
    },
  };
}

function toDesignImageReferenceMimeType(value: string) {
  return value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/webp"
    ? value
    : null;
}
