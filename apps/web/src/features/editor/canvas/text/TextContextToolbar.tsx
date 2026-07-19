import {
  applyRichTextCharacterStyle,
  applyRichTextParagraphStyle,
  getRichTextSelectionCharacterStyle,
  getRichTextSelectionParagraphStyle,
  getRichTextSemanticText,
  type RichTextCharacterStylePatch,
  type RichTextParagraphStylePatch,
  type RichTextRange,
} from "@orbit/editor-core";
import type {
  Deck,
  DeckElement,
  Slide,
  TextElementBullet,
} from "@orbit/shared";
import type { FontAssetGroup } from "@orbit/font-assets";
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconChevronDown,
  IconClearFormatting,
  IconHighlight,
  IconIndentDecrease,
  IconIndentIncrease,
  IconItalic,
  IconLetterCase,
  IconLineHeight,
  IconLink,
  IconList,
  IconListNumbers,
  IconMinus,
  IconPlus,
  IconTypography,
  IconUnderline,
} from "@tabler/icons-react";
import {
  type MouseEvent as ReactMouseEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { getRotatedElementAabb } from "../utils/canvasInteractionUtils";
import {
  ensureFontLoaded,
  supportedEditorFonts,
  type FontLoadResult,
} from "../../../fonts/fontRegistry";
import { ToolbarPopover } from "../../toolbar/ToolbarPopover";
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
  disabledReason?: string;
  family: string;
  group: FontAssetGroup;
  label: string;
  supportsKorean: boolean;
};

const bundledTextFontFamilies = supportedEditorFonts.map((font) => font.family);
const fontGroupLabels: Record<FontAssetGroup, string> = {
  basic: "기본",
  "korean-design": "한글 디자인",
  "english-design": "영문 디자인",
};
const fontPurposeLabels: Record<string, string> = {
  "Noto Serif KR": "한글 명조",
  "Nanum Myeongjo": "한글 본문",
  "Black Han Sans": "한글 제목",
  "Do Hyeon": "한글 제목",
  Jua: "한글 제목",
  Montserrat: "영문 제목·본문",
  Poppins: "영문 제목·본문",
  "Playfair Display": "영문 제목",
  Merriweather: "영문 본문",
  "Bebas Neue": "영문 제목",
};
const textAlignmentOptions = [
  { Icon: IconAlignLeft, label: "왼쪽", value: "left" },
  { Icon: IconAlignCenter, label: "가운데", value: "center" },
  { Icon: IconAlignRight, label: "오른쪽", value: "right" },
  { Icon: IconAlignJustified, label: "양쪽", value: "justify" },
] as const;
const lineHeightOptions = [
  { label: "1.0", value: 1 },
  { label: "1.15", value: 1.15 },
  { label: "1.2", value: 1.2 },
  { label: "1.5", value: 1.5 },
  { label: "2.0", value: 2 },
] as const;
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
  selectionContainsKorean?: boolean;
}): TextContextToolbarFontOption[] {
  const seen = new Set<string>();
  const options: TextContextToolbarFontOption[] = [];
  for (const family of args.loadedFontFamilies) {
    const normalized = family.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const definition = supportedEditorFonts.find(
      (font) => font.family === normalized,
    );
    const englishOnly = definition?.supportsKorean === false;
    const disabledReason =
      englishOnly && args.selectionContainsKorean
        ? "한글이 포함된 선택 영역에는 사용할 수 없는 영문 전용 글꼴입니다."
        : undefined;
    options.push({
      available: !disabledReason,
      disabledReason,
      family: normalized,
      group: definition?.group ?? "basic",
      label: fontPurposeLabels[normalized]
        ? `${normalized} · ${fontPurposeLabels[normalized]}`
        : normalized,
      supportsKorean: definition?.supportsKorean ?? true,
    });
  }

  const current = args.currentFontFamily?.trim();
  if (args.isImported && current && !seen.has(current)) {
    options.push({
      available: false,
      disabledReason: "이 문서에서 가져온 글꼴은 현재 지원하지 않습니다.",
      family: current,
      group: "basic",
      label: current,
      supportsKorean: true,
    });
  }
  return options;
}

