import {
  createDemoDeck,
} from "@orbit/editor-core/fixtures";
import {
  createApplyActivityDesignPresetPatch,
  createUpdateActivityDefinitionPatch,
  createUpdateActivityResultDefinitionPatch,
} from "@orbit/editor-core/activities";
import {
  createDuplicateSlidePatch,
  deriveKeywordActionUsage,
  getElementAnimations,
  validateSlideAnimations
} from "@orbit/editor-core/patches";
import { demoIds } from "@orbit/shared/common";
import type { Slide } from "@orbit/shared/deck";
import { slideQuestionGuideTextHashInput } from "@orbit/shared/slide-practice";
import { getRenderableSlideElements } from "../canvas/EditorCanvas";
import { getImageCropActionState } from "../canvas/image/imageCropSession";
import {
  AnimationInspectorPanel,
  AnimationSlideTransitionEditor,
  buildAnimationKeywordTriggerPolicy,
  toAnimationKeywordTriggerOptions,
  useEditorAnimationPreview
} from "./components/animation";
import { EditorDebugPanels } from "./components/EditorDebugPanels";
import { EditorTopbar } from "./components/EditorTopbar";
import { createInitialAiChatState } from "./components/AiChatPanel";
import { EditorSelectionProperties } from "./components/EditorSelectionProperties";
import { MultiSelectionQuickBar } from "./components/MultiSelectionQuickBar";
import { SelectionInspector } from "./components/SelectionInspector";
import type {
  SaveErrorCode,
  SaveState
} from "./hooks/useEditorPersistenceState";
import { useProjectShareAccess } from "./hooks/useProjectShareAccess";
import { useEditorShellUiStore } from "./editorShellUiStore";
import { beginHorizontalPaneResize } from "./utils/beginHorizontalPaneResize";
import {
  canEditSlideCanvas,
  canInsertCustomShape,
  canInsertDataElements
} from "./utils/slideEditingPolicy";
import {
  getAnimationMutationDisabledReason,
  getTransitionMutationDisabledReason
} from "./utils/motionEditingPolicy";
import {
  createSelectionInspectorModel,
  resolveSelectionInspectorCompactMode
} from "./selectionInspectorModel";
import {
  createDistributeSelectionPatch,
  type DistributeAxis
} from "./utils/selectionDistribution";
import {
  createAlignSelectionPatch,
  type SelectionAlignment
} from "./utils/selectionAlignment";
import {
  canMutateProjectDeck,
  useProjectAccessMembership
} from "../../projects/ProjectAccessContext";
export {
  EditorStateNotice
} from "./components/EditorStateNotice";
export {
  mergeDeckIntoQueryCache,
  buildSlideThumbnailPatch,
  getDeckThumbnailRefreshSlideIds,
  getImportedSlideThumbnailRefreshSlideIds,
  getPatchThumbnailRefreshSlideIds,
  shouldRefreshImportedSlideThumbnails,
  shouldApplyManualSaveResult,
  shouldHydrateDeckFromQuery
} from "./utils/deckState";
export { createDistributeSelectionPatch } from "./utils/selectionDistribution";
export { getEditorValidationItems } from "../ai/quality/editorValidation";
export {
  appendAppliedDesignProposalHistory,
  resolveHistoryNavigation,
  type HistoryEntry
} from "./utils/editorHistory";
import {
  buildSlideRailItems,
  resolveSelectedSlideId,
  resolveSelectedSlideIdAfterDelete
} from "./slideRailModel";
import {
  createDeleteSlidePatch,
  createSlideRailReorderPatch,
  getAddedSlideId,
  moveSlideId
} from "./slideRailOperations";
export {
  danglingKeywordOccurrenceSaveMessage,
  getSpeakerNotesDanglingOccurrenceSaveBlock,
  shouldPromptSpeakerNotesDraftDiscard,
  shouldPromptSpeakerNotesOverwrite
} from "./utils/speakerNotesDraft";
export {
  getGroupedChildPreviewFrame,
  getImageElementLayout,
  getResponsiveEditorStageScale
} from "./utils/editorLayout";
export { useLoadedImage } from "./hooks/useLoadedImage";
import type {
  ApplyDesignAgentProposalResponse,
  Deck,
  DeckAnimation,
  DeckExportFormat,
  DeckExportRequest,
  SemanticCue,
} from "@orbit/shared";
import { useQuery } from "@tanstack/react-query";
import type Konva from "konva";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEditorValidationItems } from "../ai/quality/editorValidation";
import { createSafeTextOverflowRepair } from "../ai/quality/safeTextOverflowRepair";
import {
  presentEditorValidationItems,
  type EditorValidationTargetView
} from "../ai/quality/validationPresentation";
import {
  ActivityQrInsertDialog,
  ActivityResultSlideInspector,
  ActivitySlideInspector
} from "../../activity-slides";
import {
  type SemanticCueExtractionUiState
} from "../semantic-cues/SemanticCueReviewPanel";
import { createSemanticCueReviewPatch } from "../semantic-cues/semanticCueReviewModel";
import {
  SpeakerNotesAssistantDialog
} from "./components/SpeakerNotesAssistantDialog";
import {
  SpeakerNotesPanel,
  type SpeakerNotesTab
} from "./components/SpeakerNotesPanel";
import {
  EditorSlideRehearsalBottomPanel,
  EditorSlideRehearsalLeftPanel
} from "./components/EditorSlideRehearsal";
import { SlideNavigatorPane } from "./components/SlideNavigatorPane";
import { EditorUndoToast } from "./components/EditorUndoToast";
import { EditorContextMenus } from "./components/EditorContextMenus";
import { EditorModals } from "./components/EditorModals";
import { PptxImportPreferenceDialog } from "./components/PptxImportPreferenceDialog";
import { createTargetDurationPatch } from "./targetDurationModel";
import { EditorCanvasStage } from "./components/EditorCanvasStage";
import { EditorToolbar } from "./components/EditorToolbar";
import { IconLibrarySidePanel } from "./components/IconLibrarySidePanel";
import {
  EditorRightPanel,
  type AiPanelView
} from "./components/EditorRightPanel";
import type {
  KeywordActionMode,
  KeywordSelectionContext
} from "./components/KeywordInspector";
import type { EditorRightPanelMode } from "./utils/rightPanelMode";
import {
  fetchDeck,
  fetchPptxImportQuality,
  flushEditorPersistenceBeforeManualAction
} from "./api/deckPersistenceApi";
import {
  createSemanticCueExtractionJob,
  waitForSemanticCueExtractionJob
} from "./api/editorJobApi";
import { fetchHealth } from "./api/editorSessionApi";
import { useProjectPresence } from "./hooks/useProjectPresence";
import { useEditorViewport } from "./hooks/useEditorViewport";
import { useSlideRenderPipeline } from "./hooks/useSlideRenderPipeline";
import { useEditorKeyboardShortcuts } from "./hooks/useEditorKeyboardShortcuts";
import type { EditorEscapeLayer } from "./editorKeyboardCommands";
import { useSpeakerNotesEditor } from "./hooks/useSpeakerNotesEditor";
import {
  canAcceptCanvasImageDrop,
  useEditorFileTransfer
} from "./hooks/useEditorFileTransfer";
import { useEditorDocumentController } from "./hooks/useEditorDocumentController";
import { useEditorCanvasCommands } from "./hooks/useEditorCanvasCommands";
import {
  minSpeakerNotesPanelHeight,
  reportSpeakerNotesPanelHeight,
  useSpeakerNotesPanelLayout
} from "./hooks/useSpeakerNotesPanelLayout";
import { useEditorSlideCommands } from "./hooks/useEditorSlideCommands";
import { useEditorPresentationActions } from "./hooks/useEditorPresentationActions";
import { useEditorSlideRehearsal } from "./hooks/useEditorSlideRehearsal";
import { useSlidePracticeSession } from "../practice/useSlidePracticeSession";
import { useAutoSlideQuestionGuides } from "../practice/useAutoSlideQuestionGuides";
import { useShapeMenuPlacement } from "./hooks/useShapeMenuPlacement";
import { createSelectionNudgePatch } from "./utils/selectionNudge";
import {
  maximumManualEditorZoom,
  minimumManualEditorZoom
} from "./editorZoom";
export {
  applyDeckPatchAcknowledgement,
  buildPatchBatch,
  consumeScheduledUndoRedoPersistLabel,
  flushEditorPersistenceBeforeManualAction,
  parseDeckPatchPersistenceResponse,
  putProjectDeck
} from "./api/deckPersistenceApi";
export {
  createDeckExportJob,
  createPptxOoxmlGenerationJob,
  createSemanticCueExtractionJob,
  exportDeck,
  exportDeckToPptx,
  importPptxIntoEditor,
  requireMatchingPptxImportedDeck,
  uploadAndImportPptxTemplate,
  waitForDeckExportJob,
  waitForPptxOoxmlGenerationJob,
  waitForSemanticCueExtractionJob
} from "./api/editorJobApi";
import {
  editorImageAccept,
  pptxImportAccept,
  toEditorErrorMessage
} from "./utils/editorFileValidation";
import type { PptxImportState } from "./components/PptxImportQualityPanel";
import "../../../styles/tokens.css";
import "../editor-shell.css";

declare global {
  interface Window {
    __ORBIT_EDITOR_TEST_API__?: {
      updateSelectedElementFrame: (
        frame: Partial<{
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
        }>
      ) => boolean;
      updateCurrentSlideStyle: (
        style: Partial<{
          backgroundColor: string | null;
          textColor: string | null;
          accentColor: string | null;
        }>
      ) => boolean;
    };
  }
}

const fallbackDeck = createDemoDeck();
const collapsedSlidesPaneWidth = 0;
const minSlidesPaneWidth = 160;

const maxSlidesPaneWidth = 280;
const collapsedRightPaneWidth = 52;
const minRightPaneWidth = 260;
const maxRightPaneWidth = 560;

