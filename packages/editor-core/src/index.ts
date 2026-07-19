import { Deck, deckSchema, demoIds } from "@orbit/shared";

export { applyDeckPatch } from "./patches/applyPatch";
export type {
  ApplyDeckPatchError,
  ApplyDeckPatchErrorCode,
  ApplyDeckPatchFailure,
  ApplyDeckPatchOptions,
  ApplyDeckPatchResult,
  ApplyDeckPatchSuccess,
  DeckPatchVersionMetadata
} from "./patches/deckPatch";
export {
  createAddAnimationWithKeywordTriggerPatch,
  createKeyword,
  createKeywordId,
  createReplaceKeywordsPatch,
  createSlideActionId,
  createUpdateAnimationKeywordTriggerPatch,
  createUpsertAdvanceSlideKeywordActionPatch,
  deriveKeywordActionUsage,
  deriveKeywordUsage,
  findKeywordByTerm,
  getAnimationTriggerAction,
  getKeywordTriggerLabel
} from "./patches/actionOperations";
export type {
  DerivedKeywordActionUsage,
  DerivedKeywordOccurrenceUsage,
  DerivedKeywordUsage
} from "./patches/actionOperations";
export {
  suggestLegacyKeywordTriggerRepairs
} from "./patches/legacyKeywordTriggerRepair";
export type {
  LegacyKeywordTriggerRepairConfidence,
  LegacyKeywordTriggerRepairSuggestion
} from "./patches/legacyKeywordTriggerRepair";
export {
  removeLegacyAiGeneratedTitleAnimations
} from "./patches/legacyAiGeneratedAnimationRepair";
export { deriveKeywordOccurrences } from "./keywords/keywordOccurrences";
export type { KeywordOccurrence } from "./keywords/keywordOccurrences";
export {
  findDanglingKeywordOccurrenceActions
} from "./keywords/keywordOccurrenceDiagnostics";
export type {
  DanglingKeywordOccurrenceAction
} from "./keywords/keywordOccurrenceDiagnostics";
export {
  createAddAnimationPatch,
  createAnimationId,
  createDefaultAnimation,
  createDeleteAnimationPatch,
  createUpdateAnimationPatch,
  getElementAnimations,
  getNextAnimationOrder,
  validateSlideAnimations
} from "./patches/animationOperations";
export type {
  SlideAnimationDanglingTargetDiagnostic,
  SlideAnimationDiagnostics,
  SlideAnimationOrderDiagnostic
} from "./patches/animationOperations";
export {
  createElementFramePatch,
  normalizeElementFrameDraft
} from "./patches/elementFrame";
export type { ElementFrameDraft } from "./patches/elementFrame";
export {
  applyRichTextCharacterStyle,
  applyRichTextParagraphStyle,
  getRichTextSelectionCharacterStyle,
  getRichTextSelectionParagraphStyle,
  getRichTextSemanticText,
  normalizeRichTextProps
} from "./text/richTextOperations";
export type {
  RichTextCharacterStylePatch,
  RichTextParagraphStylePatch,
  RichTextRange,
  RichTextSelectionCharacterStyle,
  RichTextSelectionParagraphStyle,
  RichTextSelectionValue
} from "./text/richTextOperations";
export {
  createTableOperationPatch,
  getTableOperationCapability,
  getTableStructureCapability,
  normalizeTableCellRange
} from "./table/tableOperations";
export type {
  TableCellRange,
  TableOperation,
  TableOperationCapability,
  TableOperationDisabledReason,
  TableOperationPatchResult,
  TableStructureCapability,
  TableStructureDisabledReason
} from "./table/tableOperations";
export {
  buildGroupedFrameOperations,
  createGroupedElementFramePatch,
  getGroupChildElements,
  getGroupedSelectionBounds,
  transformGroupedChildFrame
} from "./patches/groupFrame";
export {
  createAddElementPatch,
  createDeleteElementPatch,
  createElementId,
  createUpdateElementPropsPatch
} from "./patches/elementOperations";
export {
  createAddSlidePatch,
  createDuplicateSlidePatch,
  createSlideId,
  createUpdateSlideTransitionPatch,
} from "./patches/slideOperations";
export {
  animationTimelineDiagnosticLimit,
  createAnimationTimeline,
  getAnimationTimelineRoot
} from "./playback/animationTimeline";
export type {
  AnimationStartMode,
  AnimationTimelineBaseReference,
  AnimationTimelineDiagnostic,
  AnimationTimelinePlan,
  AnimationTimelineRoot,
  PlannedAnimationTimelineEffect,
  TimelineAnimationInput
} from "./playback/animationTimeline";
export { normalizeLegacyAnimationStartModes } from "./patches/legacyAnimationStartModeMigration";
export {
  createActivityResultsSlide,
  createActivitySlide,
  createUpdateActivityDefinitionPatch,
  createUpdateActivityResultDefinitionPatch,
  duplicateActivityResultsSlide,
  duplicateActivitySlide,
  remapActivityDefinitionsForDeckDuplicate
} from "./patches/activitySlideOperations";
export {
  createSlidePlaybackState,
  executeSlideAction,
  getNextClickAnimation,
  playNextClickAnimation,
  resolveCueActions,
  resolveTriggeredActions
} from "./playback/slidePlayback";
export type {
  ClickPlaybackResult,
  SlideActionExecutionResult,
  SlidePlaybackState
} from "./playback/slidePlayback";