export async function loadAndCommitTextFont(args: {
  action: TextContextToolbarAction;
  element: TextElement;
  loadFont?: (request: {
    family: string;
    style?: "italic" | "normal";
    text?: string;
    weight?: number;
  }) => Promise<FontLoadResult>;
  onCommitProps: (elementId: string, props: Record<string, unknown>) => void;
  range: RichTextRange | null;
  request: {
    family: string;
    style: "italic" | "normal";
    text: string;
    weight: number;
  };
  shouldCommit?: () => boolean;
}) {
  const result = await (args.loadFont ?? ensureFontLoaded)(args.request);
  if (result.status !== "loaded" || args.shouldCommit?.() === false) return result;
  commitTextContextToolbarAction({
    action: args.action,
    element: args.element,
    onCommitProps: args.onCommitProps,
    range: args.range,
  });
  return result;
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
  const fontLoadRequestRef = useRef(0);
  const [fontLoadState, setFontLoadState] = useState<
    "error" | "idle" | "loading"
  >("idle");
  const dockTarget =
    typeof document === "undefined"
      ? null
      : document.getElementById("editor-command-context");
  const [placement, setPlacement] =
    useState<TextContextToolbarPlacement | null>(null);
  const updatePlacement = useCallback(() => {
    const toolbar = toolbarRef.current;
    if (dockTarget || !toolbar || !stageElement || typeof window === "undefined") return;
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
    dockTarget,
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
    if (!dockTarget) updatePlacement();
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
  }, [dockTarget, readOnly, stageElement, updatePlacement]);

  if (readOnly) return null;

  const activeRange = getActiveRange(range);
  const semanticText = getRichTextSemanticText(element.props);
  const selectionRange = activeRange ?? {
    end: semanticText.length,
    start: 0,
  };
  const selectedText = semanticText.slice(
    selectionRange.start,
    selectionRange.end,
  );
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
    selectionContainsKorean: /[\u3131-\u318e\uac00-\ud7a3]/u.test(selectedText),
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
  const AlignmentIcon =
    alignValue === "center"
      ? IconAlignCenter
      : alignValue === "right"
        ? IconAlignRight
        : alignValue === "justify"
          ? IconAlignJustified
          : IconAlignLeft;
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

  async function selectFont(family: string) {
    const option = fontOptions.find((candidate) => candidate.family === family);
    if (!option?.available) return;
    const requestId = fontLoadRequestRef.current + 1;
    fontLoadRequestRef.current = requestId;
    setFontLoadState("loading");
    const result = await loadAndCommitTextFont({
      action: { kind: "character", patch: { fontFamily: family } },
      element,
      onCommitProps,
      range: activeRange,
      request: {
        family,
        style: italicPressed === true ? "italic" : "normal",
        text: selectedText,
        weight: boldPressed === true ? 700 : 400,
      },
      shouldCommit: () => fontLoadRequestRef.current === requestId,
    });
    if (fontLoadRequestRef.current !== requestId) return;
    setFontLoadState(result.status === "loaded" ? "idle" : "error");
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
      role="group"
      style={{
        left: dockTarget ? undefined : (placement?.left ?? 0),
        position: dockTarget ? "static" : "fixed",
        top: dockTarget ? undefined : (placement?.top ?? 0),
        visibility: dockTarget || placement || !stageElement ? "visible" : "hidden",
      }}
      title={disabledReason}
    >
      <ToolbarPopover
        buttonClassName="text-context-toolbar-font-trigger"
        buttonContent={
          <>
            <IconTypography aria-hidden="true" size={17} />
            <span>
              {characterStyle.fontFamily.mixed
                ? "혼합"
                : currentFontFamily || "글꼴 선택"}
            </span>
            <IconChevronDown aria-hidden="true" size={13} />
          </>
        }
        contentLabel="글꼴 선택"
        contentRole="listbox"
        disabled={disabled || fontLoadState === "loading"}
        label="글꼴"
        onPreserveInteraction={onPreserveRange}
      >
        {({ close }) =>
          (Object.keys(fontGroupLabels) as FontAssetGroup[]).map((group) => {
            const options = fontOptions.filter((option) => option.group === group);
            return options.length ? (
              <div className="text-context-toolbar-font-group" key={group} role="group">
                <span className="editor-toolbar-popover-section-label">
                  {fontGroupLabels[group]}
                </span>
                {options.map((option) => (
                  <button
                    aria-disabled={!option.available}
                    aria-selected={option.family === fontValue}
                    disabled={!option.available}
                    key={option.family}
                    role="option"
                    style={{ fontFamily: option.family }}
                    title={option.disabledReason}
                    type="button"
                    onClick={() => {
                      void selectFont(option.family);
                      close();
                    }}
                  >
                    {option.label}
                    {option.available ? "" : " (사용 불가)"}
                  </button>
                ))}
              </div>
            ) : null;
          })
        }
      </ToolbarPopover>
      <span aria-live="polite" className="text-context-toolbar-font-status">
        {fontLoadState === "loading"
          ? "글꼴 불러오는 중"
          : fontLoadState === "error"
            ? "글꼴을 불러오지 못했습니다"
            : ""}
      </span>

      <div
        aria-label="글자 크기"
        className="text-context-toolbar-size"
        role="group"
      >
        <button
          aria-label="글자 크기 줄이기"
          disabled={disabled}
          title="글자 크기 줄이기"
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
          <IconMinus aria-hidden="true" size={16} />
        </button>
        <ToolbarPopover
          buttonClassName="text-context-toolbar-size-value"
          buttonContent={<span>{fontSize ?? "혼합"}</span>}
          contentLabel="글자 크기 입력"
          disabled={disabled}
          label="글자 크기"
          onPreserveInteraction={onPreserveRange}
        >
          <input
            aria-label="글자 크기 입력"
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
        </ToolbarPopover>
        <button
          aria-label="글자 크기 늘리기"
          disabled={disabled}
          title="글자 크기 늘리기"
          type="button"
          onClick={() =>
            commit({
              kind: "character",
              patch: { fontSize: (fontSize ?? element.props.fontSize) + 1 },
            })
          }
          onMouseDown={preserveTextRange}
        >
          <IconPlus aria-hidden="true" size={16} />
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
          title="굵게"
          type="button"
          onClick={() =>
            commit({
              kind: "character",
              patch: { fontWeight: boldPressed === true ? "normal" : "bold" },
            })
          }
          onMouseDown={preserveTextRange}
        >
          <IconBold aria-hidden="true" size={17} />
        </button>
        <button
          aria-label="기울임"
          aria-pressed={italicPressed}
          disabled={disabled}
          title="기울임"
          type="button"
          onClick={() =>
            commit({
              kind: "character",
              patch: { italic: italicPressed === true ? false : true },
            })
          }
          onMouseDown={preserveTextRange}
        >
          <IconItalic aria-hidden="true" size={17} />
        </button>
        <button
          aria-label="밑줄"
          aria-pressed={underlinePressed}
          disabled={disabled}
          title="밑줄"
          type="button"
          onClick={() =>
            commit({
              kind: "character",
              patch: { underline: underlinePressed === true ? false : true },
            })
          }
          onMouseDown={preserveTextRange}
        >
          <IconUnderline aria-hidden="true" size={17} />
        </button>
      </div>

      <ToolbarPopover
        buttonClassName="editor-toolbar-color-trigger"
        buttonContent={
          <>
            <IconLetterCase aria-hidden="true" size={18} />
            <span
              aria-hidden="true"
              className="editor-toolbar-color-swatch"
              style={{ "--toolbar-swatch-color": colorValue } as CSSProperties}
            />
          </>
        }
        contentLabel="글자색 선택"
        disabled={disabled}
        label={characterStyle.color.mixed ? "글자색 (혼합)" : "글자색"}
        onPreserveInteraction={onPreserveRange}
      >
        <label className="text-context-toolbar-popover-field">
          <span>글자색</span>
          <input
            aria-label="글자색 선택"
            type="color"
            value={colorValue}
            onChange={(event) =>
              commit({ kind: "character", patch: { color: event.target.value } })
            }
          />
        </label>
      </ToolbarPopover>

      <ToolbarPopover
        buttonClassName="editor-toolbar-color-trigger"
        buttonContent={
          <>
            <IconHighlight aria-hidden="true" size={18} />
            <span
              aria-hidden="true"
              className="editor-toolbar-color-swatch"
              style={{
                "--toolbar-swatch-color": toInputColor(
                  characterStyle.highlightColor.value,
                  "#FEF08A",
                ),
              } as CSSProperties}
            />
          </>
        }
        contentLabel="강조색 선택"
        disabled={disabled}
        label="강조색"
        onPreserveInteraction={onPreserveRange}
      >
        <label className="text-context-toolbar-popover-field">
          <span>강조색</span>
          <input
            aria-label="강조색 선택"
            type="color"
            value={toInputColor(characterStyle.highlightColor.value, "#FEF08A")}
            onChange={(event) =>
              commit({
                kind: "character",
                patch: { highlightColor: event.target.value },
              })
            }
          />
        </label>
      </ToolbarPopover>

      <TextLinkPopover
        disabled={disabled}
        value={characterStyle.hyperlink.value ?? ""}
        onCommit={(hyperlink) =>
          commit({ kind: "character", patch: { hyperlink } })
        }
        onPreserveRange={onPreserveRange}
      />

      <ToolbarPopover
        active={paragraphStyle.align.mixed ? "mixed" : undefined}
        buttonContent={
          <>
            <AlignmentIcon aria-hidden="true" size={17} />
            <IconChevronDown aria-hidden="true" size={12} />
          </>
        }
        contentLabel="문단 정렬 선택"
        contentRole="menu"
        disabled={disabled}
        label="문단 정렬"
        onPreserveInteraction={onPreserveRange}
      >
        {({ close }) =>
          textAlignmentOptions.map(({ Icon: AlignIcon, label, value }) => (
            <button
              aria-checked={alignValue === value}
              key={value}
              role="menuitemradio"
              type="button"
              onClick={() => {
                commit({
                  kind: "paragraph",
                  patch: { align: value },
                });
                close();
              }}
            >
              <AlignIcon aria-hidden="true" size={17} />
              {label}
            </button>
          ))
        }
      </ToolbarPopover>

      <button
        aria-label="글머리 기호"
        aria-pressed={bulletPressed}
        disabled={disabled}
        title="글머리 기호"
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
        <IconList aria-hidden="true" size={17} />
      </button>

      <button
        aria-label="번호 매기기"
        aria-pressed={
          paragraphStyle.bullet.mixed
            ? "mixed"
            : paragraphStyle.bullet.value?.enabled &&
                paragraphStyle.bullet.value.kind === "number"
              ? true
              : false
        }
        disabled={disabled}
        title="번호 매기기"
        type="button"
        onClick={() => {
          const current = paragraphStyle.bullet.mixed
            ? undefined
            : paragraphStyle.bullet.value;
          commit({
            kind: "paragraph",
            patch: {
              bullet: {
                character: current?.character ?? "•",
                enabled: !(current?.enabled && current.kind === "number"),
                indent: current?.indent ?? 24,
                kind: "number",
                numberStyle: current?.numberStyle ?? "decimal",
                startAt: current?.startAt ?? 1,
              },
            },
          });
        }}
        onMouseDown={preserveTextRange}
      >
        <IconListNumbers aria-hidden="true" size={17} />
      </button>

      <button
        aria-label="들여쓰기 줄이기"
        disabled={disabled}
        title="들여쓰기 줄이기"
        type="button"
        onClick={() =>
          commit({
            kind: "paragraph",
            patch: {
              indent: Math.max(0, (paragraphStyle.indent.value ?? 0) - 12),
            },
          })
        }
        onMouseDown={preserveTextRange}
      >
        <IconIndentDecrease aria-hidden="true" size={17} />
      </button>
      <button
        aria-label="들여쓰기 늘리기"
        disabled={disabled}
        title="들여쓰기 늘리기"
        type="button"
        onClick={() =>
          commit({
            kind: "paragraph",
            patch: { indent: (paragraphStyle.indent.value ?? 0) + 12 },
          })
        }
        onMouseDown={preserveTextRange}
      >
        <IconIndentIncrease aria-hidden="true" size={17} />
      </button>

      <ToolbarPopover
        buttonContent={
          <>
            <IconLineHeight aria-hidden="true" size={17} />
            <IconChevronDown aria-hidden="true" size={12} />
          </>
        }
        contentLabel="줄 간격 선택"
        contentRole="menu"
        disabled={disabled}
        label="줄 간격"
        onPreserveInteraction={onPreserveRange}
      >
        {({ close }) =>
          lineHeightOptions.map(({ label, value }) => (
            <button
              aria-checked={paragraphStyle.lineHeight.value === value}
              key={value}
              role="menuitemradio"
              type="button"
              onClick={() => {
                commit({ kind: "paragraph", patch: { lineHeight: value } });
                close();
              }}
            >
              {label}
            </button>
          ))
        }
      </ToolbarPopover>

      <button
        aria-label="서식 지우기"
        disabled={disabled}
        title="서식 지우기"
        type="button"
        onClick={() => {
          commit({
            kind: "character",
            patch: {
              color: element.props.color ?? slide.style.textColor ?? deck.theme.textColor,
              fontFamily:
                element.props.fontFamily ??
                slide.style.fontFamily ??
                deck.theme.typography.bodyFontFamily,
              fontSize: element.props.fontSize,
              fontWeight: element.props.fontWeight,
              highlightColor: null,
              hyperlink: null,
              italic: element.props.italic ?? false,
              underline: element.props.underline ?? false,
            },
          });
        }}
        onMouseDown={preserveTextRange}
      >
        <IconClearFormatting aria-hidden="true" size={17} />
      </button>

      {disabledReason ? (
        <span className="text-context-toolbar-disabled-reason" role="status">
          {disabledReason}
        </span>
      ) : null}
    </div>
  );

  if (dockTarget) return createPortal(content, dockTarget);
  if (typeof document === "undefined" || !document.body) return content;
  return createPortal(content, document.body);
}

