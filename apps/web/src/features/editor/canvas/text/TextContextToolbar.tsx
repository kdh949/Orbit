import {
  applyRichTextCharacterStyle,
  applyRichTextParagraphStyle,
  getRichTextSelectionCharacterStyle,
  getRichTextSelectionParagraphStyle,
  getRichTextSemanticText,
  type RichTextCharacterStylePatch,
  type RichTextParagraphStylePatch,
  type RichTextRange,
} from "@orbit/editor-core/text";
import type {
  Deck,
  DeckElement,
  Slide,
  TextElementBullet,
} from "@orbit/shared";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { getRotatedElementAabb } from "../utils/canvasInteractionUtils";
import { getRichTextStyleActionState } from "./richTextEditCapability";
import "./TextContextToolbar.css";

type TextElement = Extract<DeckElement, { type: "text" }>;

export type TextContextToolbarAction =
  | { kind: "character"; patch: RichTextCharacterStylePatch }
  | { kind: "paragraph"; patch: RichTextParagraphStylePatch };

export type TextContextToolbarPlacement = {
  left: number;
  side: "above" | "below";
  top: number;
};

export type TextContextToolbarFontOption = {
  available: boolean;
  family: string;
};

const bundledTextFontFamilies = ["Pretendard"] as const;
const toolbarGap = 8;
const viewportPadding = 12;

export function getTextContextToolbarPlacement(args: {
  element: Pick<TextElement, "height" | "rotation" | "width" | "x" | "y">;
  stageRect: { left: number; top: number };
  stageScale: number;
  toolbarSize: { height: number; width: number };
  viewportSize: { height: number; width: number };
}): TextContextToolbarPlacement {
  const scale = Math.max(0.0001, args.stageScale);
  const anchor = getRotatedElementAabb(args.element);
  const anchorLeft = args.stageRect.left + anchor.x * scale;
  const anchorTop = args.stageRect.top + anchor.y * scale;
  const anchorWidth = anchor.width * scale;
  const anchorBottom = anchorTop + anchor.height * scale;
  const maxLeft = Math.max(
    viewportPadding,
    args.viewportSize.width - args.toolbarSize.width - viewportPadding,
  );
  const left = clamp(
    anchorLeft + anchorWidth / 2 - args.toolbarSize.width / 2,
    viewportPadding,
    maxLeft,
  );
  const aboveTop = anchorTop - args.toolbarSize.height - toolbarGap;
  const belowTop = anchorBottom + toolbarGap;
  const canFitAbove = aboveTop >= viewportPadding;
  const side = canFitAbove ? "above" : "below";
  const desiredTop = canFitAbove ? aboveTop : belowTop;
  const maxTop = Math.max(
    viewportPadding,
    args.viewportSize.height - args.toolbarSize.height - viewportPadding,
  );

  return {
    left,
    side,
    top: clamp(desiredTop, viewportPadding, maxTop),
  };
}

export function getTextContextToolbarFontOptions(args: {
  currentFontFamily?: string;
  isImported: boolean;
  loadedFontFamilies: readonly string[];
}): TextContextToolbarFontOption[] {
  const seen = new Set<string>();
  const options: TextContextToolbarFontOption[] = [];
  for (const family of args.loadedFontFamilies) {
    const normalized = family.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    options.push({ available: true, family: normalized });
  }

  const current = args.currentFontFamily?.trim();
  if (args.isImported && current && !seen.has(current)) {
    options.push({ available: false, family: current });
  }
  return options;
}

export function commitTextContextToolbarAction(args: {
  action: TextContextToolbarAction;
  element: TextElement;
  onCommitProps: (elementId: string, props: Record<string, unknown>) => void;
  range: RichTextRange | null;
}) {
  const range = getActiveRange(args.range);
  if (!range) {
    const props =
      args.action.kind === "character"
        ? { ...args.action.patch }
        : applyRichTextParagraphStyle(
            args.element.props,
            {
              end: getRichTextSemanticText(args.element.props).length,
              start: 0,
            },
            args.action.patch,
          );
    args.onCommitProps(args.element.elementId, props);
    return;
  }

  const props =
    args.action.kind === "character"
      ? applyRichTextCharacterStyle(
          args.element.props,
          range,
          args.action.patch,
        )
      : applyRichTextParagraphStyle(
          args.element.props,
          range,
          args.action.patch,
        );
  args.onCommitProps(args.element.elementId, props);
}

