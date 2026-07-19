import type { Deck } from "@orbit/shared";
import type Konva from "konva";
import { IconX as X } from "@tabler/icons-react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { OrbitButton, OrbitIconButton } from "../../../../components/ui";
import { buildSlideBackgroundStyle } from "../../../slides/rendering/SlideBackground";
import {
  EditableCanvas,
  getRenderableSlideElements
} from "../../canvas/EditorCanvas";

type DesignProposalPreviewModalProps = {
  deck: Deck;
  slideId: string;
  summary: string;
  warnings: string[];
  isApplying: boolean;
  onApply: () => void;
  onClose: () => void;
};

export function DesignProposalPreviewModal(
  props: DesignProposalPreviewModalProps
) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const slide = props.deck.slides.find((item) => item.slideId === props.slideId);
  if (!slide) return null;

  const scale = Math.min(0.36, 680 / props.deck.canvas.width);
  const content = (
    <div
      className="design-proposal-modal-backdrop"
      role="presentation"
      onMouseDown={props.onClose}
    >
      <section
        aria-label="AI 디자인 제안 미리보기"
        aria-modal="true"
        className="design-proposal-modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="design-proposal-modal-header">
          <div>
            <strong>이렇게 적용해볼까요?</strong>
            <span>{props.summary}</span>
          </div>
          <OrbitIconButton
            aria-label="미리보기 닫기"
            className="design-proposal-close-button"
            variant="surface"
            onClick={props.onClose}
          >
            <X size={18} />
          </OrbitIconButton>
        </header>

        <div className="design-proposal-canvas-wrap">
          <div
            className="konva-stage-shell design-proposal-stage-shell"
            style={{
              width: props.deck.canvas.width * scale,
              height: props.deck.canvas.height * scale,
              color: slide.style.textColor ?? props.deck.theme.textColor,
              ...buildSlideBackgroundStyle(slide, props.deck)
            }}
          >
            <EditableCanvas
              customShapeEditElementId={null}
              deck={props.deck}
              disableInteractions
              editingElementId={null}
              insertTool="select"
              selectedElementIds={[]}
              showIds={false}
              slide={slide}
              stageScale={scale}
              stageRef={stageRef}
              visibleElements={getRenderableSlideElements(slide, props.deck.canvas)}
              onClearSelection={() => undefined}
              onCommitElementProps={() => undefined}
              onCommitElementFrame={() => undefined}
              onCreateElement={() => undefined}
              onCreateCustomShape={() => undefined}
              onCommitCustomShapeGeometry={() => undefined}
              onDoubleClickElement={() => undefined}
              onFinishEditing={() => undefined}
              onOpenElementContextMenu={() => undefined}
              onSetCustomShapeEditElementId={() => undefined}
              onSetInsertTool={() => undefined}
              onSelectElement={() => undefined}
              onSelectElements={() => undefined}
            />
          </div>
        </div>

        {props.warnings.length ? (
          <p className="design-proposal-warning">{props.warnings.join(" ")}</p>
        ) : null}

        <footer className="design-proposal-modal-footer">
          <OrbitButton variant="secondary" onClick={props.onClose}>
            취소
          </OrbitButton>
          <OrbitButton
            loading={props.isApplying}
            variant="primary"
            onClick={props.onApply}
          >
            {props.isApplying ? "적용 중..." : "적용"}
          </OrbitButton>
        </footer>
      </section>
    </div>
  );

  if (typeof document === "undefined" || !document.body) return content;
  return createPortal(content, document.body);
}
