import type { DeckAnimation, Keyword, Slide, DeckElement } from "@orbit/shared";
import {
  IconPlus as Plus,
  IconTrash as Trash2,
  IconX as X
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { SlideAnimationDiagnostics } from "../../../../../../../packages/editor-core/src/index";
import { IdBadge } from "./EditorIdBadge";
import {
  KeywordHighlightedNotes,
  type KeywordSelectionContext
} from "./KeywordInspector";
import {
  PropertyNumberField,
  QuickBarSelectField
} from "./SelectionQuickBar";

const animationTypeOptions = [
  { label: "페이드 인", value: "fade-in" },
  { label: "페이드 아웃", value: "fade-out" }
] as const;

function getAnimationTypeLabel(type: DeckAnimation["type"] | string) {
  if (type === "appear") {
    return "나타나기";
  }

  if (type === "disappear") {
    return "사라지기";
  }

  const matchedOption = animationTypeOptions.find((option) => option.value === type);
  return matchedOption?.label ?? `지원 안 함 (${type || "알 수 없음"})`;
}

function getElementLabel(element: DeckElement) {
  if (element.type === "text") {
    return "텍스트";
  }

  if (element.type === "image") {
    return "이미지";
  }

  if (element.type === "chart") {
    return "차트";
  }

  if (element.type === "customShape") {
    return "자유 도형";
  }

  if (element.type === "group") {
    return "그룹";
  }

  return "도형";
}

type AnimationEditorModalProps = {
  animationDiagnostics: SlideAnimationDiagnostics;
  animationTriggerLabels: Record<string, string>;
  animations: DeckAnimation[];
  canCreateAnimation: boolean;
  element: DeckElement | null;
  isOpen: boolean;
  keywords: Keyword[];
  notes: string;
  onAddAnimation: (draft: {
    delayMs: number;
    durationMs: number;
    type: DeckAnimation["type"];
  }) => void;
  onAssignSelectedKeywordToAnimation: (animationId: string) => void;
  onClose: () => void;
  onDeleteAnimation: (animationId: string) => void;
  onSelectKeyword: (keywordId: string, occurrenceKey?: string | null) => void;
  onSelectKeywordText: (
    value: string,
    start: number
  ) => KeywordSelectionContext | null;
  onUpdateAnimation: (
    animationId: string,
    patch: Partial<DeckAnimation>
  ) => void;
  selectedKeywordId: string | null;
  selectedKeywordLabel: string | null;
  selectedKeywordOccurrenceKey?: string | null;
  showIds: boolean;
  slide: Slide | null;
};

export function AnimationEditorModal(props: AnimationEditorModalProps) {
  const {
    animationDiagnostics,
    animationTriggerLabels,
    animations,
    canCreateAnimation,
    element,
    isOpen,
    keywords,
    notes,
    onAddAnimation,
    onAssignSelectedKeywordToAnimation,
    onClose,
    onDeleteAnimation,
    onSelectKeyword,
    onSelectKeywordText,
    onUpdateAnimation,
    selectedKeywordId,
    selectedKeywordLabel,
    selectedKeywordOccurrenceKey = null,
    showIds,
    slide
  } = props;
  const [draftType, setDraftType] = useState<DeckAnimation["type"]>("fade-in");
  const [draftDurationMs, setDraftDurationMs] = useState(400);
  const [draftDelayMs, setDraftDelayMs] = useState(0);
  const isKeywordSelected = Boolean(selectedKeywordId && selectedKeywordLabel);
  const isKeywordOccurrenceSelected = Boolean(
    selectedKeywordId && selectedKeywordLabel && selectedKeywordOccurrenceKey
  );

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setDraftType("fade-in");
    setDraftDurationMs(400);
    setDraftDelayMs(0);
  }, [element?.elementId, isOpen, slide?.slideId]);

  if (!isOpen || !element || !slide) {
    return null;
  }

  const duplicateAnimationIds = new Set(
    animationDiagnostics.duplicateOrders.flatMap((diagnostic) => diagnostic.animationIds)
  );
  const hasDuplicateOrders = animations.some((animation) =>
    duplicateAnimationIds.has(animation.animationId)
  );
  const hasDanglingAnimation = animationDiagnostics.danglingAnimations.some((diagnostic) =>
    animations.some((animation) => animation.animationId === diagnostic.animationId)
  );

  const content = (
    <div
      className="animation-editor-modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        aria-label="애니메이션 편집"
        aria-modal="true"
        className="animation-editor-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="animation-editor-modal-header">
          <div>
            <strong>애니메이션 편집</strong>
            <span>
              {getElementLabel(element)} 요소에 연결된 애니메이션 {animations.length}개
            </span>
          </div>
          <button type="button" aria-label="애니메이션 편집 닫기" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="animation-editor-modal-summary">
          <span className="animation-editor-summary-chip">
            선택 요소: {getElementLabel(element)}
          </span>
          {selectedKeywordLabel ? (
            <span className="animation-editor-summary-chip">
              선택 키워드: {selectedKeywordLabel}
            </span>
          ) : (
            <span className="animation-editor-summary-chip muted">
              먼저 대본에서 키워드를 선택하세요
            </span>
          )}
          {showIds ? <IdBadge id={element.elementId} /> : null}
        </div>

        {hasDuplicateOrders ? (
          <div className="animation-editor-warning">
            순서 값이 겹치는 legacy 애니메이션이 있습니다. 현재 UI에서는 순서를 직접 수정하지
            않으므로 필요하면 삭제 후 다시 추가하세요.
          </div>
        ) : null}
        {hasDanglingAnimation ? (
          <div className="animation-editor-warning">
            대상 요소를 찾지 못하는 애니메이션이 있습니다. 삭제 후 다시 연결하는 편이 안전합니다.
          </div>
        ) : null}

        <div className="animation-editor-modal-body">
          <section className="animation-editor-script-panel">
            <header className="animation-editor-script-header">
              <div>
                <strong>1. 키워드 선택</strong>
                <span>대본에서 단어를 눌러 키워드를 선택하거나 새로 만드세요.</span>
              </div>
              {selectedKeywordLabel ? (
                <span className="animation-editor-script-selection">
                  선택됨: {selectedKeywordLabel}
                </span>
              ) : null}
            </header>
            <div className="animation-editor-script-content">
              <KeywordHighlightedNotes
                keywords={keywords}
                notes={notes}
                selectedKeywordId={selectedKeywordId}
                selectedKeywordOccurrenceKey={selectedKeywordOccurrenceKey}
                showIds={showIds}
                slideId={slide.slideId}
                onSelectKeyword={onSelectKeyword}
                onSelectKeywordText={onSelectKeywordText}
              />
            </div>
          </section>

          <section
            className={`animation-editor-card animation-editor-create-card ${
              isKeywordSelected ? "" : "disabled"
            }`}
          >
            <div className="animation-editor-card-header">
              <div>
                <strong>2. 애니메이션 설정</strong>
                <span>키워드를 고른 뒤 효과와 시간을 설정하세요.</span>
              </div>
              {selectedKeywordLabel ? (
                <span className="animation-editor-create-keyword">
                  키워드: {selectedKeywordLabel}
                </span>
              ) : (
                <span className="animation-editor-create-keyword muted">
                  키워드 선택 필요
                </span>
              )}
            </div>
            <div className="animation-editor-fields">
              <QuickBarSelectField
                className="compact-property-field compact-property-field-sm"
                disabled={!isKeywordOccurrenceSelected}
                label="타입"
                options={[...animationTypeOptions]}
                value={draftType}
                onChange={(value) => setDraftType(value as DeckAnimation["type"])}
              />
              <PropertyNumberField
                className="compact-property-field compact-property-field-sm"
                disabled={!isKeywordOccurrenceSelected}
                label="재생"
                min={1}
                onCommit={(value) => {
                  setDraftDurationMs(value);
                }}
                value={draftDurationMs}
              />
              <PropertyNumberField
                className="compact-property-field compact-property-field-sm"
                disabled={!isKeywordOccurrenceSelected}
                label="지연"
                min={0}
                onCommit={(value) => {
                  setDraftDelayMs(value);
                }}
                value={draftDelayMs}
              />
            </div>
            <div className="animation-editor-create-actions">
              <span className="animation-editor-footer-hint">
                {selectedKeywordLabel && !selectedKeywordOccurrenceKey
                  ? "반복되는 단어일 수 있습니다. 발표 메모에서 실제로 트리거할 단어 위치를 선택하세요."
                  : selectedKeywordLabel
                  ? "선택한 키워드와 현재 설정으로 새 애니메이션이 추가됩니다."
                  : "1번에서 키워드를 먼저 선택하면 2번 설정과 추가하기가 활성화됩니다."}
              </span>
              <button
                className="animation-editor-primary-button animation-editor-create-button"
                disabled={!canCreateAnimation || !isKeywordOccurrenceSelected}
                type="button"
                onClick={() =>
                  onAddAnimation({
                    delayMs: draftDelayMs,
                    durationMs: draftDurationMs,
                    type: draftType
                  })
                }
              >
                <Plus size={16} />
                추가하기
              </button>
            </div>
          </section>

          {animations.length > 0 ? (
            animations.map((animation, index) => {
              const typeOptions = animationTypeOptions.some(
                (option) => option.value === animation.type
              )
                ? [...animationTypeOptions]
                : [
                    ...animationTypeOptions,
                    {
                      label: getAnimationTypeLabel(animation.type),
                      value: animation.type
                    }
                  ];

              return (
                <section
                  className="animation-editor-card"
                  key={animation.animationId}
                >
                  <div className="animation-editor-card-header">
                    <div>
                      <strong>
                        애니메이션 {index + 1}
                      </strong>
                      <span>{getAnimationTypeLabel(animation.type)}</span>
                    </div>
                    <div className="animation-editor-card-actions">
                      {showIds ? <IdBadge id={animation.animationId} /> : null}
                      <button
                        className="animation-editor-icon-button danger"
                        type="button"
                        aria-label={`애니메이션 ${index + 1} 삭제`}
                        onClick={() => onDeleteAnimation(animation.animationId)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="animation-editor-fields">
                    <QuickBarSelectField
                      className="compact-property-field compact-property-field-sm"
                      label="타입"
                      options={typeOptions}
                      value={animation.type}
                      onChange={(value) =>
                        onUpdateAnimation(animation.animationId, {
                          type: value as DeckAnimation["type"]
                        })
                      }
                    />
                    <PropertyNumberField
                      className="compact-property-field compact-property-field-sm"
                      label="재생"
                      min={1}
                      onCommit={(value) =>
                        onUpdateAnimation(animation.animationId, {
                          durationMs: value
                        })
                      }
                      value={animation.durationMs}
                    />
                    <PropertyNumberField
                      className="compact-property-field compact-property-field-sm"
                      label="지연"
                      min={0}
                      onCommit={(value) =>
                        onUpdateAnimation(animation.animationId, {
                          delayMs: value
                        })
                      }
                      value={animation.delayMs}
                    />
                  </div>

                  <div className="animation-editor-trigger-row">
                    <span className="animation-editor-trigger-label">
                      {animationTriggerLabels[animation.animationId] ?? "트리거 없음"}
                    </span>
                    {selectedKeywordLabel ? (
                      <button
                        className="quickbar-action-chip"
                        type="button"
                        onClick={() =>
                          onAssignSelectedKeywordToAnimation(animation.animationId)
                        }
                      >
                        {selectedKeywordLabel}로 연결
                      </button>
                    ) : (
                      <span className="quickbar-inline-hint">
                        키워드를 선택하면 음성 트리거로 연결할 수 있습니다
                      </span>
                    )}
                  </div>
                </section>
              );
            })
          ) : (
            <div className="animation-editor-empty">
              <strong>이 요소에 연결된 애니메이션이 없습니다.</strong>
              <p>대본에서 키워드를 선택한 뒤 새 애니메이션을 추가하세요.</p>
            </div>
          )}
        </div>

        <footer className="animation-editor-modal-footer">
          <button className="animation-editor-secondary-button" type="button" onClick={onClose}>
            닫기
          </button>
        </footer>
      </section>
    </div>
  );

  if (typeof document === "undefined" || !document.body) {
    return content;
  }

  return createPortal(content, document.body);
}
