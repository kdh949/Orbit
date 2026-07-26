import type { CustomShapeElementProps, DeckElement } from "@orbit/shared/deck";
import { useEffect } from "react";

import { getCustomShapeNodes } from "../custom-shape/geometry";
import type { CustomShapeEditDraft } from "./types";

export function useSyncCustomShapeEditDraft(args: {
  editingCustomShapeElement: DeckElement | null;
  setCustomShapeEditDraft: (draft: CustomShapeEditDraft | null) => void;
}) {
  const { editingCustomShapeElement, setCustomShapeEditDraft } = args;

  useEffect(() => {
    if (!editingCustomShapeElement) {
      setCustomShapeEditDraft(null);
      return;
    }

    const customShapeProps = editingCustomShapeElement.props as CustomShapeElementProps;

    setCustomShapeEditDraft({
      closed: customShapeProps.closed,
      elementId: editingCustomShapeElement.elementId,
      nodes: getCustomShapeNodes(customShapeProps),
      selectedNodeIndex: null
    });
  }, [editingCustomShapeElement, setCustomShapeEditDraft]);
}