export function createDemoDeck(): Deck {
  return deckSchema.parse({
    deckId: demoIds.deckId,
    projectId: demoIds.projectId,
    title: "ORBIT Demo Deck",
    version: 1,
    metadata: {
      language: "ko",
      locale: "ko-KR",
    },
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    theme: {
      name: "Executive Blue",
      fontFamily: "Inter",
      backgroundColor: "#ffffff",
      textColor: "#111827",
      accentColor: "#2563eb",
      palette: {
        primary: "#2563eb",
        secondary: "#7c3aed",
        surface: "#ffffff",
        muted: "#f3f4f6",
        border: "#dbe3f0"
      },
      typography: {
        headingFontFamily: "Inter",
        bodyFontFamily: "Inter",
        titleSize: 56,
        headingSize: 36,
        bodySize: 22,
        captionSize: 16
      },
      effects: {
        borderRadius: 10,
        shadow: {
          color: "#111827",
          blur: 18,
          offsetX: 0,
          offsetY: 8,
          opacity: 0.16
        }
      }
    },
    slides: [
      {
        slideId: "slide_1",
        order: 1,
        title: "Opening",
        thumbnailUrl: "/files/thumbnails/slide_1.png",
        style: {
          layout: "title-content",
          fontFamily: "Inter",
          backgroundColor: "#f8fbff",
          textColor: "#0f172a",
          accentColor: "#2563eb",
          backgroundImage: {
            src: "/files/backgrounds/opening-grid.png",
            alt: "Opening grid",
            fit: "cover",
            opacity: 0.28
          }
        },
        speakerNotes: "ORBIT 데모 흐름을 소개합니다.",
        keywords: [
          {
            keywordId: "kw_1",
            text: "ORBIT",
            synonyms: ["발표 도우미"],
            abbreviations: ["OBT"],
          },
          {
            keywordId: "kw_2",
            text: "Deck Schema",
            synonyms: ["발표 자료 구조"],
            abbreviations: ["Schema"]
          }
        ],
        elements: [
          {
            elementId: "el_1",
            type: "text",
            role: "title",
            x: 120,
            y: 96,
            width: 640,
            height: 120,
            props: {
              text: "ORBIT",
              fontSize: 56,
              color: "#111827",
            },
          },
          {
            elementId: "el_2",
            type: "text",
            role: "body",
            x: 126,
            y: 248,
            width: 780,
            height: 160,
            props: {
              text: "프로젝트 생성부터 편집, 발표, 리허설까지 하나의 덱 데이터 계약으로 연결합니다.",
              fontSize: 28,
              fontWeight: "medium",
              color: "#334155",
              lineHeight: 1.4
            }
          },
          {
            elementId: "el_3",
            type: "rect",
            role: "highlight",
            x: 1120,
            y: 128,
            width: 520,
            height: 300,
            props: {
              fill: "#dbeafe",
              stroke: "#93c5fd",
              strokeWidth: 3,
              borderRadius: 24,
              shadow: {
                color: "#2563eb",
                blur: 18,
                offsetX: 0,
                offsetY: 10,
                opacity: 0.14
              }
            }
          },
          {
            elementId: "el_4",
            type: "image",
            role: "media",
            x: 1160,
            y: 168,
            width: 440,
            height: 220,
            props: {
              src: "/files/mockups/editor-preview.png",
              alt: "Editor preview",
              fit: "cover",
              focusX: 0.5,
              focusY: 0.5
            }
          },
          {
            elementId: "el_5",
            type: "line",
            role: "decoration",
            x: 126,
            y: 452,
            width: 900,
            height: 8,
            props: {
              fill: "transparent",
              stroke: "#2563eb",
              strokeWidth: 4,
              borderRadius: 0
            }
          }
        ],
        animations: [
          {
            animationId: "anim_1",
            elementId: "el_1",
            type: "fade-in",
            order: 1,
            durationMs: 400,
            delayMs: 0,
            easing: "ease-out",
          },
          {
            animationId: "anim_2",
            elementId: "el_4",
            type: "zoom-in",
            order: 2,
            durationMs: 600,
            delayMs: 120,
            easing: "ease-in-out"
          }
        ],
      },
      {
        slideId: "slide_2",
        order: 2,
        title: "Data Contract",
        thumbnailUrl: "/files/thumbnails/slide_2.png",
        style: {
          layout: "chart-focus",
          fontFamily: "Inter",
          backgroundColor: "#ffffff",
          textColor: "#111827",
          accentColor: "#7c3aed"
        },
        speakerNotes: "두 번째 슬라이드에서는 ORBIT-14 계약이 협업 기능의 기준이 된다는 점을 강조합니다.",
        keywords: [
          {
            keywordId: "kw_3",
            text: "slideId",
            synonyms: ["슬라이드 식별자"],
            abbreviations: ["SID"]
          }
        ],
        elements: [
          {
            elementId: "el_6",
            type: "text",
            role: "title",
            x: 120,
            y: 84,
            width: 700,
            height: 96,
            props: {
              text: "Shared Data Contract",
              fontSize: 44,
              fontWeight: "bold",
              color: "#111827"
            }
          },
          {
            elementId: "el_7",
            type: "chart",
            role: "chart",
            x: 120,
            y: 220,
            width: 860,
            height: 420,
            props: {
              type: "bar",
              title: "Feature Coverage",
              style: {
                colors: ["#7c3aed", "#2563eb", "#14b8a6"],
                backgroundColor: "#ffffff",
                textColor: "#111827",
                fontFamily: "Inter",
                titleFontSize: 24,
                axisLabelFontSize: 14,
                legendFontSize: 14,
                dataLabelFontSize: 12,
                showLegend: true,
                legendPosition: "bottom",
                showDataLabels: true,
                showGrid: true,
                xAxisTitle: "영역",
                yAxisTitle: "반영도",
                unit: "%"
              },
              data: [
                { label: "Deck", value: 100 },
                { label: "Slide", value: 100 },
                { label: "Element", value: 82 },
                { label: "Animation", value: 76 }
              ]
            }
          },
          {
            elementId: "el_8",
            type: "group",
            role: "decoration",
            x: 1080,
            y: 240,
            width: 520,
            height: 280,
            props: {
              childElementIds: ["el_9", "el_10"]
            }
          },
          {
            elementId: "el_9",
            type: "ellipse",
            role: "decoration",
            x: 1120,
            y: 280,
            width: 180,
            height: 180,
            props: {
              fill: "#ede9fe",
              stroke: "#c4b5fd",
              strokeWidth: 2,
              borderRadius: 0
            }
          },
          {
            elementId: "el_10",
            type: "customShape",
            role: "highlight",
            x: 1328,
            y: 290,
            width: 220,
            height: 160,
            props: {
              closed: true,
              fill: "#f5edff",
              nodes: [
                { x: 20, y: 20, mode: "corner" },
                { x: 200, y: 20, mode: "corner" },
                { x: 200, y: 100, mode: "corner" },
                { x: 92, y: 100, mode: "corner" },
                { x: 48, y: 148, mode: "corner" },
                { x: 56, y: 100, mode: "corner" },
                { x: 20, y: 100, mode: "corner" }
              ],
              stroke: "#9333ea",
              strokeWidth: 2,
              viewBoxWidth: 220,
              viewBoxHeight: 160,
              pathData:
                "M 20 20 L 200 20 L 200 100 L 92 100 L 48 148 L 56 100 L 20 100 Z"
            }
          }
        ],
        animations: [
          {
            animationId: "anim_3",
            elementId: "el_7",
            type: "fade-in",
            order: 1,
            durationMs: 500,
            delayMs: 0,
            easing: "ease-out"
          }
        ]
      }
    ],
  });
}

export function validateDeck(deck: unknown): Deck {
  return deckSchema.parse(deck);
}

export function nextDeckVersion(deck: Deck): Deck {
  return {
    ...deck,
    version: deck.version + 1,
  };
}

export * from "./patches/applyPatch";
export * from "./patches/deckPatch";