function navigateToHome() {
  window.history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function EditorShell(props: { projectId?: string }) {
  const projectId = props.projectId ?? demoIds.projectId;
  const projectAccessMembership = useProjectAccessMembership();
  const canMutateDeck = canMutateProjectDeck(projectAccessMembership);
  const [currentSlideId, setCurrentSlideId] = useState<string | null>(null);
  const [isDeleteUndoToastOpen, setIsDeleteUndoToastOpen] = useState(false);
  const resetProjectUiState = useEditorShellUiStore(
    (state) => state.resetProjectUiState
  );
  const isDataViewOpen = useEditorShellUiStore((state) => state.isDataViewOpen);
  const setIsDataViewOpen = useEditorShellUiStore((state) => state.setIsDataViewOpen);
  const isAnimationPanelOpen = useEditorShellUiStore(
    (state) => state.isAnimationPanelOpen
  );
  const setIsAnimationPanelOpen = useEditorShellUiStore(
    (state) => state.setIsAnimationPanelOpen
  );
  const isIconPanelOpen = useEditorShellUiStore((state) => state.isIconPanelOpen);
  const setIsIconPanelOpen = useEditorShellUiStore(
    (state) => state.setIsIconPanelOpen
  );
  const isRightPanelOpen = useEditorShellUiStore((state) => state.isRightPanelOpen);
  const setIsRightPanelOpen = useEditorShellUiStore(
    (state) => state.setIsRightPanelOpen
  );
  const [rightPanelMode, setRightPanelMode] =
    useState<EditorRightPanelMode>("assistant");
  const [propertiesOpenRequestId, setPropertiesOpenRequestId] = useState(0);
  const [assistantOpenRequestId, setAssistantOpenRequestId] = useState(0);
  const compactSelectionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectionInspectorRef = useRef<HTMLElement | null>(null);
  const [aiPanelView, setAiPanelView] = useState<AiPanelView>("chat");
  const [aiChatState, setAiChatState] = useState(() =>
    createInitialAiChatState(projectId)
  );
  const isSlidesPaneCollapsed = useEditorShellUiStore(
    (state) => state.isSlidesPaneCollapsed
  );
  const setIsSlidesPaneCollapsed = useEditorShellUiStore(
    (state) => state.setIsSlidesPaneCollapsed
  );
  const slidesPaneWidth = useEditorShellUiStore((state) => state.slidesPaneWidth);
  const setSlidesPaneWidth = useEditorShellUiStore(
    (state) => state.setSlidesPaneWidth
  );
  const rightPaneWidth = useEditorShellUiStore((state) => state.rightPaneWidth);
  const setRightPaneWidth = useEditorShellUiStore((state) => state.setRightPaneWidth);
  const isPresenceDebugOpen = useEditorShellUiStore(
    (state) => state.isPresenceDebugOpen
  );
  const setIsPresenceDebugOpen = useEditorShellUiStore(
    (state) => state.setIsPresenceDebugOpen
  );
  const isAudienceLinkModalOpen = useEditorShellUiStore(
    (state) => state.isAudienceLinkModalOpen
  );
  const setIsAudienceLinkModalOpen = useEditorShellUiStore(
    (state) => state.setIsAudienceLinkModalOpen
  );
  const isExitConfirmOpen = useEditorShellUiStore((state) => state.isExitConfirmOpen);
  const setIsExitConfirmOpen = useEditorShellUiStore(
    (state) => state.setIsExitConfirmOpen
  );
  const [isExitSaving, setIsExitSaving] = useState(false);
  const animationPanelFocusedAnimationId = useEditorShellUiStore(
    (state) => state.animationPanelFocusedAnimationId
  );
  const setAnimationPanelFocusedAnimationId = useEditorShellUiStore(
    (state) => state.setAnimationPanelFocusedAnimationId
  );
  const {
    lastPresenceAt,
    sessionDebug,
    socketErrorMessage,
    socketId,
    socketStatus,
    users: projectPresenceUsers
  } = useProjectPresence({ isDebugOpen: isPresenceDebugOpen, projectId });
  const slidePanelView = useEditorShellUiStore((state) => state.slidePanelView);
  const setSlidePanelView = useEditorShellUiStore((state) => state.setSlidePanelView);
  const showIds = useEditorShellUiStore((state) => state.showIds);
  const selectedKeywordId = useEditorShellUiStore((state) => state.selectedKeywordId);
  const setSelectedKeywordId = useEditorShellUiStore(
    (state) => state.setSelectedKeywordId
  );
  const selectedKeywordOccurrenceKey = useEditorShellUiStore(
    (state) => state.selectedKeywordOccurrenceKey
  );
  const setSelectedKeywordOccurrenceKey = useEditorShellUiStore(
    (state) => state.setSelectedKeywordOccurrenceKey
  );
  const selectedElementIds = useEditorShellUiStore((state) => state.selectedElementIds);
  const setSelectedElementIds = useEditorShellUiStore(
    (state) => state.setSelectedElementIds
  );
  const [validationHighlightElementIds, setValidationHighlightElementIds] =
    useState<string[]>([]);
  const [validationRepairStatus, setValidationRepairStatus] = useState("");
  const activeTopMenu = useEditorShellUiStore((state) => state.activeTopMenu);
  const setActiveTopMenu = useEditorShellUiStore((state) => state.setActiveTopMenu);
  const insertTool = useEditorShellUiStore((state) => state.insertTool);
  const setInsertTool = useEditorShellUiStore((state) => state.setInsertTool);
  const editingElementId = useEditorShellUiStore((state) => state.editingElementId);
  const setEditingElementId = useEditorShellUiStore(
    (state) => state.setEditingElementId
  );
  const customShapeEditElementId = useEditorShellUiStore(
    (state) => state.customShapeEditElementId
  );
  const setCustomShapeEditElementId = useEditorShellUiStore(
    (state) => state.setCustomShapeEditElementId
  );
  const [imageCropElementId, setImageCropElementId] = useState<string | null>(
    null
  );
  const isShapeMenuOpen = useEditorShellUiStore((state) => state.isShapeMenuOpen);
  const setIsShapeMenuOpen = useEditorShellUiStore(
    (state) => state.setIsShapeMenuOpen
  );
  const shapeMenuPosition = useEditorShellUiStore((state) => state.shapeMenuPosition);
  const setShapeMenuPosition = useEditorShellUiStore(
    (state) => state.setShapeMenuPosition
  );
  const shapeMenuButtonRef = useShapeMenuPlacement({
    isOpen: isShapeMenuOpen,
    setIsOpen: setIsShapeMenuOpen,
    setPosition: setShapeMenuPosition
  });
  const [isChartMenuOpen, setIsChartMenuOpen] = useState(false);
  const [chartMenuPosition, setChartMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const chartMenuButtonRef = useShapeMenuPlacement({
    isOpen: isChartMenuOpen,
    setIsOpen: setIsChartMenuOpen,
    setPosition: setChartMenuPosition
  });
  const elementContextMenu = useEditorShellUiStore((state) => state.elementContextMenu);
  const setElementContextMenu = useEditorShellUiStore(
    (state) => state.setElementContextMenu
  );
  const [semanticCueExtractionState, setSemanticCueExtractionState] =
    useState<SemanticCueExtractionUiState>({ status: "idle", message: "" });
  const [exportDialogFormat, setExportDialogFormat] =
    useState<DeckExportFormat>("pptx");
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isActivityQrInsertOpen, setIsActivityQrInsertOpen] = useState(false);
  const [isTargetDurationOpen, setIsTargetDurationOpen] = useState(false);
  const editorStageRef = useRef<Konva.Stage | null>(null);
  const panelStateBeforeRehearsalRef = useRef<{
    isRightPanelOpen: boolean;
    isSlidesPaneCollapsed: boolean;
  } | null>(null);

  const health = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false
  });

  const deckQuery = useQuery({
    queryKey: ["deck", projectId],
    queryFn: () => fetchDeck(projectId),
    retry: false
  });
  const autoSlideQuestionGuides = useAutoSlideQuestionGuides({
    canGenerate: canMutateDeck,
    persistedDeck: deckQuery.data,
    projectId,
  });
  const pptxImportQualityQuery = useQuery({
    queryKey: ["deck-import-quality", projectId],
    queryFn: () => fetchPptxImportQuality(projectId),
    enabled:
      Boolean(deckQuery.data?.projectId) &&
      deckQuery.data?.metadata.sourceType === "import",
    retry: false
  });
  const {
    refreshChangedSlideThumbnails,
    renderingDeck,
    slideThumbnailUrls,
    stageRefs: slideRenderStageRefs,
    uploadRehearsalSlideSnapshots
  } = useSlideRenderPipeline({
    persistedDeck: deckQuery.data,
    projectId
  });
  const {
    actions: speakerNotesPanelActions,
    refs: speakerNotesPanelRefs,
    state: speakerNotesPanelState
  } = useSpeakerNotesPanelLayout({ projectId });
  const { contentRef: speakerNotesContentRef } = speakerNotesPanelRefs;
  const {
    height: speakerNotesPanelHeight,
    isExpanded: isSpeakerNotesPanelExpanded,
    isMaximized: isSpeakerNotesPanelMaximized,
    isResizing: isSpeakerNotesPanelResizing
  } = speakerNotesPanelState;

  useEffect(() => {
    resetProjectUiState();
    setPropertiesOpenRequestId(0);
    setAssistantOpenRequestId(0);
    setAiPanelView("chat");
    setAiChatState(createInitialAiChatState(projectId));
    setValidationRepairStatus("");
    setSemanticCueExtractionState({ status: "idle", message: "" });
  }, [projectId, resetProjectUiState]);

  const loadedDeck = deckQuery.data ?? fallbackDeck;
  const {
    actions: editorDocumentActions,
    refs: editorDocumentRefs,
    state: editorDocumentState
  } = useEditorDocumentController({
    currentSlideId,
    loadedDeck,
    onHydratedProjectChange: () => {
      setCurrentSlideId(null);
      setSelectedElementIds([]);
      setEditingElementId(null);
      setCustomShapeEditElementId(null);
      setElementContextMenu(null);
    },
    onManualSaveStart: () => setActiveTopMenu(null),
    persistedDeck: deckQuery.data,
    projectId,
    refetchDeck: async () => {
      await deckQuery.refetch();
    }
  });
  const {
    deck,
    lastPatchLabel,
    lastSavedAt,
    redoStack,
    saveErrorCode,
    saveErrorMessage,
    saveState,
    undoStack
  } = editorDocumentState;
  const {
    pendingPatchInputsRef,
    persistedBaseDeckRef,
    saveQueueRef,
    workingDeckRef
  } = editorDocumentRefs;
  const {
    applyPersistedDeck,
    commitPatch,
    flush: flushPendingSavesBeforeManualAction,
    flushAndGetPersistedDeck,
    flushPendingSaveBatch,
    flushScheduledUndoRedoPersist,
    setLastPatchLabel,
    setLastSavedAt,
    setRedoStack,
    setSaveError,
    setSaveState,
    setUndoStack
  } = editorDocumentActions;
  const {
    canManageShare,
    handleShareInvite,
    handleShareMemberRemoval,
    handleShareMemberRoleChange,
    handleShareRequestStatus,
    isShareLoading,
    isSharePanelOpen,
    isSharePermissionLoading,
    openSharePanel,
    setIsSharePanelOpen,
    setShareAccessTab,
    setShareInviteEmail,
    setShareInviteRole,
    shareAccessTab,
    shareActionError,
    shareActionLabel,
    shareInviteEmail,
    shareInviteRole,
    shareMembers,
    shareRequests
  } = useProjectShareAccess({
    projectId: deckQuery.data?.projectId ?? projectId,
    toErrorMessage: toEditorErrorMessage,
    workspaceId: demoIds.workspaceId
  });
  const isUsingFallbackDeck = !deckQuery.data;
  const isDeckLoading = deckQuery.isPending;
  const isDeckError = deckQuery.isError;
  const canOpenAudienceLink =
    Boolean(deckQuery.data?.projectId) &&
    !isDeckLoading &&
    !isDeckError;
  const resolvedCurrentSlideId = resolveSelectedSlideId(deck.slides, currentSlideId);
  const currentSlideIndex = resolvedCurrentSlideId
    ? deck.slides.findIndex((slide) => slide.slideId === resolvedCurrentSlideId)
    : -1;
  const currentSlide =
    currentSlideIndex >= 0 ? deck.slides[currentSlideIndex] ?? null : null;
  const slideRailItems = useMemo(
    () => buildSlideRailItems(deck.slides, resolvedCurrentSlideId),
    [deck.slides, resolvedCurrentSlideId]
  );
  const canEditCurrentSlideCanvas = canEditSlideCanvas(currentSlide);

  useEffect(() => {
    if (canEditCurrentSlideCanvas) return;
    setInsertTool("select");
    setIsChartMenuOpen(false);
    setIsShapeMenuOpen(false);
    setIsAnimationPanelOpen(false);
    setSelectedElementIds([]);
    setEditingElementId(null);
    setCustomShapeEditElementId(null);
    setElementContextMenu(null);
  }, [
    canEditCurrentSlideCanvas,
    currentSlide?.slideId,
    setCustomShapeEditElementId,
    setEditingElementId,
    setElementContextMenu,
    setInsertTool,
    setIsAnimationPanelOpen,
    setIsChartMenuOpen,
    setIsShapeMenuOpen,
    setSelectedElementIds
  ]);
  const {
    enter: enterSlideRehearsal,
    exit: exitSlideRehearsal,
    moveToNextSentence: moveSlideRehearsalToNextSentence,
    moveToPreviousSentence: moveSlideRehearsalToPreviousSentence,
    skipCurrentSentence: skipCurrentSlideRehearsalSentence,
    start: startSlideRehearsal,
    state: slideRehearsalState,
    stop: stopSlideRehearsal
  } = useEditorSlideRehearsal({ projectId });
  const isSlideRehearsalActive = Boolean(slideRehearsalState.activeSlideId);
  const rehearsalSlide =
    deck.slides.find(
      (slide) => slide.slideId === slideRehearsalState.activeSlideId
    ) ?? currentSlide;
  const slidePracticeSession = useSlidePracticeSession({
    beforeStart: flushAndGetPersistedDeck,
    projectId,
    deckId: deck.deckId,
    deckVersion: deck.version,
    slideId: rehearsalSlide?.slideId ?? null,
    slideOrder: rehearsalSlide?.order ?? 0,
    slideContentHashInput: rehearsalSlide
      ? slideQuestionGuideTextHashInput(rehearsalSlide)
      : null
  });
  const [practiceReportRefreshToken, setPracticeReportRefreshToken] = useState(0);
  const [practiceCelebrationSessionId, setPracticeCelebrationSessionId] =
    useState<string | null>(null);
  const [requestedSpeakerNotesTab, setRequestedSpeakerNotesTab] =
    useState<SpeakerNotesTab | null>(null);
  const handledPracticeReportIdRef = useRef<string | null>(null);

  useEffect(() => {
    const practiceSessionId = slidePracticeSession.report?.practiceSessionId;
    if (
      !practiceSessionId ||
      handledPracticeReportIdRef.current === practiceSessionId
    ) {
      return;
    }
    handledPracticeReportIdRef.current = practiceSessionId;
    setPracticeCelebrationSessionId(practiceSessionId);
    setPracticeReportRefreshToken((current) => current + 1);
    setRequestedSpeakerNotesTab("report");
    speakerNotesPanelActions.requestHeight(reportSpeakerNotesPanelHeight);
    void handleExitSlideRehearsal({ force: true });
  }, [slidePracticeSession.report?.practiceSessionId]);

  useEffect(() => {
    setPracticeCelebrationSessionId(null);
  }, [resolvedCurrentSlideId]);

  const handlePracticeCelebrationConsumed = useCallback((sessionId: string) => {
    setPracticeCelebrationSessionId((current) => (
      current === sessionId ? null : current
    ));
  }, []);

  useEffect(() => {
    if (
      slidePracticeSession.state !== "stopping" ||
      slideRehearsalState.status !== "listening"
    ) {
      return;
    }
    void stopSlideRehearsal();
  }, [
    slidePracticeSession.state,
    slideRehearsalState.status,
    stopSlideRehearsal
  ]);

  function handleSelectSlideForNavigator(slideId: string) {
    const index = deck.slides.findIndex((slide) => slide.slideId === slideId);
    if (index < 0) return;
    if (!isSlideRehearsalActive) {
      handleSelectSlide(slideId);
      return;
    }
    if (slideId === resolvedCurrentSlideId) return;

    const nextSlide = deck.slides[index];
    if (!nextSlide) return;
    if (
      slidePracticeSession.state === "starting" ||
      slidePracticeSession.state === "recording" ||
      slidePracticeSession.state === "stopping"
    ) {
      return;
    }

    resetSpeakerNotesEditState(nextSlide.speakerNotes);
    speakerNotesEditorActions.closeAssistant();
    setCurrentSlideId(slideId);
    slidePracticeSession.reset();
    enterSlideRehearsal(nextSlide);
  }
  const {
    actions: speakerNotesEditorActions,
    state: speakerNotesEditorState
  } = useSpeakerNotesEditor({
    commitPatch,
    currentSlide,
    deck,
    flushPendingSaves: flushPendingSavesBeforeManualAction,
    onClearSelectedKeyword: clearSelectedKeyword,
    onExpandPanel: speakerNotesPanelActions.expand,
    persistedProjectId: deckQuery.data?.projectId,
    projectId,
    workingDeckRef
  });
  const {
    assistantError: speakerNotesAssistantError,
    assistantMode: speakerNotesAssistantMode,
    assistantOccurrenceWarning: speakerNotesAssistantOccurrenceWarning,
    assistantResult: speakerNotesAssistantResult,
    assistantSource: speakerNotesAssistantSource,
    assistantStatus: speakerNotesAssistantStatus,
    draft: speakerNotesDraft,
    guidance: speakerNotesLengthGuidance,
    isAssistantOpen: isSpeakerNotesAssistantOpen,
    isEditing: isSpeakerNotesEditing
  } = speakerNotesEditorState;
  const setSpeakerNotesDraft = speakerNotesEditorActions.setDraft;
  const setSpeakerNotesAssistantMode = speakerNotesEditorActions.setAssistantMode;
  const handleApplySpeakerNotesSuggestion = speakerNotesEditorActions.applySuggestion;
  const handleCancelSpeakerNotesEdit = speakerNotesEditorActions.cancelEdit;
  const handleGenerateSpeakerNotesSuggestion = speakerNotesEditorActions.generateSuggestion;
  const handleOpenSpeakerNotesAssistant = speakerNotesEditorActions.openAssistant;
  const handleSaveSpeakerNotesEdit = speakerNotesEditorActions.saveEdit;
  const handleStartSpeakerNotesEdit = speakerNotesEditorActions.startEdit;
  const getSpeakerNotesPanelMaxHeight = speakerNotesPanelActions.getMaxHeight;
  const handleToggleSpeakerNotesPanel = speakerNotesPanelActions.toggle;
  const handleRequestKeywordOccurrence = useCallback(() => {
    setRequestedSpeakerNotesTab("script");
    speakerNotesPanelActions.expand();
    requestAnimationFrame(() => {
      speakerNotesContentRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    });
  }, [speakerNotesContentRef, speakerNotesPanelActions]);
  function handleSpeakerNotesTabSelected(tab: SpeakerNotesTab) {
    setRequestedSpeakerNotesTab(null);
    if (tab === "report") {
      speakerNotesPanelActions.requestHeight(reportSpeakerNotesPanelHeight);
    }
  }
  const handleSpeakerNotesResizeStart = (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => speakerNotesPanelActions.handleResizeStart(event, isSpeakerNotesEditing);
  const handleSpeakerNotesResizeKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) => speakerNotesPanelActions.handleResizeKeyDown(event, isSpeakerNotesEditing);
  function commitSpeakerNotesDraftIfDirty() {
    return speakerNotesEditorActions.commitDraftIfDirty();
  }
  function confirmDiscardSpeakerNotesDraft() {
    return speakerNotesEditorActions.confirmDiscardDraft();
  }
  function resetSpeakerNotesEditState(notes: string) {
    speakerNotesEditorActions.resetEditState(notes);
  }
  function handleSelectSlide(slideId: string) {
    if (slideId === resolvedCurrentSlideId) return;
    if (!confirmDiscardSpeakerNotesDraft()) return;
    const nextSlide = deck.slides.find((slide) => slide.slideId === slideId);
    if (!nextSlide) return;
    resetSpeakerNotesEditState(nextSlide.speakerNotes);
    speakerNotesEditorActions.closeAssistant();
    setCurrentSlideId(slideId);
  }
  const {
    actions: editorFileTransferActions,
    refs: editorFileTransferRefs,
    state: editorFileTransferState
  } = useEditorFileTransfer({
    commitPatch,
    onClearSelectedKeyword: clearSelectedKeyword,
    onCloseContextMenu: () => setElementContextMenu(null),
    onImportedDeck: (importedDeck) => {
      editorDocumentActions.hydrateFromServer(importedDeck);
      setCurrentSlideId(importedDeck.slides[0]?.slideId ?? null);
      resetSpeakerNotesEditState(importedDeck.slides[0]?.speakerNotes ?? "");
      setUndoStack([]);
      setRedoStack([]);
      setSelectedElementIds([]);
      setEditingElementId(null);
      setCustomShapeEditElementId(null);
      setElementContextMenu(null);
      setLastPatchLabel(`PPTX 가져오기 · v${importedDeck.version}`);
      setSaveState("manual-saved");
      setSaveError(null, null);
    },
    onResetEditing: () => setEditingElementId(null),
    onSelectElement: (elementId) => setSelectedElementIds([elementId]),
    onSelectSlide: (index) => {
      const slideId = workingDeckRef.current.slides[index]?.slideId;
      if (slideId) handleSelectSlide(slideId);
    },
    onSetSelectTool: () => setInsertTool("select"),
    persistedProjectId: deckQuery.data?.projectId,
    rehydratedPptxImportQuality: pptxImportQualityQuery.data,
    prepareForImport: async () => {
      pendingPatchInputsRef.current = [];
      await saveQueueRef.current.catch(() => undefined);
    },
    projectId,
    refetchDeck: async () => (await deckQuery.refetch()).data,
    workingDeckRef
  });
  const { imageFileInputRef, pptxFileInputRef } = editorFileTransferRefs;
  const {
    imageUploadError,
    imageUploadStatus,
    isImageUploadPending,
    isPptxExporting,
    pptxExportError,
    pptxExportStatus,
    pendingPptxImportFile,
    pptxImportState
  } = editorFileTransferState;
  const openImageFilePicker = editorFileTransferActions.openImageFilePicker;
  const insertImageFiles = editorFileTransferActions.insertImageFiles;
  const handleImageFileInputChange = editorFileTransferActions.handleImageFileInputChange;
  const handlePptxFileInputChange = editorFileTransferActions.handlePptxFileInputChange;
  function openPptxFilePicker() {
    setActiveTopMenu(null);
    editorFileTransferActions.openPptxFilePicker();
  }
  const hasBlockingEditorDialog = Boolean(
    isAudienceLinkModalOpen ||
    isActivityQrInsertOpen ||
    isExitConfirmOpen ||
    isExportDialogOpen ||
    isTargetDurationOpen ||
    isPresenceDebugOpen ||
    isSharePanelOpen ||
    isSpeakerNotesAssistantOpen ||
    Boolean(pendingPptxImportFile)
  );
  const {
    activeStartAction: activePresentationAction,
    startPresentation: handleStartPresentation,
    startRehearsal: handleStartFullRehearsal
  } = useEditorPresentationActions({
    applyPersistedDeck,
    commitSpeakerNotesDraftIfDirty,
    flushPendingSaves: flushPendingSavesBeforeManualAction,
    isDeckLoading,
    persistedBaseDeckRef,
    persistedDeck: deckQuery.data,
    projectId,
    setActiveTopMenuClosed: () => setActiveTopMenu(null),
    setLastPatchLabel,
    setLastSavedAt,
    setSaveError,
    setSaveState,
    uploadRehearsalSlideSnapshots,
    workingDeckRef
  });
  const canStartPresentation =
    canOpenAudienceLink && !activePresentationAction && !isSlideRehearsalActive;
  const saveStatusLabel = getEditorStatusLabel({
    isDeckError,
    isDeckLoading,
    isUsingFallbackDeck,
    saveState
  });
  function hasUnsavedEditorChanges() {
    return editorDocumentActions.hasUnsavedChanges();
  }
  const visibleElements = currentSlide
    ? getRenderableSlideElements(currentSlide, deck.canvas)
    : [];
  const editorValidationItems = useMemo(
    () => getEditorValidationItems(deck),
    [deck]
  );
  const presentedEditorValidationItems = useMemo(
    () => presentEditorValidationItems(deck, editorValidationItems),
    [deck, editorValidationItems]
  );
  const safeTextOverflowRepair = useMemo(
    () => createSafeTextOverflowRepair({ deck, items: editorValidationItems }),
    [deck, editorValidationItems]
  );
  const {
    canvasViewportRef: editorCanvasViewportRef,
    editorViewportWidth,
    fitStageToViewport,
    isStageFitToViewport,
    stageScale,
    zoom: editorZoom,
    zoomIn: zoomCanvasIn,
    zoomOut: zoomCanvasOut
  } = useEditorViewport({
    canvas: deck.canvas,
    isRightPanelOpen,
    projectId,
    setIsRightPanelOpen
  });
  const currentSlideAnimations = useMemo(
    () =>
      currentSlide
        ? [...currentSlide.animations].sort(
            (left, right) => left.order - right.order
          )
        : [],
    [currentSlide]
  );
  const animationMutationDisabledReason = currentSlide
    ? getAnimationMutationDisabledReason(deck, currentSlide)
    : null;
  const transitionMutationDisabledReason = currentSlide
    ? getTransitionMutationDisabledReason(deck, currentSlide)
    : null;
  const currentSlideKeywordActionUsage = useMemo(
    () =>
      currentSlide
        ? deriveKeywordActionUsage(currentSlide)
        : { byKeywordId: {}, byOccurrenceId: {} },
    [currentSlide]
  );
  const currentSlideKeywordUsage = currentSlideKeywordActionUsage.byKeywordId;
  const animationPanelKeywordOptions = useMemo(
    () => toAnimationKeywordTriggerOptions(currentSlide?.keywords ?? []),
    [currentSlide?.keywords]
  );
  const selectedKeyword =
    currentSlide?.keywords.find(
      (keyword) => keyword.keywordId === selectedKeywordId
    ) ?? null;
  const selectedKeywordUsage = selectedKeyword
    ? selectedKeywordOccurrenceKey
      ? currentSlideKeywordActionUsage.byOccurrenceId[
          selectedKeywordOccurrenceKey
        ] ?? {
          keywordId: selectedKeyword.keywordId,
          occurrenceId: selectedKeywordOccurrenceKey,
          animationIds: [],
          advancesSlide: false
        }
      : currentSlideKeywordUsage[selectedKeyword.keywordId] ?? null
    : null;
  const selectedKeywordRequiredActive = selectedKeyword
    ? selectedKeywordOccurrenceKey
      ? (selectedKeyword.requiredOccurrenceIds ?? []).includes(
          selectedKeywordOccurrenceKey
        )
      : selectedKeyword.required
    : false;
  const selectedElementId = selectedElementIds.at(-1) ?? null;
  const selectedElements = visibleElements.filter((element) =>
    selectedElementIds.includes(element.elementId)
  );
  const selectedElement =
    selectedElementIds.length === 1
      ? selectedElements.find((element) => element.elementId === selectedElementId) ?? null
      : null;
  const imageCropActionState = getImageCropActionState(deck, selectedElement);
  const isCropEditing =
    selectedElement?.type === "image" &&
    selectedElement.elementId === imageCropElementId;
  const selectionInspectorCompactMode =
    resolveSelectionInspectorCompactMode(editorViewportWidth);
  const selectionInspectorModel = useMemo(
    () =>
      createSelectionInspectorModel({
        compact: selectionInspectorCompactMode,
        currentSlideElementIds: visibleElements.map((element) => element.elementId),
        origin: "canvas",
        selectedElementIds
      }),
    [selectionInspectorCompactMode, selectedElementIds, visibleElements]
  );
  const isCompactEditorLayout = selectionInspectorCompactMode === true;
  function setCurrentSlideIndex(index: number) {
    setCurrentSlideId(workingDeckRef.current.slides[index]?.slideId ?? null);
  }
  const {
    actions: editorCanvasActions,
    refs: editorCanvasRefs
  } = useEditorCanvasCommands({
    commitPatch,
    confirmDiscardSpeakerNotesDraft,
    currentSlide,
    deck,
    resetSpeakerNotesEditState,
    selectedElement,
    selectedElementIds,
    selectedElements,
    setCurrentSlideIndex,
    setCustomShapeEditElementId,
    setEditingElementId,
    setElementContextMenu,
    setInsertTool,
    setIsShapeMenuOpen,
    setLastPatchLabel,
    setSelectedElementIds,
    workingDeckRef
  });
  const { copiedElementRef } = editorCanvasRefs;
  const handleAddChartElement = editorCanvasActions.addChartElement;
  const handleAddSlide = editorCanvasActions.addSlide;
  const handleAddActivitySlide = editorCanvasActions.addActivitySlide;
  const handleAddActivityResultsSlide =
    editorCanvasActions.addActivityResultsSlide;
  const handleAddActivityQrElement = editorCanvasActions.addActivityQrElement;
  const handleAddActivityRuntimeElement =
    editorCanvasActions.addActivityRuntimeElement;
  const handleAddTextElement = editorCanvasActions.addTextElement;
  const handleCanvasBackgroundSelectionClear = editorCanvasActions.clearCanvasSelection;
  const handleCommitCustomShapeGeometry = editorCanvasActions.commitCustomShapeGeometry;
  const handleConvertChartToTable = editorCanvasActions.convertChartToTable;
  const handleCopySelectedElement = editorCanvasActions.copySelectedElement;
  const handleCreateCustomShape = editorCanvasActions.createCustomShape;
  const handleCreateDrawnElement = editorCanvasActions.createDrawnElement;
  const handleCreateGroupFromSelection = editorCanvasActions.createGroupFromSelection;
  const handleDeleteSelectedElement = editorCanvasActions.deleteSelectedElement;
  const handleDuplicateSelectedElement = editorCanvasActions.duplicateSelectedElement;
  const handleElementFrameChange = editorCanvasActions.changeElementFrame;
  const handleElementLayerOrderChange =
    editorCanvasActions.changeElementLayerOrder;
  const handleInsertShapeElement = editorCanvasActions.insertShapeElement;
  const handleOpenElementContextMenu = editorCanvasActions.openElementContextMenu;
  const handlePasteCopiedElement = editorCanvasActions.pasteCopiedElement;
  const handleUngroupElement = editorCanvasActions.ungroupElement;
  const editorSlideActions = useEditorSlideCommands({
    commitPatch,
    currentSlide,
    currentSlideKeywordUsage,
    deck,
    selectedKeywordId,
    selectedKeywordOccurrenceKey,
    setAnimationPanelFocusedAnimationId,
    setLastPatchLabel,
    setSelectedKeywordId,
    setSelectedKeywordOccurrenceKey,
    workingDeckRef
  });
  const handleAddAnimation = editorSlideActions.addAnimation;
  const handleElementPropsChange = editorSlideActions.changeElementProps;
  const handleSlideStyleChange = editorSlideActions.changeSlideStyle;
  const handleThemeChange = editorSlideActions.changeTheme;
  const handleDeleteAnimation = editorSlideActions.deleteAnimation;
  const handleDeleteSelectedKeyword = editorSlideActions.deleteSelectedKeyword;
  const handleSpeakerNotesKeywordSelection =
    editorSlideActions.selectSpeakerNotesKeyword;
  const handleSelectKeyword = editorSlideActions.selectKeyword;
  const handleToggleAdvanceSlideKeyword =
    editorSlideActions.toggleAdvanceSlideKeyword;
  const handleToggleKeywordRequired = editorSlideActions.toggleKeywordRequired;
  const handleUpdateAnimation = editorSlideActions.updateAnimation;
  const handleUpdateSlideTransition = editorSlideActions.updateSlideTransition;
  function clearSelectedKeyword() {
    editorSlideActions.clearSelectedKeyword();
  }
  function handleSelectKeywordActionMode(
    mode: KeywordActionMode,
    selection: KeywordSelectionContext | null = null
  ) {
    const keywordId = selection?.keywordId ?? selectedKeyword?.keywordId ?? null;
    const occurrenceKey =
      selection?.occurrenceKey ?? selectedKeywordOccurrenceKey ?? null;
    const keyword =
      currentSlide?.keywords.find((candidate) => candidate.keywordId === keywordId) ??
      selectedKeyword;
    const usage = occurrenceKey
      ? currentSlideKeywordActionUsage.byOccurrenceId[occurrenceKey] ?? {
          advancesSlide: false,
          animationIds: [],
          keywordId: keywordId ?? "",
          occurrenceId: occurrenceKey
        }
      : keywordId
        ? currentSlideKeywordUsage[keywordId] ?? null
        : selectedKeywordUsage;
    const requiredActive = keyword
      ? occurrenceKey
        ? (keyword.requiredOccurrenceIds ?? []).includes(occurrenceKey)
        : keyword.required
      : selectedKeywordRequiredActive;

    if (mode === "animation-trigger") {
      openAnimationInspector();
      return;
    }

    if (!currentSlide || !keywordId) {
      return;
    }

    if (mode === "required-keyword") {
      if (!requiredActive) {
        handleToggleKeywordRequired(
          currentSlide.slideId,
          keywordId,
          occurrenceKey
        );
      }
      if (usage?.advancesSlide) {
        handleToggleAdvanceSlideKeyword(
          currentSlide.slideId,
          keywordId,
          false
        );
      }
      return;
    }

    if (mode === "advance-slide") {
      if (requiredActive) {
        handleToggleKeywordRequired(
          currentSlide.slideId,
          keywordId,
          occurrenceKey
        );
      }
      if (!(usage?.advancesSlide ?? false)) {
        handleToggleAdvanceSlideKeyword(
          currentSlide.slideId,
          keywordId,
          true,
          occurrenceKey
        );
      }
    }
  }

  function handleValidationTargetFocus(target: EditorValidationTargetView) {
    if (target.status !== "resolved" || !target.slideId) return;

    const activeDeck = workingDeckRef.current;
    const nextSlide = activeDeck.slides.find(
      (candidate) => candidate.slideId === target.slideId
    );
    if (!nextSlide) return;

    if (target.slideId !== resolvedCurrentSlideId) {
      if (!confirmDiscardSpeakerNotesDraft()) {
        setValidationHighlightElementIds([]);
        return;
      }
      resetSpeakerNotesEditState(nextSlide.speakerNotes);
      speakerNotesEditorActions.closeAssistant();
      setCurrentSlideId(target.slideId);
    }

    setSelectedElementIds(target.elementIds);
    setValidationHighlightElementIds(target.elementIds);
    clearSelectedKeyword();
    setEditingElementId(null);
    setCustomShapeEditElementId(null);
    setElementContextMenu(null);
    setAiPanelView("tools");
    setIsRightPanelOpen(true);
  }

  function handleSafeTextOverflowRepair(onlyElementIds?: readonly string[]) {
    if (!canMutateDeck) return;

    const activeDeck = workingDeckRef.current;
    const result = createSafeTextOverflowRepair({
      deck: activeDeck,
      items: getEditorValidationItems(activeDeck),
      onlyElementIds
    });
    if (!result.patch || result.repairedElementIds.length === 0) {
      setValidationRepairStatus("안전 수정 가능한 텍스트 넘침이 없습니다.");
      return;
    }

    const committed = commitPatch(result.patch, activeDeck);
    if (!committed) {
      setValidationRepairStatus(
        "텍스트 넘침 안전 수정을 적용하지 못했습니다. 다시 시도해 주세요."
      );
      return;
    }

    const repairedElementIdSet = new Set(result.repairedElementIds);
    const repairedOnCurrentSlide = activeDeck.slides
      .find((slide) => slide.slideId === resolvedCurrentSlideId)
      ?.elements.filter((element) =>
        repairedElementIdSet.has(element.elementId)
      )
      .map((element) => element.elementId) ?? [];
    setSelectedElementIds(repairedOnCurrentSlide);
    setValidationHighlightElementIds(repairedOnCurrentSlide);
    setValidationRepairStatus(
      `텍스트 넘침 ${result.repairedElementIds.length}개를 안전 수정했습니다. 실행 취소로 되돌릴 수 있습니다.`
    );
  }
  const selectedAnimationPanelElement =
    selectedElement ??
    (selectedElementIds.length === 1
      ? currentSlide?.elements.find(
          (element) => element.elementId === selectedElementId
        ) ?? null
      : null);
  const selectedElementAnimations = useMemo(
    () =>
      currentSlide && selectedAnimationPanelElement
        ? getElementAnimations(currentSlide, selectedAnimationPanelElement.elementId)
        : [],
    [currentSlide, selectedAnimationPanelElement]
  );
  const animationKeywordTriggerPolicy = useMemo(
    () =>
      buildAnimationKeywordTriggerPolicy({
        element: selectedAnimationPanelElement,
        keywordId: selectedKeywordId,
        keywordOccurrenceId: selectedKeywordOccurrenceKey,
        slideAnimations: currentSlide?.animations ?? [],
        usageByKeywordId: currentSlideKeywordUsage
      }),
    [
      currentSlide?.animations,
      currentSlideKeywordUsage,
      selectedAnimationPanelElement,
      selectedKeywordId,
      selectedKeywordOccurrenceKey
    ]
  );
  const currentSlideAnimationDiagnostics = useMemo(
    () =>
      currentSlide
        ? validateSlideAnimations(currentSlide, selectedAnimationPanelElement?.elementId)
        : null,
    [currentSlide, selectedAnimationPanelElement?.elementId]
  );
  const {
    canPlay: canPlayCurrentSlideAnimations,
    elementStates: animationPreviewElementStates,
    isPlaying: isPlayingCurrentSlideAnimations,
    play: playCurrentSlideAnimations
  } = useEditorAnimationPreview({
    deck,
    slide: currentSlide
  });

  useEffect(() => {
    setValidationHighlightElementIds([]);
  }, [currentSlide?.slideId]);

  function handleExitToHome() {
    if (hasUnsavedEditorChanges()) {
      setActiveTopMenu(null);
      setIsExitConfirmOpen(true);
      return;
    }

    setActiveTopMenu(null);
    navigateToHome();
  }

  function handleDiscardAndExit() {
    setIsExitConfirmOpen(false);
    navigateToHome();
  }

  async function handleSaveAndExit() {
    if (isExitSaving) {
      return;
    }

    setIsExitSaving(true);

    try {
      const saved = await handleSaveDeck();

      if (!saved) {
        return;
      }

      setIsExitConfirmOpen(false);
      navigateToHome();
    } finally {
      setIsExitSaving(false);
    }
  }

  const isCustomShapeEditingSelection =
    selectedElement?.type === "customShape" &&
    selectedElement.elementId === customShapeEditElementId;
  const currentImageInsertCapability = currentSlide
    ? editorFileTransferActions.getImageInsertCapability(currentSlide.slideId)
    : null;
  const imageDropEnabled =
    !isCropEditing &&
    !isCustomShapeEditingSelection &&
    canAcceptCanvasImageDrop({
      canMutateDeck,
      hasBlockingDialog: hasBlockingEditorDialog,
      hasCurrentSlide: Boolean(currentSlide),
      inlineTextEditing: Boolean(editingElementId),
      insertCapabilityEnabled: currentImageInsertCapability?.enabled ?? false,
      isUploadPending: isImageUploadPending,
      speakerNotesEditing: isSpeakerNotesEditing
    });
  const isDev = import.meta.env.DEV;
  function handleDesignAgentProposalApplied(
    response: ApplyDesignAgentProposalResponse
  ) {
    editorDocumentActions.applyDesignProposal(response, () => {
      setSelectedElementIds([]);
      setEditingElementId(null);
      setCustomShapeEditElementId(null);
      setElementContextMenu(null);
    });
  }

  async function handleSaveDeck() {
    return editorDocumentActions.save(commitSpeakerNotesDraftIfDirty);
  }

  async function handleExportDeck(input: DeckExportRequest) {
    return editorFileTransferActions.exportDeck(handleSaveDeck, input);
  }

  function openExportDialog(format: DeckExportFormat) {
    setExportDialogFormat(format);
    setIsExportDialogOpen(true);
    setActiveTopMenu(null);
  }

  function handleSemanticCueReviewChange(semanticCues: SemanticCue[]) {
    if (!currentSlide) {
      return;
    }
    const slideId = currentSlide.slideId;
    commitPatch((currentDeck) =>
      createSemanticCueReviewPatch(currentDeck, slideId, semanticCues)
    );
  }

  async function handleSemanticCueExtraction(force: boolean) {
    if (semanticCueExtractionState.status === "running") {
      return;
    }

    setSemanticCueExtractionState({
      status: "running",
      message: "슬라이드와 발표 대본의 의미를 분석하는 중입니다."
    });

    try {
      await flushEditorPersistenceBeforeManualAction({
        flushPendingSaveBatch,
        flushScheduledUndoRedoPersist,
        hasPendingPatchInputs: () => pendingPatchInputsRef.current.length > 0,
        waitForSaveQueue: () => saveQueueRef.current
      });

      const activeProjectId = deckQuery.data?.projectId ?? projectId;
      const queuedJob = await createSemanticCueExtractionJob(
        activeProjectId,
        force
      );
      const completedJob = await waitForSemanticCueExtractionJob(queuedJob.jobId);
      if (completedJob.status === "failed") {
        throw new Error(
          completedJob.error?.message ?? "Semantic Cue extraction failed."
        );
      }

      const selectedSlideId = currentSlide?.slideId;
      const refetchResult = await deckQuery.refetch();
      const extractedDeck = refetchResult.data;
      if (extractedDeck) {
        editorDocumentActions.hydrateFromServer(extractedDeck);
        if (
          selectedSlideId &&
          extractedDeck.slides.some((slide) => slide.slideId === selectedSlideId)
        ) {
          setCurrentSlideId(selectedSlideId);
        }
        setUndoStack([]);
        setRedoStack([]);
        setLastPatchLabel(`발표 메시지 AI 분석 · v${extractedDeck.version}`);
        setSaveState("auto-saved");
        setSaveError(null, null);
      }

      setSemanticCueExtractionState({
        status: "succeeded",
        message: "AI 분석이 완료되었습니다. 제안된 메시지를 검토해 주세요."
      });
    } catch (error) {
      setSemanticCueExtractionState({
        status: "error",
        message: toEditorErrorMessage(error)
      });
    }
  }

  function requestPropertiesPanel() {
    setIsIconPanelOpen(false);
    setIsAnimationPanelOpen(false);
    setPropertiesOpenRequestId((current) => current + 1);
    setIsRightPanelOpen(true);
  }

  function openPropertiesForCanvasSelection(nextSelectedElementIds: string[]) {
    const nextInspectorModel = createSelectionInspectorModel({
      compact: selectionInspectorCompactMode,
      currentSlideElementIds: visibleElements.map((element) => element.elementId),
      origin: "canvas",
      selectedElementIds: nextSelectedElementIds
    });
    if (nextInspectorModel.shouldAutoOpenDesignInspector) {
      requestPropertiesPanel();
    }
  }

  function handleElementSelection(elementId: string, options?: { append?: boolean }) {
    setElementContextMenu(null);
    setCustomShapeEditElementId((current) =>
      current === elementId && !options?.append ? current : null
    );

    if (options?.append) {
      setEditingElementId(null);
      const nextSelectedElementIds = selectedElementIds.includes(elementId)
        ? selectedElementIds.filter(
            (currentElementId) => currentElementId !== elementId
          )
        : [...selectedElementIds, elementId];
      setSelectedElementIds(nextSelectedElementIds);
      openPropertiesForCanvasSelection(nextSelectedElementIds);
      return;
    }

    setSelectedElementIds([elementId]);
    openPropertiesForCanvasSelection([elementId]);
  }

  function handleDuplicateSlide(slideId: string) {
    if (!canMutateDeck || !commitSpeakerNotesDraftIfDirty()) return;

    let duplicateSlideId: string | null = null;
    const committed = commitPatch((currentDeck) => {
      const patch = createDuplicateSlidePatch(currentDeck, slideId);
      duplicateSlideId = getAddedSlideId(patch);
      return patch;
    });
    if (!committed || !duplicateSlideId) return;

    const duplicateSlide = workingDeckRef.current.slides.find(
      (slide) => slide.slideId === duplicateSlideId
    );
    setCurrentSlideId(duplicateSlideId);
    resetSpeakerNotesEditState(duplicateSlide?.speakerNotes ?? "");
    setSelectedElementIds([]);
    setIsDeleteUndoToastOpen(false);
    refreshChangedSlideThumbnails(workingDeckRef.current);
  }

  function handleDeleteSlide(slideId: string) {
    const activeDeck = workingDeckRef.current;
    if (!canMutateDeck || activeDeck.slides.length <= 1) return;

    const nextSelectedSlideId = resolveSelectedSlideIdAfterDelete({
      deletedSlideId: slideId,
      selectedSlideId: resolvedCurrentSlideId,
      slides: activeDeck.slides
    });
    if (
      slideId === resolvedCurrentSlideId &&
      !commitSpeakerNotesDraftIfDirty()
    ) {
      return;
    }

    const committed = commitPatch((currentDeck) =>
      createDeleteSlidePatch(currentDeck, slideId)
    );
    if (!committed) return;

    if (slideId === resolvedCurrentSlideId) {
      const nextSlide = workingDeckRef.current.slides.find(
        (slide) => slide.slideId === nextSelectedSlideId
      );
      setCurrentSlideId(nextSelectedSlideId);
      resetSpeakerNotesEditState(nextSlide?.speakerNotes ?? "");
    }
    setSelectedElementIds([]);
    setIsDeleteUndoToastOpen(true);
    refreshChangedSlideThumbnails(workingDeckRef.current);
  }

  function handleReorderSlides(orderedSlideIds: readonly string[]) {
    if (!canMutateDeck) return;
    const committed = commitPatch((currentDeck) =>
      createSlideRailReorderPatch(currentDeck, orderedSlideIds)
    );
    if (committed) setIsDeleteUndoToastOpen(false);
  }

  function handleMoveSlide(slideId: string, direction: "down" | "up") {
    const reordered = moveSlideId(
      workingDeckRef.current.slides.map((slide) => slide.slideId),
      slideId,
      direction
    );
    if (reordered) handleReorderSlides(reordered);
  }

  function handleDismissKeyboardLayer(layer: EditorEscapeLayer) {
    switch (layer) {
      case "modal":
        if (isExitConfirmOpen) {
          setIsExitConfirmOpen(false);
          return;
        }
        if (isExportDialogOpen) {
          setIsExportDialogOpen(false);
          return;
        }
        if (isTargetDurationOpen) {
          setIsTargetDurationOpen(false);
          return;
        }
        if (isSpeakerNotesAssistantOpen) {
          speakerNotesEditorActions.closeAssistant();
          return;
        }
        if (isAudienceLinkModalOpen) {
          setIsAudienceLinkModalOpen(false);
          return;
        }
        if (isPresenceDebugOpen) {
          setIsPresenceDebugOpen(false);
          return;
        }
        if (isSharePanelOpen) setIsSharePanelOpen(false);
        return;
      case "menu":
        if (elementContextMenu) {
          setElementContextMenu(null);
          return;
        }
        if (isShapeMenuOpen) {
          setIsShapeMenuOpen(false);
          return;
        }
        setActiveTopMenu(null);
        return;
      case "crop-edit":
        finishImageCrop();
        return;
      case "custom-shape-edit":
        setCustomShapeEditElementId(null);
        return;
      case "inline-text-edit":
        setEditingElementId(null);
        return;
      case "insert-tool":
        setInsertTool("select");
        return;
      case "selection":
        setSelectedElementIds([]);
    }
  }

  const historyCallbacks = {
    confirmDiscard: confirmDiscardSpeakerNotesDraft,
    onNavigate: (_nextDeck: Deck, nextSlideId: string | null) => {
      setCurrentSlideId(nextSlideId);
      setSelectedElementIds([]);
      clearSelectedKeyword();
      setEditingElementId(null);
      setCustomShapeEditElementId(null);
      setImageCropElementId(null);
      setElementContextMenu(null);
    },
    refreshThumbnails: refreshChangedSlideThumbnails,
    resetNotes: resetSpeakerNotesEditState
  };
  function handleUndo() {
    return editorDocumentActions.undo(historyCallbacks);
  }
  function handleRedo() {
    editorDocumentActions.redo(historyCallbacks);
  }

  function finishImageCrop() {
    const finishedElementId = imageCropElementId;
    setImageCropElementId(null);
    if (!finishedElementId) return;

    requestAnimationFrame(() =>
      document.getElementById(`image-crop-trigger-${finishedElementId}`)?.focus()
    );
  }

  function startImageCrop() {
    if (
      !canMutateDeck ||
      !selectedElement ||
      !imageCropActionState.enabled
    ) {
      return;
    }

    setEditingElementId(null);
    setCustomShapeEditElementId(null);
    setElementContextMenu(null);
    setImageCropElementId(selectedElement.elementId);
  }

  function openAnimationInspector() {
    setIsIconPanelOpen(false);
    setIsAnimationPanelOpen(true);
    setIsRightPanelOpen(true);
  }

  async function handleStartSlidePractice() {
    if (!rehearsalSlide) return;
    const stream = await slidePracticeSession.start();
    if (!stream) return;
    await startSlideRehearsal(rehearsalSlide, { audioSource: stream });
  }

  async function handleStopSlidePractice() {
    await stopSlideRehearsal();
    await slidePracticeSession.stop();
  }

  async function handleExitSlideRehearsal(options?: { force?: boolean }) {
    if (!options?.force) {
      if (slidePracticeSession.state === "recording") {
        await handleStopSlidePractice();
        return;
      }
      if (
        slidePracticeSession.state === "starting" ||
        slidePracticeSession.state === "stopping"
      ) {
        return;
      }
    }
    const previousPanelState = panelStateBeforeRehearsalRef.current;
    panelStateBeforeRehearsalRef.current = null;
    await exitSlideRehearsal();

    if (previousPanelState) {
      setIsSlidesPaneCollapsed(previousPanelState.isSlidesPaneCollapsed);
      setIsRightPanelOpen(previousPanelState.isRightPanelOpen);
    }
  }

  function beginSlideRehearsalMode(slide: Slide) {
    slidePracticeSession.reset();
    panelStateBeforeRehearsalRef.current = {
      isRightPanelOpen,
      isSlidesPaneCollapsed
    };
    setActiveTopMenu(null);
    setIsSlidesPaneCollapsed(false);
    setIsIconPanelOpen(false);
    setIsAnimationPanelOpen(false);
    setSelectedElementIds([]);
    setEditingElementId(null);
    setCustomShapeEditElementId(null);
    speakerNotesEditorActions.closeAssistant();
    enterSlideRehearsal(slide);
  }

  function handleToggleSlideRehearsal() {
    if (isSlideRehearsalActive) {
      void handleExitSlideRehearsal();
      return;
    }
    if (!currentSlide || !commitSpeakerNotesDraftIfDirty()) return;
    beginSlideRehearsalMode(currentSlide);
  }

  function toggleIconLibrary() {
    setIsIconPanelOpen((current) => {
      const next = !current;
      if (next) {
        setIsAnimationPanelOpen(false);
        setIsRightPanelOpen(true);
      } else {
        setIsRightPanelOpen(false);
      }
      return next;
    });
  }

  function handleSelectSlideAnimationFromPanel(animation: DeckAnimation) {
    setAnimationPanelFocusedAnimationId(animation.animationId);
    setEditingElementId(null);
    setCustomShapeEditElementId(null);
    setElementContextMenu(null);
    setSelectedElementIds([animation.elementId]);
  }

  function handleSlidesPaneResizeStart(
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    beginHorizontalPaneResize({
      direction: "expand-right",
      event,
      maxWidth: maxSlidesPaneWidth,
      minWidth: minSlidesPaneWidth,
      onResizeStart: () => setIsSlidesPaneCollapsed(false),
      onWidthChange: setSlidesPaneWidth,
      startWidth: isSlidesPaneCollapsed ? minSlidesPaneWidth : slidesPaneWidth
    });
  }

  function handleRightPaneResizeStart(
    event: ReactPointerEvent<HTMLButtonElement>
  ) {
    beginHorizontalPaneResize({
      direction: "expand-left",
      event,
      maxWidth: maxRightPaneWidth,
      minWidth: minRightPaneWidth,
      onWidthChange: setRightPaneWidth,
      startWidth: rightPaneWidth
    });
  }

  useEffect(() => {
    if (
      selectedKeywordId &&
      !currentSlide?.keywords.some(
        (keyword) => keyword.keywordId === selectedKeywordId
      )
    ) {
      clearSelectedKeyword();
    }
  }, [currentSlide, selectedKeywordId]);

  useEffect(() => {
    panelStateBeforeRehearsalRef.current = null;
    void exitSlideRehearsal();
  }, [exitSlideRehearsal, projectId]);

  useEffect(() => {
    setSelectedElementIds((current) =>
      current.filter((elementId) =>
        currentSlide?.elements.some((element) => element.elementId === elementId)
      )
    );
  }, [currentSlide]);

  useEffect(() => {
    if (
      customShapeEditElementId &&
      (selectedElementIds.length !== 1 ||
        selectedElementId !== customShapeEditElementId ||
        selectedElement?.type !== "customShape")
    ) {
      setCustomShapeEditElementId(null);
    }
  }, [
    customShapeEditElementId,
    selectedElement,
    selectedElementId,
    selectedElementIds.length
  ]);

  useEffect(() => {
    if (
      imageCropElementId &&
      (!isCropEditing || !imageCropActionState.enabled)
    ) {
      setImageCropElementId(null);
    }
  }, [imageCropActionState.enabled, imageCropElementId, isCropEditing]);

  useEffect(() => {
    if (resolvedCurrentSlideId !== currentSlideId) {
      setCurrentSlideId(resolvedCurrentSlideId);
    }
  }, [currentSlideId, resolvedCurrentSlideId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    // Test hook for reliable Playwright frame updates when Konva anchors are too brittle.
    window.__ORBIT_EDITOR_TEST_API__ = {
      updateSelectedElementFrame: (frame) => {
        if (!selectedElement || !currentSlide) {
          return false;
        }

        handleElementFrameChange(currentSlide.slideId, selectedElement.elementId, frame);
        return true;
      },
      updateCurrentSlideStyle: (style) => {
        if (!currentSlide) {
          return false;
        }

        handleSlideStyleChange(currentSlide.slideId, style);
        return true;
      }
    };

    return () => {
      delete window.__ORBIT_EDITOR_TEST_API__;
    };
  }, [currentSlide, selectedElement]);

  function handleDistributeSelection(axis: DistributeAxis) {
    if (!currentSlide || !canMutateDeck) return;
    const patch = createDistributeSelectionPatch(
      workingDeckRef.current,
      currentSlide,
      selectedElements,
      axis
    );
    if (patch) commitPatch(patch);
  }

  function handleAlignSelection(alignment: SelectionAlignment) {
    if (!currentSlide || !canMutateDeck) return;
    const patch = createAlignSelectionPatch(
      workingDeckRef.current,
      currentSlide,
      selectedElements,
      alignment
    );
    if (patch) commitPatch(patch);
  }

  function handleOpenCompactSelectionInspector() {
    requestPropertiesPanel();
    requestAnimationFrame(() => selectionInspectorRef.current?.focus());
  }

  function handleSelectionInspectorEscape() {
    if (isCompactEditorLayout) {
      setIsRightPanelOpen(false);
      requestAnimationFrame(() => compactSelectionTriggerRef.current?.focus());
      return;
    }

    requestAnimationFrame(() =>
      document.getElementById("editor-properties-panel-tab")?.focus()
    );
  }

  function renderSelectionInspector() {
    const sharedProperties = {
      animations: selectedElementAnimations,
      animationDiagnostics: currentSlideAnimationDiagnostics,
      canvas: deck.canvas,
      customShapeEditActive: isCustomShapeEditingSelection,
      deckSourceType: deck.metadata.sourceType,
      imageCropActionState,
      onChangeElementFrame: handleElementFrameChange,
      onChangeElementLayerOrder: handleElementLayerOrderChange,
      onChangeElementProps: handleElementPropsChange,
      onConvertChartToTable: handleConvertChartToTable,
      onChangeSlideStyle: (style: {
        accentColor?: string | null;
        backgroundColor?: string | null;
        textColor?: string | null;
      }) => {
        if (currentSlide) handleSlideStyleChange(currentSlide.slideId, style);
      },
      onChangeTheme: handleThemeChange,
      onCloseInlineEditing: () => setEditingElementId(null),
      onCommitCustomShapeGeometry: handleCommitCustomShapeGeometry,
      onDeleteAnimation: handleDeleteAnimation,
      onOpenAnimationEditor: openAnimationInspector,
      onStartImageCrop: startImageCrop,
      onToggleCustomShapeEdit: (elementId: string) =>
        setCustomShapeEditElementId((current) =>
          current === elementId ? null : elementId
        ),
      selectedKeywordLabel: selectedKeyword?.text ?? null,
      showIds,
      theme: deck.theme
    };

    return (
      <SelectionInspector
        canEdit={canMutateDeck && canEditCurrentSlideCanvas}
        elementControls={
          selectedElement ? (
            <EditorSelectionProperties
              {...sharedProperties}
              element={selectedElement}
              slide={currentSlide}
            />
          ) : null
        }
        elementLabel={selectedElement?.type}
        focusRef={selectionInspectorRef}
        model={selectionInspectorModel}
        multiControls={
          <MultiSelectionQuickBar
            canAlign={
              selectionInspectorModel.selectedCount >= 2 &&
              selectedElements.every((element) => !element.locked)
            }
            canDistribute={
              selectionInspectorModel.selectedCount >= 3 &&
              selectedElements.every((element) => !element.locked)
            }
            selectedCount={selectionInspectorModel.selectedCount}
            onAlignBottom={() => handleAlignSelection("bottom")}
            onAlignCenterX={() => handleAlignSelection("centerX")}
            onAlignCenterY={() => handleAlignSelection("centerY")}
            onAlignLeft={() => handleAlignSelection("left")}
            onAlignRight={() => handleAlignSelection("right")}
            onAlignTop={() => handleAlignSelection("top")}
            onDistributeX={() => handleDistributeSelection("x")}
            onDistributeY={() => handleDistributeSelection("y")}
          />
        }
        onEscape={handleSelectionInspectorEscape}
        slideControls={
          <EditorSelectionProperties
            {...sharedProperties}
            element={null}
            slide={currentSlide}
          />
        }
        slideLabel={currentSlide?.title}
      />
    );
  }

  useEditorKeyboardShortcuts({
    canMutateDeck,
    canPasteImage: imageDropEnabled,
    copiedElementRef,
    editingElementId,
    hasOpenMenu: Boolean(activeTopMenu || isShapeMenuOpen || elementContextMenu),
    hasOpenModal: hasBlockingEditorDialog,
    insertToolActive: insertTool !== "select",
    isCropEditing,
    isCustomShapeEditingSelection,
    onCopy: handleCopySelectedElement,
    onCommitInlineTextEditing: () => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) activeElement.blur();
    },
    onDelete: handleDeleteSelectedElement,
    onDismissLayer: handleDismissKeyboardLayer,
    onDuplicate: handleDuplicateSelectedElement,
    onNavigateSlide: (direction) => {
      const nextIndex = Math.min(
        deck.slides.length - 1,
        Math.max(0, currentSlideIndex + (direction === "next" ? 1 : -1))
      );
      const nextSlideId = deck.slides[nextIndex]?.slideId;
      if (nextSlideId) handleSelectSlideForNavigator(nextSlideId);
    },
    onNudge: (deltaX, deltaY) => {
      if (!currentSlide) return;
      const patch = createSelectionNudgePatch({
        deck: workingDeckRef.current,
        deltaX,
        deltaY,
        selectedElementIds,
        slideId: currentSlide.slideId
      });
      if (patch) commitPatch(patch);
    },
    onPaste: handlePasteCopiedElement,
    onPasteImageFiles: (files) => {
      if (!currentSlide) return;
      void insertImageFiles(
        files,
        { slideId: currentSlide.slideId, type: "insert" },
        {
          centerX: deck.canvas.width / 2,
          centerY: deck.canvas.height / 2
        }
      );
    },
    onRedo: handleRedo,
    onSave: () => void handleSaveDeck(),
    onUndo: handleUndo,
    selectedElement,
    selectedElementIds
  });

  return (
    <>
      <main
        aria-busy={isDeckLoading}
        className={`editor-app-shell orbit-shell editor-professional redesign-dark ${
          isSlideRehearsalActive ? "slide-rehearsal-active" : ""
        } ${isDeckLoading ? "is-deck-loading" : ""}`}
      >
        <EditorTopbar
          activePresentationAction={activePresentationAction}
          activeTopMenu={activeTopMenu}
          canManageShare={canManageShare}
          canMutateDeck={canMutateDeck}
          canOpenAudienceLink={canOpenAudienceLink}
          canStartPresentation={canStartPresentation}
          canvas={deck.canvas}
          deckTitle={deck.title}
          isDeckLoading={isDeckLoading}
          isPptxExporting={isPptxExporting}
          isSharePermissionLoading={isSharePermissionLoading}
          isSlideRehearsalActive={isSlideRehearsalActive}
          isUsingFallbackDeck={isUsingFallbackDeck}
          lastSavedAtLabel={formatLastSavedAtLabel(lastSavedAt)}
          onExitToHome={handleExitToHome}
          onOpenExport={openExportDialog}
          onImportPptx={openPptxFilePicker}
          onOpenAudienceLink={() => {
            setIsAudienceLinkModalOpen(true);
            setActiveTopMenu(null);
          }}
          onOpenCommunityShare={() => {
            window.location.href = `/community?publishProjectId=${encodeURIComponent(projectId)}`;
          }}
          onOpenPresenceDebug={() => {
            setIsPresenceDebugOpen(true);
            setActiveTopMenu(null);
          }}
          onOpenShare={openSharePanel}
          onOpenTargetDuration={() => {
            setIsTargetDurationOpen(true);
            setActiveTopMenu(null);
          }}
          onRefresh={() => {
            void health.refetch();
            void deckQuery.refetch();
          }}
          onRenameDeckTitle={(title) => {
            commitPatch((currentDeck) => ({
              baseVersion: currentDeck.version,
              deckId: currentDeck.deckId,
              operations: [{ type: "update_deck", title }],
              source: "user"
            }));
          }}
          onSave={() => void handleSaveDeck()}
          onStartFullRehearsal={() => void handleStartFullRehearsal()}
          onStartPresentation={() => void handleStartPresentation()}
          onStartRehearsal={handleToggleSlideRehearsal}
          projectId={projectId}
          projectPresenceUsers={projectPresenceUsers}
          pptxExportMessage={pptxExportError || pptxExportStatus}
          pptxImportMeta={pptxImportMenuMeta(pptxImportState)}
          recoveryHint={saveErrorMessage ? getSaveRecoveryHint(saveErrorCode) : null}
          saveFailed={saveState === "error"}
          saveMenuMeta={
            saveErrorMessage
              ? getSaveErrorStatusLabel(saveErrorCode)
              : deckQuery.data
                ? saveStatusLabel
                : "demo fallback"
          }
          saveStatusLabel={saveStatusLabel}
          saving={isSaveInFlight(saveState)}
          setActiveTopMenu={setActiveTopMenu}
          showLoadedFileLabel={Boolean(deckQuery.data)}
        />
      <EditorModals
        audienceLink={{
          deckId: deck.deckId,
          isOpen: isAudienceLinkModalOpen,
          onClose: () => setIsAudienceLinkModalOpen(false),
          projectId
        }}
        exitConfirm={{
          isOpen: isExitConfirmOpen,
          modalProps: {
            isSaving: isExitSaving,
            onCancel: () => setIsExitConfirmOpen(false),
            onDiscard: handleDiscardAndExit,
            onSaveAndExit: () => {
              void handleSaveAndExit();
            }
          }
        }}
        exportDialog={{
          deckId: deck.deckId,
          errorMessage: pptxExportError,
          initialFormat: exportDialogFormat,
          onClose: () => setIsExportDialogOpen(false),
          onExport: handleExportDeck,
          open: isExportDialogOpen,
          pending: isPptxExporting,
          projectId,
          statusMessage: pptxExportStatus
        }}
        presence={{
          isOpen: isPresenceDebugOpen,
          lastPresenceAt,
          onClose: () => setIsPresenceDebugOpen(false),
          projectId,
          sessionDebug,
          socketErrorMessage,
          socketId,
          socketStatus,
          users: projectPresenceUsers
        }}
        share={{
          isOpen: isSharePanelOpen,
          modalProps: {
            activeTab: shareAccessTab,
            actionError: shareActionError,
            actionLabel: shareActionLabel,
            inviteEmail: shareInviteEmail,
            inviteRole: shareInviteRole,
            isLoading: isShareLoading,
            members: shareMembers,
            requests: shareRequests,
            onClose: () => setIsSharePanelOpen(false),
            onInvite: handleShareInvite,
            onInviteEmailChange: setShareInviteEmail,
            onInviteRoleChange: setShareInviteRole,
            onMemberRemove: handleShareMemberRemoval,
            onMemberRoleChange: handleShareMemberRoleChange,
            onRequestStatusChange: handleShareRequestStatus,
            onTabChange: setShareAccessTab
          }
        }}
        targetDuration={{
          isOpen: isTargetDurationOpen,
          modalProps: {
            deck,
            onClose: () => setIsTargetDurationOpen(false),
            onSave: ({ durations, targetDurationMinutes }) => {
              const patch = createTargetDurationPatch(
                deck,
                targetDurationMinutes,
                durations
              );
              return patch ? commitPatch(patch, deck) : true;
            },
            open: isTargetDurationOpen
          }
        }}
      />
      <PptxImportPreferenceDialog
        fileName={pendingPptxImportFile?.name ?? ""}
        onCancel={editorFileTransferActions.cancelPptxImport}
        onConfirm={(preference) => {
          void editorFileTransferActions.confirmPptxImport(preference);
        }}
        open={Boolean(pendingPptxImportFile)}
      />
      <ActivityQrInsertDialog
        deck={deck}
        onClose={() => setIsActivityQrInsertOpen(false)}
        onInsert={(activityId) => {
          if (handleAddActivityQrElement(activityId)) {
            setIsActivityQrInsertOpen(false);
          }
        }}
        open={isActivityQrInsertOpen}
        targetSlide={currentSlide}
      />
      {isDeckLoading ? (
        <div
          aria-label="발표 자료를 불러오는 중"
          className="editor-loading-guard"
          role="status"
        >
          <span aria-hidden="true" className="editor-loading-indicator" />
        </div>
      ) : null}

      <section
        className={`editor-panel ${isRightPanelOpen ? "" : "right-panel-closed"} ${
          isSlidesPaneCollapsed ? "slides-panel-collapsed" : ""
        } ${
          isSlideRehearsalActive ? "slide-rehearsal-mode" : ""
        }`}
        aria-label="Presentation editor"
        style={
          {
            "--slides-pane-width": `${
              isSlidesPaneCollapsed ? collapsedSlidesPaneWidth : slidesPaneWidth
            }px`,
            "--right-pane-width": `${rightPaneWidth}px`,
            "--right-pane-collapsed-width": `${collapsedRightPaneWidth}px`,
            "--speaker-notes-panel-height": `${speakerNotesPanelHeight}px`
          } as CSSProperties
        }
      >
        {isSlideRehearsalActive && rehearsalSlide ? (
          <EditorSlideRehearsalLeftPanel
            onResizeStart={handleSlidesPaneResizeStart}
            slide={rehearsalSlide}
            state={slideRehearsalState}
          />
        ) : (
          <SlideNavigatorPane
            canMutate={canMutateDeck}
            deck={deck}
            isCollapsed={isSlidesPaneCollapsed}
            items={slideRailItems}
            onAddActivitySlide={(template) => {
              if (!handleAddActivitySlide(template)) return;
              setIsRightPanelOpen(true);
            }}
            onAddActivityResultsSlide={() => {
              if (!handleAddActivityResultsSlide()) return;
              setIsRightPanelOpen(true);
            }}
            onAddSlide={handleAddSlide}
            onDeleteSlide={handleDeleteSlide}
            onDuplicateSlide={handleDuplicateSlide}
            onMoveSlide={handleMoveSlide}
            onReorderSlides={handleReorderSlides}
            onResizeStart={handleSlidesPaneResizeStart}
            onSelectSlide={handleSelectSlideForNavigator}
            onSetView={setSlidePanelView}
            onToggleCollapsed={() =>
              setIsSlidesPaneCollapsed((current) => !current)
            }
            showIds={showIds}
            slideThumbnailUrls={slideThumbnailUrls}
            view={slidePanelView}
          />
        )}
        <section className="stage-pane">
          {!isSlideRehearsalActive ? (
            <EditorToolbar
              canInsertDataElements={canInsertDataElements(currentSlide)}
              canZoomIn={stageScale < maximumManualEditorZoom}
              canZoomOut={stageScale > minimumManualEditorZoom}
              canMutate={canMutateDeck}
              canUseCurrentSlide={canEditCurrentSlideCanvas}
              compactSelectionTrigger={
                isCompactEditorLayout &&
                canMutateDeck &&
                selectionInspectorModel.selectedCount > 0 ? (
                  <button
                    aria-controls="editor-selection-inspector-pane"
                    aria-describedby="compact-selection-count"
                    aria-expanded={
                      isRightPanelOpen && rightPanelMode === "properties"
                    }
                    aria-label="선택 항목 속성 열기"
                    className="compact-selection-trigger"
                    ref={compactSelectionTriggerRef}
                    type="button"
                    onClick={handleOpenCompactSelectionInspector}
                  >
                    <span>속성</span>
                    <span id="compact-selection-count">
                      {selectionInspectorModel.selectedCount}개 선택됨
                    </span>
                  </button>
                ) : null
              }
              chartMenuButtonRef={chartMenuButtonRef}
              insertTool={insertTool}
              isChartMenuOpen={isChartMenuOpen}
              isIconPanelOpen={isIconPanelOpen}
              isImageUploadPending={isImageUploadPending}
              isShapeMenuOpen={isShapeMenuOpen}
              isStageFitToViewport={isStageFitToViewport}
              onAddText={handleAddTextElement}
              onOpenIconLibrary={toggleIconLibrary}
              onOpenActivityQrInsert={() => setIsActivityQrInsertOpen(true)}
              onOpenImagePicker={() => {
                if (currentSlide) {
                  openImageFilePicker({
                    slideId: currentSlide.slideId,
                    type: "insert",
                  });
                }
              }}
              onOpenRightPanel={
                isRightPanelOpen ? undefined : () => setIsRightPanelOpen(true)
              }
              onRedo={handleRedo}
              onSelectTool={() => setInsertTool("select")}
              onToggleChartMenu={() => {
                setIsShapeMenuOpen(false);
                setIsChartMenuOpen((current) => !current);
              }}
              onToggleShapeMenu={() => {
                setIsChartMenuOpen(false);
                setIsShapeMenuOpen((current) => !current);
              }}
              onUndo={handleUndo}
              onFitStageToViewport={fitStageToViewport}
              onZoomIn={zoomCanvasIn}
              onZoomOut={zoomCanvasOut}
              redoDisabled={redoStack.length === 0}
              shapeMenuButtonRef={shapeMenuButtonRef}
              stageScale={stageScale}
              undoDisabled={undoStack.length === 0}
            />
          ) : null}

          <EditorCanvasStage
            assistantDialog={
              <SpeakerNotesAssistantDialog
                errorMessage={speakerNotesAssistantError}
                mode={speakerNotesAssistantMode}
                occurrenceWarning={speakerNotesAssistantOccurrenceWarning}
                onApply={handleApplySpeakerNotesSuggestion}
                onClose={speakerNotesEditorActions.closeAssistant}
                onGenerate={() => void handleGenerateSpeakerNotesSuggestion()}
                onModeChange={setSpeakerNotesAssistantMode}
                open={isSpeakerNotesAssistantOpen}
                originalNotes={speakerNotesAssistantSource?.notes ?? ""}
                result={speakerNotesAssistantResult}
                status={speakerNotesAssistantStatus}
              />
            }
            canvasViewportRef={editorCanvasViewportRef}
            currentSlide={currentSlide}
            deck={deck}
            editableCanvasProps={{
              customShapeEditElementId,
                disableInteractions:
                  isPlayingCurrentSlideAnimations || isSlideRehearsalActive,
              editingElementId,
              imageCropElementId: canMutateDeck ? imageCropElementId : null,
              elementStates: animationPreviewElementStates,
              insertTool,
              selectedElementIds,
              showIds,
              stageScale,
              stageRef: editorStageRef,
              validationHighlightElementIds,
              visibleElements,
              onClearSelection: handleCanvasBackgroundSelectionClear,
              onCommitElementFrame: handleElementFrameChange,
              onCommitElementProps: (elementId, nextProps) => {
                if (currentSlide) {
                  handleElementPropsChange(currentSlide.slideId, elementId, nextProps);
                }
              },
              onCreateElement: handleCreateDrawnElement,
              onCreateCustomShape: handleCreateCustomShape,
              onCommitCustomShapeGeometry: (elementId, nodes, closed) => {
                if (currentSlide) {
                  handleCommitCustomShapeGeometry(
                    currentSlide.slideId,
                    elementId,
                    nodes,
                    closed
                  );
                }
              },
              onDoubleClickElement: (elementId) => setEditingElementId(elementId),
              onFinishEditing: () => setEditingElementId(null),
              onFinishImageCrop: finishImageCrop,
              onSetCustomShapeEditElementId: setCustomShapeEditElementId,
              onSetInsertTool: setInsertTool,
              onOpenElementContextMenu: handleOpenElementContextMenu,
              onSelectElement: handleElementSelection,
              onSelectElements: (elementIds) => {
                setElementContextMenu(null);
                setEditingElementId(null);
                setCustomShapeEditElementId(null);
                setSelectedElementIds(elementIds);
                openPropertiesForCanvasSelection(elementIds);
              }
            }}
            imageDropEnabled={imageDropEnabled}
            imageTransferMessage={
              imageUploadError
                ? { kind: "error", message: imageUploadError }
                : imageUploadStatus
                  ? { kind: "status", message: imageUploadStatus }
                  : null
            }
            onImageFilesDrop={(files, placement) => {
              if (!currentSlide) return;
              void insertImageFiles(
                files,
                { slideId: currentSlide.slideId, type: "insert" },
                placement
              );
            }}
            renderingDeck={renderingDeck}
            slideRenderStageRefs={slideRenderStageRefs}
            stageScale={stageScale}
            zoomMode={editorZoom.mode}
          />

            {isSlideRehearsalActive && rehearsalSlide ? (
              <EditorSlideRehearsalBottomPanel
                elapsedMs={slidePracticeSession.elapsedMs}
                message={slidePracticeSession.message}
                onNextSentence={moveSlideRehearsalToNextSentence}
                onPreviousSentence={moveSlideRehearsalToPreviousSentence}
                onRetryRuntimeConfig={slidePracticeSession.retryRuntimeConfig}
                onSkipSentence={skipCurrentSlideRehearsalSentence}
                onStart={() => void handleStartSlidePractice()}
                onStop={() => void handleStopSlidePractice()}
                runtimeState={slidePracticeSession.runtimeState}
                practiceState={slidePracticeSession.state}
                slide={rehearsalSlide}
                state={slideRehearsalState}
              />
            ) : (
              <SpeakerNotesPanel
                canGenerateQuestionGuides={canMutateDeck}
                celebrationSessionId={practiceCelebrationSessionId}
                contentRef={speakerNotesContentRef}
                currentSlide={currentSlide}
                deck={deck}
                draft={speakerNotesDraft}
                flushPendingSaves={flushAndGetPersistedDeck}
                guidance={speakerNotesLengthGuidance}
                height={speakerNotesPanelHeight}
                isEditing={isSpeakerNotesEditing}
                isExpanded={isSpeakerNotesPanelExpanded}
                isMaximized={isSpeakerNotesPanelMaximized}
                isResizing={isSpeakerNotesPanelResizing}
                maxHeight={getSpeakerNotesPanelMaxHeight()}
                minHeight={minSpeakerNotesPanelHeight}
                onCancelEdit={handleCancelSpeakerNotesEdit}
                onCelebrationConsumed={handlePracticeCelebrationConsumed}
                onClearKeyword={clearSelectedKeyword}
                onDeleteKeyword={() => {
                  if (currentSlide && selectedKeyword) {
                    handleDeleteSelectedKeyword(
                      currentSlide.slideId,
                      selectedKeyword.keywordId
                    );
                  }
                }}
                onDraftChange={setSpeakerNotesDraft}
                onOpenAssistant={handleOpenSpeakerNotesAssistant}
                onResizeKeyDown={handleSpeakerNotesResizeKeyDown}
                onResizeStart={handleSpeakerNotesResizeStart}
                onSaveEdit={handleSaveSpeakerNotesEdit}
                onSelectKeyword={handleSelectKeyword}
                onSelectKeywordActionMode={handleSelectKeywordActionMode}
                onSelectKeywordText={handleSpeakerNotesKeywordSelection}
                onStartEdit={handleStartSpeakerNotesEdit}
                onTabSelected={handleSpeakerNotesTabSelected}
                onToggleMaximized={speakerNotesPanelActions.toggleMaximized}
                onTogglePanel={handleToggleSpeakerNotesPanel}
                selectedKeyword={selectedKeyword}
                selectedKeywordId={selectedKeywordId}
                selectedKeywordOccurrenceKey={selectedKeywordOccurrenceKey}
                selectedKeywordRequiredActive={selectedKeywordRequiredActive}
                selectedKeywordUsage={selectedKeywordUsage}
                projectId={projectId}
                questionGuideAutoStatus={
                  currentSlide
                    ? autoSlideQuestionGuides.statusBySlideId[currentSlide.slideId] ?? "idle"
                    : "idle"
                }
                questionGuideRefreshToken={autoSlideQuestionGuides.refreshToken}
                reportRefreshToken={practiceReportRefreshToken}
                requestedTab={requestedSpeakerNotesTab}
                showIds={showIds}
                usageByKeywordId={currentSlideKeywordUsage}
              />
            )}
        </section>

        {isRightPanelOpen ? (
          <EditorRightPanel
          assistantOpenRequestId={assistantOpenRequestId}
          aiChatState={aiChatState}
          aiPanelView={aiPanelView}
          animationCount={selectedElementAnimations.length}
          animationProperties={
            <>
            <AnimationSlideTransitionEditor
              mutationDisabledReason={transitionMutationDisabledReason}
              transition={currentSlide?.transition}
              onUpdateTransition={(transition) => {
                if (currentSlide) {
                  handleUpdateSlideTransition(currentSlide.slideId, transition);
                }
              }}
            />
            <AnimationInspectorPanel
              actionAnimationIds={
                currentSlide?.actions.flatMap((action) =>
                  action.effect.kind === "play-animation"
                    ? [action.effect.animationId]
                    : []
                ) ?? []
              }
              animationTriggerSummaryByAnimationId={
                currentSlide?.actions.reduce<Record<string, string>>(
                  (summaries, action) => {
                    if (action.effect.kind !== "play-animation") {
                      return summaries;
                    }
                    const trigger = action.trigger;
                    if (trigger.kind === "keyword-occurrence") {
                      const keyword = currentSlide.keywords.find(
                        (candidate) => candidate.keywordId === trigger.keywordId
                      );
                      summaries[action.effect.animationId] = `발화 트리거 · 대본 위치 "${keyword?.text ?? "키워드"}"`;
                    } else if (trigger.kind === "keyword") {
                      const keyword = currentSlide.keywords.find(
                        (candidate) => candidate.keywordId === trigger.keywordId
                      );
                      summaries[action.effect.animationId] = `기존 키워드 트리거 · "${keyword?.text ?? "키워드"}"`;
                    }
                    return summaries;
                  },
                  {}
                ) ?? {}
              }
              legacyKeywordAnimationIds={
                currentSlide?.actions.flatMap((action) =>
                  action.effect.kind === "play-animation" &&
                  action.trigger.kind === "keyword"
                    ? [action.effect.animationId]
                    : []
                ) ?? []
              }
              animations={selectedElementAnimations}
              canCreateAnimation={Boolean(
                currentSlide &&
                selectedAnimationPanelElement &&
                !animationMutationDisabledReason
              )}
              element={selectedAnimationPanelElement}
              keywordOptions={animationPanelKeywordOptions}
              keywordTriggerRestrictionMessage={
                animationKeywordTriggerPolicy.restrictionMessage
              }
              keywordTriggerWarningMessage={
                animationKeywordTriggerPolicy.warningMessage
              }
              mutationDisabledReason={animationMutationDisabledReason}
              preferredAnimationId={animationPanelFocusedAnimationId}
              selectedKeywordId={selectedKeywordId}
              selectedKeywordLabel={selectedKeyword?.text ?? null}
              selectedKeywordOccurrenceId={selectedKeywordOccurrenceKey}
              slideAnimations={currentSlideAnimations}
              slideElements={currentSlide?.elements ?? []}
              onAddAnimation={(draft, keywordId, keywordOccurrenceId) => {
                if (!currentSlide || !selectedAnimationPanelElement) {
                  return;
                }

                handleAddAnimation(
                  currentSlide.slideId,
                  selectedAnimationPanelElement.elementId,
                  keywordId,
                  keywordOccurrenceId,
                  draft
                );
              }}
              onDeleteAnimation={(animationId) => {
                if (currentSlide) {
                  handleDeleteAnimation(currentSlide.slideId, animationId);
                }
              }}
              onRequestKeywordOccurrence={handleRequestKeywordOccurrence}
              onSelectSlideAnimation={handleSelectSlideAnimationFromPanel}
              onUpdateAnimation={(animationId, animation) => {
                if (currentSlide) {
                  handleUpdateAnimation(currentSlide.slideId, animationId, animation);
                }
              }}
              showIds={showIds}
            />
            </>
          }
          canPlayAnimations={canPlayCurrentSlideAnimations}
          currentSlide={currentSlide}
          deck={deck}
          designProperties={
            currentSlide?.kind === "activity" ? (
              <ActivitySlideInspector
                deckId={deck.deckId}
                onAddRuntimeElement={(kind) => {
                  handleAddActivityRuntimeElement(kind);
                }}
                onApplyDesignPreset={(presetId) => {
                  commitPatch((currentDeck) =>
                    createApplyActivityDesignPresetPatch(
                      currentDeck,
                      currentSlide.slideId,
                      presetId
                    )
                  );
                  setSelectedElementIds([]);
                  setEditingElementId(null);
                }}
                onOpenAudienceLink={() => setIsAudienceLinkModalOpen(true)}
                projectId={deck.projectId}
                slide={currentSlide}
                theme={deck.theme}
                onChange={(activity) => {
                  commitPatch((currentDeck) =>
                    createUpdateActivityDefinitionPatch(
                      currentDeck,
                      currentSlide.slideId,
                      activity
                    )
                  );
                }}
              />
            ) : currentSlide?.kind === "activity-results" ? (
              <ActivityResultSlideInspector
                deck={deck}
                projectId={deck.projectId}
                slide={currentSlide}
                onChange={(activityResult) => {
                  commitPatch((currentDeck) =>
                    createUpdateActivityResultDefinitionPatch(
                      currentDeck,
                      currentSlide.slideId,
                      activityResult
                    )
                  );
                }}
                onSelectSourceSlide={(slideId) => {
                  handleSelectSlide(slideId);
                }}
              />
            ) : renderSelectionInspector()
          }
          canRepairValidation={canMutateDeck}
          editorValidationItems={presentedEditorValidationItems}
          iconLibrary={
            <IconLibrarySidePanel
              accentColor={
                currentSlide?.style.accentColor ?? deck.theme.accentColor
              }
              onInsert={editorCanvasActions.addIconElement}
            />
          }
          isIconPanelOpen={isIconPanelOpen}
          isOpen={isRightPanelOpen}
          isAnimationPropertiesOpen={isAnimationPanelOpen}
          isPlayingAnimations={isPlayingCurrentSlideAnimations}
          onActivePanelModeChange={setRightPanelMode}
          onAiChatStateChange={setAiChatState}
          onFocusValidationTarget={handleValidationTargetFocus}
          onHighlightElementIds={setValidationHighlightElementIds}
          onProposalApplied={handleDesignAgentProposalApplied}
          onGeneratedImageInsert={editorFileTransferActions.insertGeneratedImage}
          onPlayAnimations={playCurrentSlideAnimations}
          onSpeakerNotesAssistantRequest={
            speakerNotesEditorActions.openAssistantAndGenerate
          }
          onResizeStart={handleRightPaneResizeStart}
          onSemanticCueChange={handleSemanticCueReviewChange}
          onSemanticCueExtract={(force) => void handleSemanticCueExtraction(force)}
          onRepairValidationTextOverflow={handleSafeTextOverflowRepair}
          projectId={projectId}
          propertiesOpenRequestId={propertiesOpenRequestId}
          pptxImportState={pptxImportState}
          selectedElementIds={selectedElementIds}
          semanticCueExtractionState={semanticCueExtractionState}
          setAiPanelView={setAiPanelView}
          setIsIconPanelOpen={setIsIconPanelOpen}
          setIsAnimationPropertiesOpen={setIsAnimationPanelOpen}
          setIsOpen={setIsRightPanelOpen}
          validationRepairableElementIds={safeTextOverflowRepair.repairedElementIds}
          validationRepairStatus={validationRepairStatus}
        />
        ) : null}
      </section>

      <EditorDebugPanels
        currentSlide={currentSlide}
        currentSlideAnimations={currentSlideAnimations}
        currentSlideId={resolvedCurrentSlideId}
        deck={deck}
        isDataViewOpen={isDataViewOpen}
        isDev={isDev}
        lastPatchLabel={lastPatchLabel}
        onCloseDataView={() => setIsDataViewOpen(false)}
        redoCount={redoStack.length}
        saveStatusLabel={saveStatusLabel}
        selectedElementIds={selectedElementIds}
        undoCount={undoStack.length}
        validationHighlightElementIds={validationHighlightElementIds}
        visibleElements={visibleElements}
      />
        <input
          ref={imageFileInputRef}
          accept={editorImageAccept}
          hidden
          type="file"
          onChange={handleImageFileInputChange}
        />
        <input
          ref={pptxFileInputRef}
          accept={pptxImportAccept}
          hidden
          type="file"
          onChange={handlePptxFileInputChange}
        />
      </main>
      {canMutateDeck && isDeleteUndoToastOpen ? (
        <EditorUndoToast
          message="슬라이드가 삭제되었습니다"
          onClose={() => setIsDeleteUndoToastOpen(false)}
          onUndo={() => {
            if (handleUndo()) setIsDeleteUndoToastOpen(false);
          }}
        />
      ) : null}
      <EditorContextMenus
        canInsertCustomShape={canInsertCustomShape(currentSlide)}
        chartMenuPosition={chartMenuPosition}
        elementContextMenu={elementContextMenu}
        isChartMenuOpen={isChartMenuOpen}
        isImageUploadPending={isImageUploadPending}
        isShapeMenuOpen={isShapeMenuOpen}
        onCloseChartMenu={() => setIsChartMenuOpen(false)}
        onCloseElementContextMenu={() => setElementContextMenu(null)}
        onCloseShapeMenu={() => setIsShapeMenuOpen(false)}
        onCreateGroup={handleCreateGroupFromSelection}
        onInsertChart={(type) => {
          handleAddChartElement(type);
          setIsChartMenuOpen(false);
        }}
        onInsertShape={handleInsertShapeElement}
        onReplaceImage={openImageFilePicker}
        onUngroup={handleUngroupElement}
        shapeMenuPosition={shapeMenuPosition}
      />
    </>
  );
}

