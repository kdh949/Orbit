import { IconSparkles } from "@tabler/icons-react";

import type {
  EditorValidationPresentationItem,
  EditorValidationTargetView,
} from "./validationPresentation";
import "./validation-panel.css";

type ValidationPanelProps = {
  canRepair: boolean;
  items: readonly EditorValidationPresentationItem[];
  repairableElementIds: readonly string[];
  repairStatus?: string | null;
  onFocusTarget: (target: EditorValidationTargetView) => void;
  onHighlightElementIds: (elementIds: string[]) => void;
  onRepairTextOverflow?: (elementIds?: string[]) => void;
};

export function ValidationPanel(props: ValidationPanelProps) {
  const repairableElementIdSet = new Set(props.repairableElementIds);
  const repairableTextOverflowElementIds = getRepairableTextOverflowElementIds(
    props.items,
    repairableElementIdSet,
  );

  return (
    <section
      aria-labelledby="editor-validation-title"
      className="suggestion-card validation-card"
      data-testid="editor-validation-panel"
    >
      <strong id="editor-validation-title">AI 검증</strong>
      <div className="stack-list validation-list">
        {props.items.length > 0 ? (
          props.items.map((presentation, index) => {
            const { item, recoveryInstruction, target } = presentation;
            const messageId = `editor-validation-message-${index}`;
            const recoveryId = recoveryInstruction
              ? `editor-validation-recovery-${index}`
              : undefined;
            const describedBy = [messageId, recoveryId]
              .filter(Boolean)
              .join(" ");
            const targetIsResolved = target?.status === "resolved";
            const repairableItemElementIds = getRepairableItemElementIds(
              presentation,
              repairableElementIdSet,
            );

            return (
              <article
                className={`stack-item compact validation-item validation-item-${item.severity}`}
                data-issue={item.issue ?? "unclassified"}
                data-testid="editor-validation-item"
                key={`${item.issue ?? item.message}-${target?.slideId ?? "deck"}-${index}`}
              >
                <span className="validation-severity-label">
                  {item.severity === "risk" ? "내보내기 위험" : "경고"}
                </span>
                <strong id={messageId}>{item.message}</strong>
                {target ? (
                  <button
                    aria-describedby={describedBy}
                    className="validation-target-button"
                    data-testid="editor-validation-target"
                    disabled={!targetIsResolved}
                    type="button"
                    onBlur={() => props.onHighlightElementIds([])}
                    onClick={() => {
                      if (targetIsResolved) {
                        props.onFocusTarget(target);
                      }
                    }}
                    onFocus={() => {
                      if (targetIsResolved) {
                        props.onHighlightElementIds(target.elementIds);
                      }
                    }}
                    onMouseEnter={() => {
                      if (targetIsResolved) {
                        props.onHighlightElementIds(target.elementIds);
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!event.currentTarget.matches(":focus")) {
                        props.onHighlightElementIds([]);
                      }
                    }}
                  >
                    {target.label}
                  </button>
                ) : null}
                {recoveryInstruction ? (
                  <p
                    className="validation-recovery-instruction"
                    id={recoveryId}
                  >
                    {recoveryInstruction}
                  </p>
                ) : null}
                {props.canRepair && repairableItemElementIds.length > 0 ? (
                  <div className="validation-item-actions">
                    <button
                      className="validation-action-button validation-repair-button"
                      data-testid="editor-validation-repair"
                      type="button"
                      onClick={() =>
                        props.onRepairTextOverflow?.(repairableItemElementIds)
                      }
                    >
                      <IconSparkles aria-hidden="true" size={14} />
                      <span>텍스트 넘침 안전 수정</span>
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })
        ) : (
          <div className="stack-item compact validation-empty-state">
            <span>현재 슬라이드에서 감지된 문제가 없습니다.</span>
          </div>
        )}
      </div>
      {props.canRepair && repairableTextOverflowElementIds.length > 0 ? (
        <button
          className="validation-apply-all-button"
          data-testid="editor-validation-repair-all"
          type="button"
          onClick={() =>
            props.onRepairTextOverflow?.(repairableTextOverflowElementIds)
          }
        >
          텍스트 넘침 {repairableTextOverflowElementIds.length}개 안전 수정
        </button>
      ) : null}
      <p
        aria-atomic="true"
        aria-live="polite"
        className="validation-repair-status"
        role="status"
      >
        {props.repairStatus ?? ""}
      </p>
    </section>
  );
}

function getRepairableTextOverflowElementIds(
  items: readonly EditorValidationPresentationItem[],
  repairableElementIdSet: ReadonlySet<string>,
) {
  const elementIds = items.flatMap((presentation) =>
    getRepairableItemElementIds(presentation, repairableElementIdSet),
  );
  return Array.from(new Set(elementIds));
}

function getRepairableItemElementIds(
  presentation: EditorValidationPresentationItem,
  repairableElementIdSet: ReadonlySet<string>,
) {
  if (
    presentation.item.issue !== "textOverflow" ||
    presentation.target?.status !== "resolved"
  ) {
    return [];
  }

  return presentation.target.elementIds.filter((elementId) =>
    repairableElementIdSet.has(elementId),
  );
}
