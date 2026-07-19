import {
  IconFocusCentered,
  IconZoomIn,
  IconZoomOut
} from "@tabler/icons-react";

type EditorZoomControlsProps = {
  canZoomIn: boolean;
  canZoomOut: boolean;
  isFitToViewport: boolean;
  onFitToViewport: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  scale: number;
};

export function EditorZoomControls(props: EditorZoomControlsProps) {
  return (
    <div className="canvas-zoom-controls" role="group" aria-label="캔버스 확대/축소">
      <button aria-label="캔버스 축소" disabled={!props.canZoomOut} title="축소" type="button" onClick={props.onZoomOut}>
        <IconZoomOut size={16} />
      </button>
      <button
        aria-label="캔버스에 맞추기"
        aria-pressed={props.isFitToViewport}
        className={props.isFitToViewport ? "active" : ""}
        title="작업 영역에 맞춤"
        type="button"
        onClick={props.onFitToViewport}
      >
        <IconFocusCentered size={16} />
        <output aria-label="현재 확대/축소" aria-live="polite">
          {Math.round(props.scale * 100)}%
        </output>
      </button>
      <button aria-label="캔버스 확대" disabled={!props.canZoomIn} title="확대" type="button" onClick={props.onZoomIn}>
        <IconZoomIn size={16} />
      </button>
    </div>
  );
}