export function TextContextToolbar(props: {
  deck: Deck;
  editCompositeId?: string;
  element: TextElement;
  loadedFontFamilies?: readonly string[];
  range?: RichTextRange | null;
  readOnly: boolean;
  slide: Slide;
  stageElement: HTMLElement | null;
  stageScale: number;
  onCommitProps: (elementId: string, props: Record<string, unknown>) => void;
  onEditCompositeBlur?: (nextTarget: Node | null) => void;
  onPreserveRange?: () => void;
}) {
  const {
    deck,
    editCompositeId,
    element,
    loadedFontFamilies = bundledTextFontFamilies,
    range = null,
    readOnly,
    slide,
    stageElement,
    stageScale,
    onCommitProps,
    onEditCompositeBlur,
    onPreserveRange,
  } = props;
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] =
    useState<TextContextToolbarPlacement | null>(null);
  const updatePlacement = useCallback(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !stageElement || typeof window === "undefined") return;
    const stageRect = stageElement.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    setPlacement(
      getTextContextToolbarPlacement({
        element,
        stageRect,
        stageScale,
        toolbarSize: {
          height: toolbarRect.height,
          width: toolbarRect.width,
        },
        viewportSize: {
          height: window.innerHeight,
          width: window.innerWidth,
        },
      }),
    );
  }, [
    element.height,
    element.rotation,
    element.width,
    element.x,
    element.y,
    stageElement,
    stageScale,
  ]);

  useEffect(() => {
    if (readOnly) return;
    updatePlacement();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updatePlacement);
    if (resizeObserver && stageElement) resizeObserver.observe(stageElement);
    if (resizeObserver && toolbarRef.current) {
      resizeObserver.observe(toolbarRef.current);
    }
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
      resizeObserver?.disconnect();
    };
  }, [readOnly, stageElement, updatePlacement]);

  if (readOnly) return null;

  const activeRange = getActiveRange(range);
  const selectionRange = activeRange ?? {
    end: getRichTextSemanticText(element.props).length,
    start: 0,
  };
  const characterStyle = getRichTextSelectionCharacterStyle(
    element.props,
    selectionRange,
  );
  const paragraphStyle = getRichTextSelectionParagraphStyle(
    element.props,
    selectionRange,
  );
  const importedCapability =
    deck.metadata.sourceType === "import"
      ? getRichTextStyleActionState(deck, element)
      : null;
  const disabled = importedCapability ? !importedCapability.enabled : false;
  const disabledReason = importedCapability?.reason ?? undefined;
  const currentFontFamily = characterStyle.fontFamily.mixed
    ? undefined
    : (characterStyle.fontFamily.value ??
      element.props.fontFamily ??
      slide.style.fontFamily ??
      deck.theme.typography.bodyFontFamily);
  const fontOptions = getTextContextToolbarFontOptions({
    currentFontFamily,
    isImported: deck.metadata.sourceType === "import",
    loadedFontFamilies,
  });
  const fontValue = characterStyle.fontFamily.mixed
    ? "__mixed__"
    : fontOptions.some((option) => option.family === currentFontFamily)
      ? currentFontFamily
      : "";
  const fontSize = characterStyle.fontSize.mixed
    ? undefined
    : characterStyle.fontSize.value;
  const boldPressed = characterStyle.fontWeight.mixed
    ? "mixed"
    : isBoldWeight(characterStyle.fontWeight.value);
  const italicPressed = characterStyle.italic.mixed
    ? "mixed"
    : characterStyle.italic.value;
  const underlinePressed = characterStyle.underline.mixed
    ? "mixed"
    : characterStyle.underline.value;
  const alignValue = paragraphStyle.align.mixed
    ? "__mixed__"
    : paragraphStyle.align.value;
  const bulletPressed = paragraphStyle.bullet.mixed
    ? "mixed"
    : Boolean(paragraphStyle.bullet.value?.enabled);
  const colorValue = toInputColor(
    characterStyle.color.mixed
      ? element.props.color
      : characterStyle.color.value,
    slide.style.textColor ?? deck.theme.textColor,
  );

  function commit(action: TextContextToolbarAction) {
    commitTextContextToolbarAction({
      action,
      element,
      onCommitProps,
      range: activeRange,
    });
  }

  function preserveTextRange(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  const content = (
    <div
      aria-label="텍스트 서식"
      className="text-context-toolbar"
      data-text-edit-composite={editCompositeId}
      data-placement={placement?.side ?? "above"}
      onBlurCapture={(event) => onEditCompositeBlur?.(event.relatedTarget)}
      onPointerDownCapture={() => onPreserveRange?.()}
      ref={toolbarRef}
      role="toolbar"
      style={{
        left: placement?.left ?? 0,
        position: "fixed",
        top: placement?.top ?? 0,
        visibility: placement || !stageElement ? "visible" : "hidden",
      }}
      title={disabledReason}
    >
      <label className="text-context-toolbar-field text-context-toolbar-font">
        <span>글꼴</span>
        <select
          aria-label="글꼴"
          disabled={disabled}
          value={fontValue}
          onChange={(event) => {
            if (event.target.value) {
              commit({
                kind: "character",
                patch: { fontFamily: event.target.value },
              });
            }
          }}
        >
          {characterStyle.fontFamily.mixed ? (
            <option disabled value="__mixed__">
              혼합
            </option>
          ) : fontValue === "" ? (
            <option disabled value="">
              사용 가능한 글꼴 선택
            </option>
          ) : null}
          {fontOptions.map((option) => (
            <option
              disabled={!option.available}
              key={option.family}
              value={option.family}
            >
              {option.family}
              {option.available ? "" : " (사용 불가)"}
            </option>
          ))}
        </select>
      </label>

      <div
        aria-label="글자 크기"
        className="text-context-toolbar-size"
        role="group"
      >
        <button
          aria-label="글자 크기 줄이기"
          disabled={disabled}
          type="button"
          onClick={() =>
            commit({
              kind: "character",
              patch: {
                fontSize: Math.max(1, (fontSize ?? element.props.fontSize) - 1),
              },
            })
          }
          onMouseDown={preserveTextRange}
        >
          −
        </button>
        <input
          aria-label="글자 크기"
          disabled={disabled}
          min={1}
          placeholder={fontSize === undefined ? "혼합" : undefined}
          type="number"
          value={fontSize ?? ""}
          onChange={(event) => {
            const nextSize = Number(event.target.value);
            if (Number.isFinite(nextSize) && nextSize > 0) {
              commit({ kind: "character", patch: { fontSize: nextSize } });
            }
          }}
        />
        <button
          aria-label="글자 크기 늘리기"
          disabled={disabled}
          type="button"
          onClick={() =>
            commit({
              kind: "character",
              patch: { fontSize: (fontSize ?? element.props.fontSize) + 1 },
            })
          }
          onMouseDown={preserveTextRange}
        >
          +
        </button>
      </div>

      <div
        aria-label="문자 서식"
        className="text-context-toolbar-styles"
        role="group"
      >
        <button
          aria-label="굵게"
          aria-pressed={boldPressed}
          disabled={disabled}
          type="button"
          onClick={() =>
            commit({
              kind: "character",
              patch: { fontWeight: boldPressed === true ? "normal" : "bold" },
            })
          }
          onMouseDown={preserveTextRange}
        >
          B
        </button>
        <button
          aria-label="기울임"
          aria-pressed={italicPressed}
          disabled={disabled}
          type="button"
          onClick={() =>
            commit({
              kind: "character",
              patch: { italic: italicPressed === true ? false : true },
            })
          }
          onMouseDown={preserveTextRange}
        >
          I
        </button>
        <button
          aria-label="밑줄"
          aria-pressed={underlinePressed}
          disabled={disabled}
          type="button"
          onClick={() =>
            commit({
              kind: "character",
              patch: { underline: underlinePressed === true ? false : true },
            })
          }
          onMouseDown={preserveTextRange}
        >
          U
        </button>
      </div>

      <label className="text-context-toolbar-field text-context-toolbar-color">
        <span>{characterStyle.color.mixed ? "글자색 (혼합)" : "글자색"}</span>
        <input
          aria-label="글자색"
          disabled={disabled}
          type="color"
          value={colorValue}
          onChange={(event) =>
            commit({ kind: "character", patch: { color: event.target.value } })
          }
        />
      </label>

      <label className="text-context-toolbar-field text-context-toolbar-align">
        <span>문단 정렬</span>
        <select
          aria-label="문단 정렬"
          disabled={disabled}
          value={alignValue}
          onChange={(event) => {
            const align = event.target.value as
              | "center"
              | "justify"
              | "left"
              | "right";
            commit({ kind: "paragraph", patch: { align } });
          }}
        >
          {paragraphStyle.align.mixed ? (
            <option disabled value="__mixed__">
              혼합
            </option>
          ) : null}
          <option value="left">왼쪽</option>
          <option value="center">가운데</option>
          <option value="right">오른쪽</option>
          <option value="justify">양쪽</option>
        </select>
      </label>

      <button
        aria-label="글머리 기호"
        aria-pressed={bulletPressed}
        disabled={disabled}
        type="button"
        onClick={() => {
          const current = paragraphStyle.bullet.mixed
            ? undefined
            : paragraphStyle.bullet.value;
          const bullet: TextElementBullet = {
            character:
              current?.character ?? element.props.bullet?.character ?? "•",
            enabled: bulletPressed === true ? false : true,
            indent: current?.indent ?? element.props.bullet?.indent ?? 0,
          };
          commit({ kind: "paragraph", patch: { bullet } });
        }}
        onMouseDown={preserveTextRange}
      >
        • 목록
      </button>

      {disabledReason ? (
        <span className="text-context-toolbar-disabled-reason" role="status">
          {disabledReason}
        </span>
      ) : null}
    </div>
  );

  if (typeof document === "undefined" || !document.body) return content;
  return createPortal(content, document.body);
}

function getActiveRange(range: RichTextRange | null | undefined) {
  if (!range || range.start === range.end) return null;
  return range;
}

function isBoldWeight(value: TextElement["props"]["fontWeight"]) {
  if (typeof value === "number") return value >= 600;
  return value === "bold" || value === "semibold";
}

function toInputColor(value: string | undefined, fallback: string) {
  if (/^#[\da-f]{6}$/i.test(value ?? "")) return value!;
  if (/^#[\da-f]{6}$/i.test(fallback)) return fallback;
  return "#111827";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
