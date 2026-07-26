import type {
  CustomShapeElementProps,
  CustomShapeNode,
  DeckElement,
} from "@orbit/shared/deck";
import { Path as KonvaPathShape } from "konva/lib/shapes/Path";

export type CanvasPoint = {
  x: number;
  y: number;
};

function cloneCustomShapeNodes(nodes: CustomShapeNode[]) {
  return nodes.map((node) => ({ ...node }));
}

export function getCustomShapeNodes(props: CustomShapeElementProps) {
  return Array.isArray(props.nodes) ? cloneCustomShapeNodes(props.nodes) : [];
}

export function buildCustomShapePathDataFromNodes(
  nodes: CustomShapeNode[],
  closed: boolean
) {
  if (nodes.length === 0) {
    return "";
  }

  const segments = [`M ${formatSvgNumber(nodes[0].x)} ${formatSvgNumber(nodes[0].y)}`];

  for (let index = 1; index < nodes.length; index += 1) {
    segments.push(buildCustomShapeSegment(nodes[index - 1], nodes[index]));
  }

  if (closed && nodes.length > 1) {
    segments.push(buildCustomShapeSegment(nodes[nodes.length - 1], nodes[0]));
    segments.push("Z");
  }

  return segments.join(" ");
}

function buildCustomShapeSegment(from: CustomShapeNode, to: CustomShapeNode) {
  const hasCurve =
    typeof from.outX === "number" ||
    typeof from.outY === "number" ||
    typeof to.inX === "number" ||
    typeof to.inY === "number";

  if (!hasCurve) {
    return `L ${formatSvgNumber(to.x)} ${formatSvgNumber(to.y)}`;
  }

  return [
    "C",
    formatSvgNumber(from.outX ?? from.x),
    formatSvgNumber(from.outY ?? from.y),
    formatSvgNumber(to.inX ?? to.x),
    formatSvgNumber(to.inY ?? to.y),
    formatSvgNumber(to.x),
    formatSvgNumber(to.y)
  ].join(" ");
}

function formatSvgNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function normalizeCustomShapeAbsoluteGeometry(
  nodes: CustomShapeNode[],
  closed: boolean
) {
  const bounds = getCustomShapeNodeBounds(nodes);
  const frameX = Math.max(0, Math.floor(bounds.minX));
  const frameY = Math.max(0, Math.floor(bounds.minY));
  const maxX = Math.max(frameX + 1, Math.ceil(bounds.maxX));
  const maxY = Math.max(frameY + 1, Math.ceil(bounds.maxY));
  const width = Math.max(1, maxX - frameX);
  const height = Math.max(1, maxY - frameY);
  const normalizedNodes = nodes.map((node) => ({
    ...node,
    x: node.x - frameX,
    y: node.y - frameY,
    ...(typeof node.inX === "number" ? { inX: node.inX - frameX } : {}),
    ...(typeof node.inY === "number" ? { inY: node.inY - frameY } : {}),
    ...(typeof node.outX === "number" ? { outX: node.outX - frameX } : {}),
    ...(typeof node.outY === "number" ? { outY: node.outY - frameY } : {})
  }));

  return {
    frame: {
      x: frameX,
      y: frameY,
      width,
      height
    },
    props: {
      closed,
      nodes: normalizedNodes,
      pathData: buildCustomShapePathDataFromNodes(normalizedNodes, closed),
      viewBoxWidth: width,
      viewBoxHeight: height
    }
  };
}

function getCustomShapeNodeBounds(nodes: CustomShapeNode[]) {
  const points = nodes.flatMap((node) => [
    { x: node.x, y: node.y },
    ...(typeof node.inX === "number" && typeof node.inY === "number"
      ? [{ x: node.inX, y: node.inY }]
      : []),
    ...(typeof node.outX === "number" && typeof node.outY === "number"
      ? [{ x: node.outX, y: node.outY }]
      : [])
  ]);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    minX: Math.min(...xs),
    minY: Math.min(...ys)
  };
}

