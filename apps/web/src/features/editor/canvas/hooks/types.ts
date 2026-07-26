import type { CustomShapeElementProps } from "@orbit/shared/deck";

import type { CanvasPoint } from "../custom-shape/geometry";

export type CustomShapeInsertDraft = {
  activeNodeIndex: number | null;
  nodes: CustomShapeElementProps["nodes"];
  pointer: CanvasPoint | null;
};

export type CustomShapeEditDraft = {
  closed: boolean;
  elementId: string;
  nodes: CustomShapeElementProps["nodes"];
  selectedNodeIndex: number | null;
};
