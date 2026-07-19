import { normalizeRichTextProps } from "@orbit/editor-core";
import type {
  Deck,
  DeckElement,
  Slide,
  TextElementParagraph,
  TextElementProps,
  TextElementRun,
} from "@orbit/shared";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  applyContentEditablePlainTextInput,
  applyContentEditablePlainTextPaste,
  createContentEditableEditSession,
  isContentEditableCompositeTarget,
  readContentEditablePlainText,
  restoreContentEditableRange,
  saveContentEditableRange,
  type ContentEditableLogicalRange,
} from "./contentEditableRange";
import { resolveTextBodyInset } from "../../../slides/rendering/richTextLayout";
import { getCssFontWeight, getTextElementLayout } from "./textLayout";
import type { ElementTransformFrame } from "../utils/selectionTransformer";
import { resolveWebFontFamily } from "../../../fonts/fontRegistry";

type TextElement = Extract<DeckElement, { type: "text" }>;

export type InlineTextEditorController = {
  applyDraftProps: (props: TextElementProps) => void;
  focus: () => void;
  getDraftProps: () => TextElementProps;
  handleCompositeBlur: (nextTarget: Node | null) => void;
  preserveRange: () => void;
  restoreRange: () => void;
};

type InlineTextEditorOverlayProps = {
  deck: Deck;
  editCompositeId?: string;
  element: DeckElement | null;
  frame?: ElementTransformFrame;
  slide: Slide;
  stageScale: number;
  onCommitProps: (elementId: string, props: Record<string, unknown>) => void;
  onDraftPropsChange?: (props: TextElementProps) => void;
  onFinishEditing: (options?: { clearSelection?: boolean }) => void;
  onRangeChange?: (range: ContentEditableLogicalRange | null) => void;
  shouldRetainEditingOnBlur?: () => boolean;
};

export const InlineTextEditorOverlay = forwardRef<
  InlineTextEditorController,
  InlineTextEditorOverlayProps
>(function InlineTextEditorOverlay(props, ref) {
  if (!props.element || props.element.type !== "text") return null;
  return <InlineTextEditorSurface {...props} element={props.element} ref={ref} />;
});

const InlineTextEditorSurface = forwardRef<
  InlineTextEditorController,
  Omit<InlineTextEditorOverlayProps, "element"> & { element: TextElement }