export function getCustomShapeDimension(
  props: CustomShapeElementProps,
  key: "viewBoxWidth" | "viewBoxHeight",
  fallback: number
) {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function getCustomShapeAbsoluteNodes(element: DeckElement) {
  if (element.type !== "customShape") {
    return [] as CustomShapeNode[];
  }

  const props = element.props as CustomShapeElementProps;
  const viewBoxWidth = getCustomShapeDimension(props, "viewBoxWidth", element.width);
  const viewBoxHeight = getCustomShapeDimension(props, "viewBoxHeight", element.height);

  return convertCustomShapeNodesToAbsolute({
    frame: {
      height: element.height,
      width: element.width,
      x: element.x,
      y: element.y
    },
    nodes: getCustomShapeNodes(props),
    viewBoxHeight,
    viewBoxWidth
  });
}

export function convertCustomShapeNodesToAbsolute(args: {
  frame: { x: number; y: number; width: number; height: number };
  nodes: CustomShapeNode[];
  viewBoxWidth: number;
  viewBoxHeight: number;
}) {
  const { frame, nodes, viewBoxHeight, viewBoxWidth } = args;
  const scaleX = frame.width / viewBoxWidth;
  const scaleY = frame.height / viewBoxHeight;

  return nodes.map((node) => ({
    ...node,
    x: frame.x + node.x * scaleX,
    y: frame.y + node.y * scaleY,
    ...(typeof node.inX === "number" ? { inX: frame.x + node.inX * scaleX } : {}),
    ...(typeof node.inY === "number" ? { inY: frame.y + node.inY * scaleY } : {}),
    ...(typeof node.outX === "number" ? { outX: frame.x + node.outX * scaleX } : {}),
    ...(typeof node.outY === "number" ? { outY: frame.y + node.outY * scaleY } : {})
  }));
}

export function createCustomShapeNode(point: CanvasPoint): CustomShapeNode {
  return {
    x: point.x,
    y: point.y,
    mode: "corner"
  };
}

export function moveCustomShapeNode(node: CustomShapeNode, point: CanvasPoint): CustomShapeNode {
  const deltaX = point.x - node.x;
  const deltaY = point.y - node.y;

  return {
    ...node,
    x: point.x,
    y: point.y,
    ...(typeof node.inX === "number" ? { inX: node.inX + deltaX } : {}),
    ...(typeof node.inY === "number" ? { inY: node.inY + deltaY } : {}),
    ...(typeof node.outX === "number" ? { outX: node.outX + deltaX } : {}),
    ...(typeof node.outY === "number" ? { outY: node.outY + deltaY } : {})
  };
}

export function updateCustomShapeNodeHandle(
  node: CustomShapeNode,
  handle: "in" | "out",
  point: CanvasPoint
): CustomShapeNode {
  const deltaX = point.x - node.x;
  const deltaY = point.y - node.y;
  const mirroredPoint = {
    x: node.x - deltaX,
    y: node.y - deltaY
  };
  const hasMeaningfulHandle = Math.hypot(deltaX, deltaY) >= 4;

  if (!hasMeaningfulHandle) {
    return {
      x: node.x,
      y: node.y,
      mode: "corner" as const
    };
  }

  if (handle === "in") {
    return {
      ...node,
      mode: "smooth" as const,
      inX: point.x,
      inY: point.y,
      outX: mirroredPoint.x,
      outY: mirroredPoint.y
    };
  }

  return {
    ...node,
    mode: "smooth" as const,
    inX: mirroredPoint.x,
    inY: mirroredPoint.y,
    outX: point.x,
    outY: point.y
  };
}

export function toggleCustomShapeNodeMode(
  node: CustomShapeNode,
  handleLength: number
): CustomShapeNode {
  if (node.mode === "smooth") {
    return {
      x: node.x,
      y: node.y,
      mode: "corner"
    };
  }

  return {
    ...node,
    mode: "smooth",
    inX: node.x - handleLength,
    inY: node.y,
    outX: node.x + handleLength,
    outY: node.y
  };
}

export function getCustomShapePaint(
  props: CustomShapeElementProps,
  key: "fill" | "stroke",
  fallback: string
) {
  const value = props[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function getCustomShapeStrokeWidth(props: CustomShapeElementProps) {
  const value = props.strokeWidth;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 2;
}

export function getCustomShapePathData(props: CustomShapeElementProps) {
  const pathData = props.pathData;
  return typeof pathData === "string" ? pathData.trim() : "";
}

export function getCustomShapeDataArray(pathData: string) {
  if (!pathData) {
    return [] as ReturnType<typeof KonvaPathShape.parsePathData>;
  }

  try {
    return KonvaPathShape.parsePathData(pathData);
  } catch {
    return [] as ReturnType<typeof KonvaPathShape.parsePathData>;
  }
}
