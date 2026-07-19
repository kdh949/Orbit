import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  Ref,
} from "react";

import type { SelectionInspectorModel } from "../selectionInspectorModel";

export type SelectionInspectorProps = {
  canEdit: boolean;
  elementLabel?: string;
  elementControls?: ReactNode;
  focusRef?: Ref<HTMLElement>;
  model: SelectionInspectorModel;
  multiControls?: ReactNode;
  onEscape?: () => void;
  slideControls?: ReactNode;
  slideLabel?: string;
};

export function SelectionInspector(props: SelectionInspectorProps) {
  const summary = getSelectionInspectorSummary(props);
  const controls = props.canEdit ? getSelectionInspectorControls(props) : null;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !props.onEscape) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    props.onEscape();
  }

  return (
    <section
      aria-label="현재 선택"
      className="selection-inspector"
      data-editor-keyboard-owner="selection-inspector"
      data-editor-keyboard-scope="selection-inspector"
      data-selection-mode={props.model.mode}
      ref={props.focusRef}
      role="region"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {props.canEdit ? (
        controls
      ) : (
        <p className="selection-inspector-read-only-summary">
          {summary.readOnlyDescription}
        </p>
      )}
    </section>
  );
}

function getSelectionInspectorControls(props: SelectionInspectorProps) {
  if (props.model.mode === "element") {
    return props.elementControls ?? null;
  }

  if (props.model.mode === "multi") {
    return props.multiControls ?? null;
  }

  return props.slideControls ?? null;
}

function getSelectionInspectorSummary(props: SelectionInspectorProps) {
  if (props.model.mode === "element") {
    const elementLabel = props.elementLabel?.trim();
    return {
      heading: elementLabel
        ? `선택한 ${elementLabel} 요소 속성`
        : "선택한 요소 속성",
      readOnlyDescription: elementLabel
        ? `선택한 ${elementLabel} 요소의 정보를 보고 있습니다.`
        : "선택한 요소의 정보를 보고 있습니다.",
    };
  }

  if (props.model.mode === "multi") {
    return {
      heading: `선택한 요소 ${props.model.selectedCount}개 속성`,
      readOnlyDescription: `선택한 요소 ${props.model.selectedCount}개의 정보를 보고 있습니다.`,
    };
  }

  const slideLabel = props.slideLabel?.trim();
  return {
    heading: slideLabel ? `${slideLabel} 슬라이드 속성` : "현재 슬라이드 속성",
    readOnlyDescription: slideLabel
      ? `${slideLabel} 슬라이드의 정보를 보고 있습니다.`
      : "현재 슬라이드의 정보를 보고 있습니다.",
  };
}