function TextLinkPopover(props: {
  disabled: boolean;
  onCommit: (hyperlink: string | null) => void;
  onPreserveRange?: () => void;
  value: string;
}) {
  const [draft, setDraft] = useState(props.value || "https://");

  useEffect(() => {
    setDraft(props.value || "https://");
  }, [props.value]);

  return (
    <ToolbarPopover
      active={Boolean(props.value)}
      buttonContent={<IconLink aria-hidden="true" size={17} />}
      contentLabel="링크 편집"
      disabled={props.disabled}
      label="링크"
      onOpenChange={(isOpen) => {
        if (isOpen) setDraft(props.value || "https://");
      }}
      onPreserveInteraction={props.onPreserveRange}
    >
      {({ close }) => (
        <form
          className="text-context-toolbar-link-form"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = draft.trim();
            props.onCommit(normalized ? normalized : null);
            close();
          }}
        >
          <input
            autoFocus
            aria-label="링크 URL"
            inputMode="url"
            type="url"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="text-context-toolbar-link-actions">
            {props.value ? (
              <button
                type="button"
                onClick={() => {
                  props.onCommit(null);
                  close();
                }}
              >
                제거
              </button>
            ) : null}
            <button type="submit">적용</button>
          </div>
        </form>
      )}
    </ToolbarPopover>
  );
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
