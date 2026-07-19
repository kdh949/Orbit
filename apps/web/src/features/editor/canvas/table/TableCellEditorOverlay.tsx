import type { TableCellProps } from "@orbit/shared";
import { useEffect, useRef } from "react";

import type { TableCellLayout } from "../../../slides/rendering/tableLayout";
import { getTableCellOverlayGeometry } from "../../../slides/rendering/tableLayout";
import {
  applyContentEditablePlainTextInput,
  createContentEditableEditSession
} from "../text/contentEditableRange";
import "./table-cell-editor.css";

type TableCellEditorKeyEvent = {
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  keyCode: number;
  metaKey: boolean;
  preventDefault: () => void;
};

export function createTableCellEditSession(args: {
  initialText: string;
  onCommit: (text: string) => void;
  onFinish: () => void;
}) {
  const session = createContentEditableEditSession({
    initialProps: {
      align: "left",
      color: "#111827",
      fontFamily: "Arial",
      fontSize: 18,
      fontWeight: "normal",
      lineHeight: 1.2,
      text: args.initialText,
      verticalAlign: "middle"
    },
    onCommit: (props) => args.onCommit(props.text),
    onFinish: args.onFinish
  });

  return {
    getText: () => session.getDraft().text,
    handleBlur: () => session.handleBlur({ nextTargetInsideComposite: false }),
    handleCompositionEnd: session.handleCompositionEnd,
    handleCompositionStart: session.handleCompositionStart,
    handleKeyDown: (event: TableCellEditorKeyEvent) => session.handleKeyDown(event),
    replaceText: (text: string) => {
      const nextProps = applyContentEditablePlainTextInput(
        session.getDraft(),
        text.replace(/\r\n?/g, "\n")
      );
      session.replaceDraft(nextProps);
      return nextProps.text;
    }
  };
}

export function TableCellEditorOverlay(props: {
  cell: TableCellProps;
  cellLayout: Pick<TableCellLayout, "height" | "width" | "x" | "y">;
  columnIndex: number;
  element: { elementId: string; rotation: number; x: number; y: number };
  rowIndex: number;
  stageScale: number;
  onCommit: (text: string) => void;
  onFinish: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const onCommitRef = useRef(props.onCommit);
  const onFinishRef = useRef(props.onFinish);
  onCommitRef.current = props.onCommit;
  onFinishRef.current = props.onFinish;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const stageElement = document.querySelector<HTMLElement>(
      ".konva-editor-stage"
    );
    if (!stageElement) return;

    const textarea = document.createElement("textarea");
    const session = createTableCellEditSession({
      initialText: props.cell.text,
      onCommit: (text) => onCommitRef.current(text),
      onFinish: () => onFinishRef.current()
    });

    textareaRef.current = textarea;
    textarea.className = "table-cell-editor-overlay";
    textarea.dataset.elementId = props.element.elementId;
    textarea.dataset.tableColumnIndex = String(props.columnIndex);
    textarea.dataset.tableRowIndex = String(props.rowIndex);
    textarea.setAttribute(
      "aria-label",
      `표 ${props.rowIndex + 1}행 ${props.columnIndex + 1}열 셀 편집`
    );
    textarea.spellcheck = true;
    textarea.value = props.cell.text;

    function handleInput() {
      session.replaceText(textarea.value);
    }
    function handleKeyDown(event: KeyboardEvent) {
      session.handleKeyDown({
        ctrlKey: event.ctrlKey,
        isComposing: event.isComposing,
        key: event.key,
        keyCode: event.keyCode,
        metaKey: event.metaKey,
        preventDefault: () => event.preventDefault()
      });
    }
    function handleCompositionStart() {
      session.handleCompositionStart();
    }
    function handleCompositionEnd() {
      session.replaceText(textarea.value);
      session.handleCompositionEnd();
    }
    function handleBlur() {
      session.replaceText(textarea.value);
      session.handleBlur();
    }

    textarea.addEventListener("blur", handleBlur);
    textarea.addEventListener("compositionend", handleCompositionEnd);
    textarea.addEventListener("compositionstart", handleCompositionStart);
    textarea.addEventListener("input", handleInput);
    textarea.addEventListener("keydown", handleKeyDown);
    stageElement.append(textarea);
    textarea.focus();
    textarea.select();

    return () => {
      textarea.removeEventListener("blur", handleBlur);
      textarea.removeEventListener("compositionend", handleCompositionEnd);
      textarea.removeEventListener("compositionstart", handleCompositionStart);
      textarea.removeEventListener("input", handleInput);
      textarea.removeEventListener("keydown", handleKeyDown);
      if (textareaRef.current === textarea) textareaRef.current = null;
      textarea.remove();
    };
  }, [props.columnIndex, props.element.elementId, props.rowIndex]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const geometry = getTableCellOverlayGeometry({
      cell: props.cellLayout,
      element: props.element,
      stageScale: props.stageScale
    });

    Object.assign(textarea.style, {
      color: props.cell.textColor ?? "#111827",
      fontFamily: props.cell.fontFamily ?? "Arial",
      fontSize: `${Math.max(1, (props.cell.fontSize ?? 18) * props.stageScale)}px`,
      fontWeight: String(props.cell.fontWeight ?? "normal"),
      height: `${geometry.height}px`,
      left: `${geometry.left}px`,
      textAlign: props.cell.align ?? "left",
      top: `${geometry.top}px`,
      transform: `rotate(${geometry.rotation}deg)`,
      width: `${geometry.width}px`
    });
  });

  return null;
}