export function getEditorStatusLabel(props: {
  isDeckError: boolean;
  isDeckLoading: boolean;
  isUsingFallbackDeck: boolean;
  saveState: SaveState;
}) {
  if (props.isDeckLoading) {
    return "불러오는 중";
  }

  if (props.saveState === "error") {
    return "저장 실패";
  }

  if (props.isDeckError) {
    return "오프라인 데모";
  }

  if (props.isUsingFallbackDeck) {
    return "로컬 데모";
  }

  if (props.saveState === "manual-saving") {
    return "수동 저장 중";
  }

  if (props.saveState === "manual-saved") {
    return "수동 저장됨";
  }

  if (props.saveState === "auto-saving") {
    return "자동 저장 중";
  }

  if (props.saveState === "auto-pending") {
    return "저장 대기 중";
  }

  if (props.saveState === "conflict-recovered") {
    return "충돌 복구 후 저장됨";
  }

  return "저장됨";
}

function pptxImportMenuMeta(state: PptxImportState) {
  if (state.status === "uploading") return "업로드 중...";
  if (state.status === "importing") return "변환 중...";
  if (state.status === "succeeded" && state.qualityReport) {
    return `품질 ${state.qualityReport.compositeScore}`;
  }
  if (state.status === "error") return "실패";
  return "업로드";
}