>(function InlineTextEditorSurface(props, ref) {
  const {
    deck,
    editCompositeId,
    element,
    frame: previewFrame,
    slide,
    stageScale,
    onCommitProps,
    onDraftPropsChange,
    onFinishEditing,
    onRangeChange,
    shouldRetainEditingOnBlur,
  } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pendingRangeRestoreRef = useRef(false);
  const rangeRef = useRef<ContentEditableLogicalRange | null>(null);
  const callbacksRef = useRef({
    onCommitProps,
    onDraftPropsChange,
    onFinishEditing,
    onRangeChange,
    shouldRetainEditingOnBlur,
  });
  callbacksRef.current = {
    onCommitProps,
    onDraftPropsChange,
    onFinishEditing,
    onRangeChange,
    shouldRetainEditingOnBlur,
  };
  const initialProps = useMemo(
    () => normalizeRichTextProps(element.props),
    [element.elementId],
  );
  const [renderedProps, setRenderedProps] = useState(initialProps);
  const session = useMemo(
    () =>
      createContentEditableEditSession({
        initialProps,
        onCommit: (nextProps) =>
          callbacksRef.current.onCommitProps(element.elementId, nextProps),
        onFinish: () => callbacksRef.current.onFinishEditing(),
      }),
    [element.elementId],
  );

  function publishDraft(nextProps: TextElementProps) {
    callbacksRef.current.onDraftPropsChange?.(structuredClone(nextProps));
  }

  function preserveRange() {
    const root = rootRef.current;
    const selection = typeof window === "undefined" ? null : window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    const domRange = selection.getRangeAt(0);
    if (
      !root.contains(domRange.startContainer) ||
      !root.contains(domRange.endContainer)
    ) {
      return;
    }
    const range = saveContentEditableRange(root, domRange);
    rangeRef.current = range;
    callbacksRef.current.onRangeChange?.(range);
  }

  function restoreRange() {
    const root = rootRef.current;
    const bookmark = rangeRef.current;
    if (!root || !bookmark || typeof window === "undefined") return;
    const boundary = restoreContentEditableRange(root, bookmark);
    if (!boundary) return;
    const domRange = document.createRange();
    domRange.setStart(boundary.startContainer, boundary.startOffset);
    domRange.setEnd(boundary.endContainer, boundary.endOffset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(domRange);
  }

  function applyDraftProps(nextProps: TextElementProps) {
    preserveRange();
    const nextDraft = session.replaceDraft(nextProps);
    pendingRangeRestoreRef.current = true;
    setRenderedProps(nextDraft);
    publishDraft(nextDraft);
  }

  function getCompositeRoots() {
    const root = rootRef.current;
    if (!root) return [];
    const toolbar = editCompositeId
      ? document.querySelector<HTMLElement>(
          `.text-context-toolbar[data-text-edit-composite="${CSS.escape(editCompositeId)}"]`,
        )
      : null;
    return toolbar ? [root, toolbar] : [root];
  }

  function handleCompositeBlur(nextTarget: Node | null) {
    if (callbacksRef.current.shouldRetainEditingOnBlur?.()) return;

    const resolveBlur = (target: Node | null) =>
      session.handleBlur({
        nextTargetInsideComposite: isContentEditableCompositeTarget(
          target,
          getCompositeRoots(),
        ),
      });

    if (nextTarget) {
      resolveBlur(nextTarget);
      return;
    }

    queueMicrotask(() => resolveBlur(document.activeElement));
  }

  useImperativeHandle(
    ref,
    () => ({
      applyDraftProps,
      focus: () => {
        rootRef.current?.focus();
        restoreRange();
      },
      getDraftProps: session.getDraft,
      handleCompositeBlur,
      preserveRange,
      restoreRange,
    }),
    [editCompositeId, session],
  );

  useEffect(() => {
    publishDraft(session.getDraft());
    rootRef.current?.focus();
  }, [session]);

  useEffect(() => {
    function handleSelectionChange() {
      preserveRange();
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  const baseColor =
    renderedProps.color ?? slide.style.textColor ?? deck.theme.textColor;
  const canonicalBaseFontFamily =
    renderedProps.fontFamily ??
    slide.style.fontFamily ??
    deck.theme.typography.bodyFontFamily;
  const baseFontFamily = resolveWebFontFamily(canonicalBaseFontFamily);
  const paragraphs = renderedProps.paragraphs ?? [];
  const bodyInset = resolveTextBodyInset(renderedProps);
  const frame = previewFrame ?? element;
  const textLayout = getTextElementLayout({
    frame: {
      height: frame.height,
      rotation: frame.rotation,
      width: frame.width,
      x: frame.x,
      y: frame.y,
    },
    props: renderedProps,
    slide,
    theme: deck.theme,
  });

  return (
    <div
      aria-label="텍스트 편집"
      aria-multiline="true"
      className="inline-text-editor"
      contentEditable
      data-text-edit-composite={editCompositeId}
      ref={rootRef}
      role="textbox"
      spellCheck
      suppressContentEditableWarning
      style={{
        left: `${frame.x * stageScale}px`,
        top: `${frame.y * stageScale}px`,
        width: `${frame.width * stageScale}px`,
        height: `${frame.height * stageScale}px`,
        color: baseColor,
        fontFamily: baseFontFamily,
        fontSize: `${renderedProps.fontSize * stageScale}px`,
        fontWeight: String(getCssFontWeight(renderedProps.fontWeight)),
        lineHeight: String(renderedProps.lineHeight),
        paddingBottom: `${Math.max(0, bodyInset.bottom) * stageScale}px`,
        paddingLeft: `${Math.max(0, bodyInset.left) * stageScale}px`,
        paddingRight: `${Math.max(0, bodyInset.right) * stageScale}px`,
        paddingTop: `${Math.max(0, textLayout.y) * stageScale}px`,
        textAlign: renderedProps.align,
        transform: `rotate(${frame.rotation}deg)`,
        transformOrigin: "top left",
      }}
      onBlur={(event) => handleCompositeBlur(event.relatedTarget)}
      onCompositionEnd={() => {
        session.handleCompositionEnd();
      }}
      onCompositionStart={() => {
        session.handleCompositionStart();
      }}
      onFocus={() => {
        if (!pendingRangeRestoreRef.current) return;
        pendingRangeRestoreRef.current = false;
        restoreRange();
      }}
      onInput={(event) => {
        const nextDraft = session.replaceDraft(
          applyContentEditablePlainTextInput(
            session.getDraft(),
            readContentEditablePlainText(event.currentTarget),
          ),
        );
        publishDraft(nextDraft);
        preserveRange();
      }}
      onKeyDown={(event) => {
        session.handleKeyDown({
          ctrlKey: event.ctrlKey,
          isComposing: event.nativeEvent.isComposing,
          key: event.key,
          keyCode: event.keyCode,
          metaKey: event.metaKey,
          preventDefault: () => event.preventDefault(),
        });
      }}
      onPaste={(event) => {
        preserveRange();
        const range = rangeRef.current ?? {
          end: session.getDraft().text.length,
          start: session.getDraft().text.length,
        };
        const pastedText = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
        const nextDraft = session.replaceDraft(
          applyContentEditablePlainTextPaste({
            clipboardData: event.clipboardData,
            preventDefault: () => event.preventDefault(),
            props: session.getDraft(),
            range,
          }),
        );
        rangeRef.current = {
          end: range.start + pastedText.length,
          start: range.start + pastedText.length,
        };
        callbacksRef.current.onRangeChange?.(rangeRef.current);
        pendingRangeRestoreRef.current = true;
        setRenderedProps(nextDraft);
        publishDraft(nextDraft);
      }}
      onSelect={preserveRange}
    >
      {paragraphs.map((paragraph, paragraphIndex) => (
        <div
          data-text-bullet={
            paragraph.bullet?.enabled ? paragraph.bullet.character : undefined
          }
          data-text-paragraph-index={paragraphIndex}
          key={paragraphIndex}
          style={{
            marginBottom: `${paragraph.spaceAfter * stageScale}px`,
            marginTop: `${paragraph.spaceBefore * stageScale}px`,
            paddingLeft: `${paragraph.indent * stageScale}px`,
            textAlign: paragraph.align,
            lineHeight: String(paragraph.lineHeight),
          }}
        >
          {(paragraph.runs ?? []).map((run, runIndex) => (
            <span
              data-hyperlink={run.hyperlink}
              data-text-run-index={runIndex}
              key={runIndex}
              style={getRunStyle({
                baseColor,
                baseFontFamily: canonicalBaseFontFamily,
                paragraph,
                props: renderedProps,
                run,
                stageScale,
              })}
            >
              {run.text}
            </span>
          ))}
          {(paragraph.runs?.length ?? 0) === 0 ? <br /> : null}
        </div>
      ))}
    </div>
  );
});

function getRunStyle(args: {
  baseColor: string;
  baseFontFamily: string;
  paragraph: TextElementParagraph;
  props: TextElementProps;
  run: TextElementRun;
  stageScale: number;
}) {
  const { baseColor, baseFontFamily, paragraph, props, run, stageScale } = args;
  const fontWeight =
    run.fontWeight ?? paragraph.fontWeight ?? props.fontWeight;
  const baseline = run.baseline ?? "normal";
  return {
    backgroundColor: run.highlightColor ?? "transparent",
    color: run.color ?? paragraph.color ?? baseColor,
    fontFamily: resolveWebFontFamily(
      run.fontFamily ?? paragraph.fontFamily ?? baseFontFamily,
    ),
    fontSize: `${(run.fontSize ?? paragraph.fontSize ?? props.fontSize) * stageScale}px`,
    fontStyle: run.italic ?? paragraph.italic ?? props.italic ? "italic" : "normal",
    fontWeight: String(getCssFontWeight(fontWeight)),
    textDecoration:
      Boolean(
        (run.underline ?? paragraph.underline ?? props.underline) ||
          run.hyperlink,
      )
        ? "underline"
        : "none",
    verticalAlign:
      baseline === "superscript"
        ? "super"
        : baseline === "subscript"
          ? "sub"
          : "baseline",
  } as const;
}
