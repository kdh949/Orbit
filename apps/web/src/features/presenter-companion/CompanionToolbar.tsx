import {
  IconArrowBackUp,
  IconEraser,
  IconHighlight,
  IconPencil,
  IconPointer,
  IconTrash,
  type Icon,
} from "@tabler/icons-react";

export type CompanionDrawingTool =
  | "eraser"
  | "highlighter"
  | "laser"
  | "pen";
export type CompanionInkColor =
  | "ink-black"
  | "ink-blue"
  | "ink-green"
  | "ink-red"
  | "ink-yellow";

export const companionStrokeWidthOptions = {
  highlighter: [0.012, 0.025, 0.035, 0.05],
  pen: [0.004, 0.008, 0.014, 0.022],
} as const satisfies Record<"highlighter" | "pen", readonly number[]>;

const drawingTools = [
  { icon: IconPencil, tool: "pen" },
  { icon: IconHighlight, tool: "highlighter" },
  { icon: IconEraser, tool: "eraser" },
  { icon: IconPointer, tool: "laser" },
] as const satisfies readonly { icon: Icon; tool: CompanionDrawingTool }[];

const inkColors = [
  "ink-black",
  "ink-blue",
  "ink-red",
  "ink-green",
  "ink-yellow",
] as const satisfies readonly CompanionInkColor[];

export function CompanionToolbar(props: {
  canClear: boolean;
  canUndo: boolean;
  color: CompanionInkColor;
  disabled: boolean;
  onClear: () => void;
  onColorChange: (color: CompanionInkColor) => void;
  onToolChange: (tool: CompanionDrawingTool) => void;
  onUndo: () => void;
  onWidthChange: (width: number) => void;
  tool: CompanionDrawingTool;
  width: number;
  widthOptions: readonly number[];
}) {
  const paletteOpen =
    props.tool === "pen" || props.tool === "highlighter";

  return (
    <>
      <nav
        aria-label="iPad 주석 도구"
        className="presenter-companion-toolbar"
      >
        <div className="presenter-companion-toolbar-tools">
          {drawingTools.map(({ icon: ToolIcon, tool }) => (
            <button
              aria-label={getToolLabel(tool)}
              aria-pressed={props.tool === tool}
              className="presenter-companion-tool-button"
              disabled={props.disabled}
              key={tool}
              onClick={() => props.onToolChange(tool)}
              type="button"
            >
              <ToolIcon aria-hidden="true" size={22} stroke={1.8} />
              <span>{getToolLabel(tool)}</span>
            </button>
          ))}
        </div>
        <span
          aria-hidden="true"
          className="presenter-companion-toolbar-divider"
        />
        <div className="presenter-companion-toolbar-actions">
          <button
            aria-label="실행 취소"
            className="presenter-companion-tool-button"
            disabled={props.disabled || !props.canUndo}
            onClick={props.onUndo}
            type="button"
          >
            <IconArrowBackUp aria-hidden="true" size={22} stroke={1.8} />
            <span>실행 취소</span>
          </button>
          <button
            aria-label="모두 지우기"
            className="presenter-companion-tool-button"
            disabled={props.disabled || !props.canClear}
            onClick={props.onClear}
            type="button"
          >
            <IconTrash aria-hidden="true" size={22} stroke={1.8} />
            <span>전체 지우기</span>
          </button>
        </div>
      </nav>
      {paletteOpen ? (
        <aside
          aria-label={`${getToolLabel(props.tool)} 설정`}
          className="presenter-companion-palette"
        >
          <div className="presenter-companion-palette-section">
            <strong>굵기</strong>
            <div className="presenter-companion-width-tools">
              {props.widthOptions.map((width, index) => (
                <button
                  aria-label={`${getToolLabel(props.tool)} 굵기 ${index + 1}`}
                  aria-pressed={props.width === width}
                  disabled={props.disabled}
                  key={width}
                  onClick={() => props.onWidthChange(width)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    style={{
                      height: `${Math.max(2, Math.round(width * 260))}px`,
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
          <div className="presenter-companion-palette-section">
            <strong>색상</strong>
            <div className="presenter-companion-color-tools">
              {inkColors.map((color) => (
                <button
                  aria-label={getColorLabel(color)}
                  aria-pressed={props.color === color}
                  className={`presenter-companion-color presenter-companion-color--${color}`}
                  disabled={props.disabled}
                  key={color}
                  onClick={() => props.onColorChange(color)}
                  type="button"
                />
              ))}
            </div>
          </div>
        </aside>
      ) : null}
    </>
  );
}

function getColorLabel(color: CompanionInkColor): string {
  return {
    "ink-black": "검정",
    "ink-blue": "파랑",
    "ink-red": "빨강",
    "ink-green": "초록",
    "ink-yellow": "노랑",
  }[color];
}

function getToolLabel(tool: CompanionDrawingTool): string {
  if (tool === "pen") return "펜";
  if (tool === "highlighter") return "형광펜";
  if (tool === "laser") return "레이저";
  return "지우개";
}