function isSaveInFlight(saveState: SaveState) {
  return saveState === "auto-saving" || saveState === "manual-saving";
}

function getSaveErrorStatusLabel(saveErrorCode: SaveErrorCode | null) {
  switch (saveErrorCode) {
    case "manual-render-failed":
      return "렌더 저장 실패";
    case "conflict-recovery-failed":
      return "충돌 복구 실패";
    case "rehearsal-blocked":
      return "리허설 준비 중단";
    case "rehearsal-save-failed":
      return "리허설 저장 실패";
    case "missing-project":
    case "missing-persisted-base":
    case "auto-save-failed":
      return "저장 실패";
    default:
      return "저장 실패";
  }
}

function getSaveRecoveryHint(saveErrorCode: SaveErrorCode | null) {
  switch (saveErrorCode) {
    case "manual-render-failed":
      return "다시 저장 필요";
    case "conflict-recovery-failed":
      return "새로고침 후 재시도";
    case "rehearsal-blocked":
      return "발표 자료를 먼저 불러와 주세요";
    case "rehearsal-save-failed":
      return "리허설 다시 시작";
    case "missing-project":
    case "missing-persisted-base":
      return "새로고침 후 재시도";
    case "auto-save-failed":
      return "저장 버튼으로 재시도";
    default:
      return null;
  }
}

function formatLastSavedAtLabel(lastSavedAt: string | null): string | null {
  if (!lastSavedAt) {
    return null;
  }

  const date = new Date(lastSavedAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}
