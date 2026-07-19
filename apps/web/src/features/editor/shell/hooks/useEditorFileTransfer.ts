import {
  createAddElementPatch,
  createElementId,
  createUpdateElementPropsPatch
} from "../../../../../../../packages/editor-core/src/index";
import type {
  Deck,
  DeckCanvas,
  DeckExportRequest,
  DeckPatch,
  DesignImageGenerationResult,
  PptxImportQuality
} from "@orbit/shared";
import type { ChangeEvent, MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";

import { createProject, fetchProjects, uploadProjectAsset } from "../../../projects/ProjectAssetWorkspace";
import { normalizeEditorAssetUrl } from "../../shared/editorAssetUrl";
import { exportDeck as requestDeckExport, importPptxIntoEditor } from "../api/editorJobApi";
import type { PptxImportState } from "../components/PptxImportQualityPanel";
import type { PatchProducer } from "./useEditorPersistenceState";
import {
  defaultImageInsertFrame,
  getDefaultImageInsertFrame,
  getNextElementZIndex
} from "../utils/editorLayout";
import {
  getEditorImageValidationMessage,
  getPptxImportValidationMessage,
  readImageNaturalSize,
  toEditorErrorMessage
} from "../utils/editorFileValidation";
import { createSlideScopedUploadFile } from "../utils/slideRenderUtils";
import { canEditSlideCanvas } from "../utils/slideEditingPolicy";

export type ImageUploadTarget =
  | { type: "insert"; slideId: string }
  | { elementId: string; slideId: string; type: "replace" };

export type ImageInsertPlacement = {
  centerX: number;
  centerY: number;
};

export type ImageFileBatchSelection = {
  errorMessage: string;
  file: File | null;
  ignoredCount: number;
};

export type CanvasImageDropGate = {
  canMutateDeck: boolean;
  hasBlockingDialog: boolean;
  hasCurrentSlide: boolean;
  inlineTextEditing: boolean;
  insertCapabilityEnabled: boolean;
  isUploadPending: boolean;
  speakerNotesEditing: boolean;
};

export function createRehydratedPptxImportState(
  importQuality?: PptxImportQuality | null
): PptxImportState {
  return importQuality
    ? {
        status: "succeeded",
        warnings: [],
        qualityReport: importQuality.qualityReport,
        message: "저장된 PPTX 가져오기 품질"
      }
    : {
        status: "idle",
        warnings: [],
        qualityReport: null,
        message: ""
      };
}

type CommitPatch = (
  patch: DeckPatch | PatchProducer,
  baseDeck?: Deck
) => boolean;

const editorUploadProjectTitle = "ORBIT Editor Uploads";

export function getDroppedFiles(
  dataTransfer: Pick<DataTransfer, "files">
): File[] {
  return Array.from(dataTransfer.files);
}

export function getCanvasDropPlacement(input: {
  clientX: number;
  clientY: number;
  rect: Pick<DOMRect, "left" | "top">;
  stageScale: number;
}): ImageInsertPlacement {
  const scale = Math.max(0.0001, input.stageScale);
  return {
    centerX: (input.clientX - input.rect.left) / scale,
    centerY: (input.clientY - input.rect.top) / scale
  };
}

export function selectFirstEditorImageFile(
  files: readonly File[]
): ImageFileBatchSelection {
  if (files.length === 0) {
    return { errorMessage: "", file: null, ignoredCount: 0 };
  }

  const file = files.find(
    (candidate) => getEditorImageValidationMessage(candidate) === ""
  );
  if (!file) {
    return {
      errorMessage: getEditorImageValidationMessage(files[0]!),
      file: null,
      ignoredCount: files.length
    };
  }

  return {
    errorMessage: "",
    file,
    ignoredCount: Math.max(0, files.length - 1)
  };
}

export function getImageBatchStatusMessage(ignoredCount: number) {
  return ignoredCount > 0
    ? `이미지 1개를 추가했습니다. 나머지 ${ignoredCount}개 파일은 건너뛰었습니다.`
    : "이미지를 추가했습니다.";
}

export function getPlacedImageInsertFrame(
  canvas: DeckCanvas,
  imageSize: { height: number; width: number },
  placement?: ImageInsertPlacement
) {
  const frame = getDefaultImageInsertFrame(canvas, imageSize);
  if (!placement) return frame;

  return {
    ...frame,
    x: clamp(
      Math.round(placement.centerX - frame.width / 2),
      0,
      Math.max(0, canvas.width - frame.width)
    ),
    y: clamp(
      Math.round(placement.centerY - frame.height / 2),
      0,
      Math.max(0, canvas.height - frame.height)
    )
  };
}

export function getImageInsertCapability(deck: Deck, slideId: string) {
  const slide = deck.slides.find((candidate) => candidate.slideId === slideId);
  if (!slide) {
    return {
      enabled: false,
      reason: "이미지를 넣을 슬라이드를 찾지 못했습니다."
    };
  }
  if (!canEditSlideCanvas(slide)) {
    return {
      enabled: false,
      reason: "특수 장표에는 이미지를 추가할 수 없습니다."
    };
  }
  if (deck.metadata.sourceType === "import") {
    return slide.ooxmlOrigin === "imported" || slide.ooxmlOrigin === "authored"
      ? { enabled: true, reason: null }
      : {
          enabled: false,
          reason: "원본 PPTX 위치를 확인할 수 없는 슬라이드에는 이미지를 추가할 수 없습니다."
        };
  }
  return { enabled: true, reason: null };
}

export function canAcceptCanvasImageDrop(gate: CanvasImageDropGate) {
  return (
    gate.canMutateDeck &&
    gate.hasCurrentSlide &&
    !gate.inlineTextEditing &&
    !gate.speakerNotesEditing &&
    !gate.hasBlockingDialog &&
    !gate.isUploadPending &&
    gate.insertCapabilityEnabled
  );
}

export async function performImageFileInsert(input: {
  activeDeck: Deck;
  commitPatch: CommitPatch;
  file: File;
  placement?: ImageInsertPlacement;
  readNaturalSize: (file: File) => Promise<{ height: number; width: number }>;
  resolveUploadProject: (projectId: string) => Promise<string>;
  target: ImageUploadTarget;
  upload: (projectId: string, file: File) => Promise<{ url: string }>;
}) {
  const validationMessage = getEditorImageValidationMessage(input.file);
  if (validationMessage) throw new Error(validationMessage);

  const targetSlideIndex = input.activeDeck.slides.findIndex(
    (slide) => slide.slideId === input.target.slideId
  );
  const targetSlide = input.activeDeck.slides[targetSlideIndex];
  if (!targetSlide) {
    throw new Error("이미지를 넣을 슬라이드를 찾지 못했습니다.");
  }
  if (!canEditSlideCanvas(targetSlide)) {
    throw new Error("특수 장표에는 이미지를 추가하거나 교체할 수 없습니다.");
  }

  if (input.target.type === "replace") {
    const replaceTarget = input.target;
    const targetElement = targetSlide.elements.find(
      (element) => element.elementId === replaceTarget.elementId
    );
    if (!targetElement || targetElement.type !== "image") {
      throw new Error("교체할 이미지 요소를 찾지 못했습니다.");
    }
    if (
      input.activeDeck.metadata.sourceType === "import" &&
      targetElement.ooxmlOrigin === "imported" &&
      targetElement.ooxmlEditCapabilities?.imageSource !== true
    ) {
      throw new Error("이 이미지는 원본 PPTX에 안전하게 교체할 수 없습니다.");
    }
  } else {
    const capability = getImageInsertCapability(
      input.activeDeck,
      input.target.slideId
    );
    if (!capability.enabled) {
      throw new Error(
        capability.reason ?? "이 Deck에는 이미지를 안전하게 추가할 수 없습니다."
      );
    }
  }

  const naturalSize =
    input.target.type === "insert"
      ? await input.readNaturalSize(input.file).catch(() => ({
          height: defaultImageInsertFrame.height,
          width: defaultImageInsertFrame.width
        }))
      : null;
  const uploadProjectId = await input.resolveUploadProject(
    input.activeDeck.projectId
  );
  const uploaded = await input.upload(
    uploadProjectId,
    createSlideScopedUploadFile(
      input.file,
      targetSlide.order || targetSlideIndex + 1,
      "image"
    )
  );
  const normalizedUploadedUrl = normalizeEditorAssetUrl(uploaded.url);

  if (input.target.type === "replace") {
    const replaceTarget = input.target;
    let committedSlideIndex = targetSlideIndex;
    const committed = input.commitPatch((currentDeck) => {
      const currentSlideIndex = currentDeck.slides.findIndex(
        (slide) => slide.slideId === replaceTarget.slideId
      );
      if (currentSlideIndex < 0) {
        throw new Error("이미지를 넣을 슬라이드를 찾지 못했습니다.");
      }
      committedSlideIndex = currentSlideIndex;
      return createUpdateElementPropsPatch(
        currentDeck,
        replaceTarget.slideId,
        replaceTarget.elementId,
        { alt: input.file.name, src: normalizedUploadedUrl }
      );
    });
    if (!committed) throw new Error("이미지 교체를 적용하지 못했습니다.");
    return {
      elementId: replaceTarget.elementId,
      kind: "replace" as const,
      slideIndex: committedSlideIndex
    };
  }

  const frame = getPlacedImageInsertFrame(
    input.activeDeck.canvas,
    naturalSize!,
    input.placement
  );
  let elementId: string | null = null;
  let committedSlideIndex = targetSlideIndex;
  const committed = input.commitPatch((currentDeck) => {
    const currentSlideIndex = currentDeck.slides.findIndex(
      (slide) => slide.slideId === input.target.slideId
    );
    const currentSlide = currentDeck.slides[currentSlideIndex];
    if (!currentSlide || !canEditSlideCanvas(currentSlide)) {
      throw new Error("이미지를 넣을 슬라이드를 찾지 못했습니다.");
    }
    elementId = createElementId(currentDeck);
    committedSlideIndex = currentSlideIndex;
    return createAddElementPatch(currentDeck, input.target.slideId, {
      elementId: elementId!,
      type: "image",
      role: "media",
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      rotation: 0,
      opacity: 1,
      zIndex: getNextElementZIndex(currentSlide.elements),
      locked: false,
      visible: true,
      props: {
        alt: input.file.name,
        fit: "contain",
        focusX: 0.5,
        focusY: 0.5,
        src: normalizedUploadedUrl
      }
    });
  });
  if (!committed) throw new Error("이미지 추가를 적용하지 못했습니다.");
  if (!elementId) throw new Error("이미지 요소 ID를 만들지 못했습니다.");

  return {
    elementId,
    kind: "insert" as const,
    slideIndex: committedSlideIndex
  };
}

export function useEditorFileTransfer(args: {
  commitPatch: CommitPatch;
  onClearSelectedKeyword: () => void;
  onCloseContextMenu: () => void;
  onImportedDeck: (deck: Deck) => void;
  onResetEditing: () => void;
  onSelectElement: (elementId: string) => void;
  onSelectSlide: (index: number) => void;
  onSetSelectTool: () => void;
  persistedProjectId?: string;
  rehydratedPptxImportQuality?: PptxImportQuality | null;
  prepareForImport: () => Promise<void>;
  projectId: string;
  refetchDeck: () => Promise<Deck | undefined>;
  workingDeckRef: MutableRefObject<Deck>;
}) {
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);
  const pptxFileInputRef = useRef<HTMLInputElement | null>(null);
  const imageUploadTargetRef = useRef<ImageUploadTarget | null>(null);
  const imageUploadPendingRef = useRef(false);
  const resolvedUploadProjectIdRef = useRef<string | null>(null);
  const [isImageUploadPending, setIsImageUploadPending] = useState(false);
  const [imageUploadError, setImageUploadError] = useState("");
  const [imageUploadStatus, setImageUploadStatus] = useState("");
  const [isPptxExporting, setIsPptxExporting] = useState(false);
  const [pptxExportStatus, setPptxExportStatus] = useState("");
  const [pptxExportError, setPptxExportError] = useState("");
  const [pptxImportState, setPptxImportState] = useState<PptxImportState>(() =>
    createRehydratedPptxImportState(args.rehydratedPptxImportQuality)
  );

  useEffect(() => {
    setPptxImportState(createRehydratedPptxImportState());
  }, [args.projectId]);

  useEffect(() => {
    if (args.rehydratedPptxImportQuality === undefined) return;
    setPptxImportState((current) =>
      current.status === "idle"
        ? createRehydratedPptxImportState(args.rehydratedPptxImportQuality)
        : current
    );
  }, [args.projectId, args.rehydratedPptxImportQuality]);

  useEffect(() => {
    if (args.persistedProjectId) {
      resolvedUploadProjectIdRef.current = args.persistedProjectId;
    }
  }, [args.persistedProjectId]);

  function openImageFilePicker(target: ImageUploadTarget) {
    if (imageUploadPendingRef.current) return;
    if (target.type === "insert") {
      const capability = getImageInsertCapability(
        args.workingDeckRef.current,
        target.slideId
      );
      if (!capability.enabled) {
        setImageUploadStatus("");
        setImageUploadError(
          capability.reason ??
            "이 Deck에는 이미지를 안전하게 추가할 수 없습니다."
        );
        return;
      }
    }
    args.onCloseContextMenu();
    setImageUploadError("");
    setImageUploadStatus("");
    imageUploadTargetRef.current = target;
    imageFileInputRef.current?.click();
  }

  function openPptxFilePicker() {
    if (pptxImportState.status === "uploading" || pptxImportState.status === "importing") {
      return;
    }
    pptxFileInputRef.current?.click();
  }

  async function resolveUploadProject(targetProjectId: string) {
    if (resolvedUploadProjectIdRef.current) return resolvedUploadProjectIdRef.current;
    if (args.persistedProjectId) {
      resolvedUploadProjectIdRef.current = args.persistedProjectId;
      return args.persistedProjectId;
    }
    const projects = await fetchProjects();
    const preferredProject = projects.find((project) => project.projectId === targetProjectId);
    const project = preferredProject ?? projects[0] ?? (await createProject(editorUploadProjectTitle));
    resolvedUploadProjectIdRef.current = project.projectId;
    return project.projectId;
  }

  async function insertImageFiles(
    files: readonly File[],
    target: ImageUploadTarget,
    placement?: ImageInsertPlacement
  ) {
    if (imageUploadPendingRef.current) return false;
    setImageUploadError("");
    setImageUploadStatus("");

    const selection = selectFirstEditorImageFile(files);
    if (!selection.file) {
      if (selection.errorMessage) setImageUploadError(selection.errorMessage);
      return false;
    }

    imageUploadPendingRef.current = true;
    setIsImageUploadPending(true);
    setImageUploadStatus("이미지 업로드 중...");
    try {
      const activeDeck = args.workingDeckRef.current;
      const result = await performImageFileInsert({
        activeDeck,
        commitPatch: args.commitPatch,
        file: selection.file,
        placement,
        readNaturalSize: readImageNaturalSize,
        resolveUploadProject,
        target,
        upload: (projectId, file) =>
          uploadProjectAsset(projectId, file, "reference-material")
      });
      args.onSelectSlide(result.slideIndex);
      args.onSelectElement(result.elementId);
      if (result.kind === "insert") {
        args.onResetEditing();
        args.onSetSelectTool();
      }
      setImageUploadStatus(
        result.kind === "insert"
          ? getImageBatchStatusMessage(selection.ignoredCount)
          : "이미지를 교체했습니다."
      );
      return true;
    } catch (error) {
      setImageUploadStatus("");
      setImageUploadError(toEditorErrorMessage(error));
      return false;
    } finally {
      imageUploadPendingRef.current = false;
      setIsImageUploadPending(false);
    }
  }

  function insertGeneratedImage(
    result: DesignImageGenerationResult,
    slideId: string
  ) {
    const activeDeck = args.workingDeckRef.current;
    const targetSlideIndex = activeDeck.slides.findIndex(
      (slide) => slide.slideId === slideId
    );
    if (targetSlideIndex < 0) return false;
    const targetSlide = activeDeck.slides[targetSlideIndex];
    if (!canEditSlideCanvas(targetSlide)) return false;

    const elementId = createElementId(activeDeck);
    const frame = getDefaultImageInsertFrame(activeDeck.canvas, {
      width: result.width,
      height: result.height
    });
    args.commitPatch(
      (currentDeck) => createAddElementPatch(currentDeck, slideId, {
        elementId,
        type: "image",
        role: "media",
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        rotation: 0,
        opacity: 1,
        zIndex: getNextElementZIndex(targetSlide.elements),
        locked: false,
        visible: true,
        props: {
          alt: result.prompt,
          fit: "cover",
          focusX: 0.5,
          focusY: 0.5,
          src: normalizeEditorAssetUrl(result.url)
        }
      }),
      activeDeck
    );
    args.onSelectSlide(targetSlideIndex);
    args.onSelectElement(elementId);
    args.onResetEditing();
    args.onSetSelectTool();
    return true;
  }

  async function handlePptxFileSelection(file: File) {
    const validationMessage = getPptxImportValidationMessage(file);
    if (validationMessage) {
      setPptxImportState({ status: "error", warnings: [], qualityReport: null, message: validationMessage });
      return;
    }
    setPptxImportState({ status: "uploading", warnings: [], qualityReport: null, message: "PPTX 업로드 중..." });
    try {
      await args.prepareForImport();
      const activeProjectId = await resolveUploadProject(
        args.workingDeckRef.current.projectId || args.projectId
      );
      const { importResult, importedDeck } = await importPptxIntoEditor(activeProjectId, file, {
        onPhase: (phase) => setPptxImportState({
          status: phase,
          warnings: [],
          qualityReport: null,
          message: phase === "uploading" ? "PPTX 업로드 중..." : "PPTX 변환 중..."
        }),
        refetchDeck: args.refetchDeck
      });
      args.onImportedDeck(importedDeck);
      args.onClearSelectedKeyword();
      setPptxImportState({
        status: "succeeded",
        warnings: importResult.warnings,
        qualityReport: importResult.qualityReport,
        message: "PPTX 가져오기 완료"
      });
    } catch (error) {
      setPptxImportState({
        status: "error",
        warnings: [],
        qualityReport: null,
        message: toEditorErrorMessage(error)
      });
    }
  }

  async function exportDeck(
    save: () => Promise<boolean | undefined>,
    input: DeckExportRequest
  ): Promise<boolean> {
    if (isPptxExporting) return false;
    const activeProjectId = args.workingDeckRef.current.projectId || args.persistedProjectId;
    if (!activeProjectId) {
      setPptxExportError("내보낼 프로젝트를 찾지 못했습니다.");
      return false;
    }
    setIsPptxExporting(true);
    setPptxExportError("");
    setPptxExportStatus("저장 중...");
    try {
      const saved = await save();
      if (!saved) throw new Error("최신 편집 내용을 저장한 뒤 다시 시도하세요.");
      const formatLabel = input.format === "png" ? "PNG ZIP" : "PPTX";
      setPptxExportStatus(`${formatLabel} 내보내기 중...`);
      const result = await requestDeckExport(activeProjectId, input);
      setPptxExportStatus(
        result.warnings.length
          ? `${formatLabel} 생성 완료, ${result.warnings.length}개 경고`
          : `${formatLabel} 생성 완료`
      );
      window.open(result.url, "_blank", "noopener,noreferrer");
      return true;
    } catch (error) {
      setPptxExportStatus("");
      setPptxExportError(
        error instanceof Error ? error.message : "Deck 내보내기에 실패했습니다."
      );
      return false;
    } finally {
      setIsPptxExporting(false);
    }
  }

  function handleImageFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const target = imageUploadTargetRef.current;
    event.target.value = "";
    imageUploadTargetRef.current = null;
    if (files.length > 0 && target) void insertImageFiles(files, target);
  }

  function handlePptxFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (file) void handlePptxFileSelection(file);
  }

  return {
    actions: {
      handleImageFileInputChange,
      handlePptxFileInputChange,
      exportDeck,
      getImageInsertCapability: (slideId: string) =>
        getImageInsertCapability(args.workingDeckRef.current, slideId),
      insertGeneratedImage,
      insertImageFiles,
      openImageFilePicker,
      openPptxFilePicker
    },
    refs: { imageFileInputRef, pptxFileInputRef },
    state: {
      imageUploadError,
      imageUploadStatus,
      isImageUploadPending,
      isPptxExporting,
      pptxExportError,
      pptxExportStatus,
      pptxImportState
    }
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
