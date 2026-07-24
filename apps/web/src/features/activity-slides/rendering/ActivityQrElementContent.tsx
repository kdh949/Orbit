import { Group as KonvaGroup, Rect as KonvaRect, Text as KonvaText } from "react-konva";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { createQrDataUrl } from "../../editor/audience-link/audienceLinkUtils";
import { ImageElementContent } from "../../slides/rendering/ImageElementContent";
import {
  getActivityQrRuntimeState,
  subscribeActivityQrRuntime,
  type ActivityQrRuntimeState,
  type ActivityQrRuntimeInput
} from "./activityQrRuntime";
import { useActivityPublicProjection } from "./activityPublicProjectionContext";

type KonvaComponent = ComponentType<any>;
const Group = KonvaGroup as unknown as KonvaComponent;
const Rect = KonvaRect as unknown as KonvaComponent;
const Text = KonvaText as unknown as KonvaComponent;

export function ActivityQrElementContent(props: {
  activityId: string;
  deckId: string;
  frame: { x: number; y: number; width: number; height: number; rotation: number };
  projectId: string;
}) {
  const input = useMemo<ActivityQrRuntimeInput>(
    () => ({
      activityId: props.activityId,
      deckId: props.deckId,
      projectId: props.projectId
    }),
    [props.activityId, props.deckId, props.projectId]
  );
  const providedProjection = useActivityPublicProjection(props.activityId);
  const providedRuntime = useMemo<ActivityQrRuntimeState | null>(
    () =>
      providedProjection === null
        ? null
        : providedProjection.audienceUrl
          ? {
              status: "ready",
              audienceUrl: providedProjection.audienceUrl,
            }
          : { status: "not-prepared", audienceUrl: null },
    [providedProjection],
  );
  const runtime = useSyncExternalStore(
    (listener) =>
      providedRuntime
        ? () => undefined
        : subscribeActivityQrRuntime(input, listener),
    () => providedRuntime ?? getActivityQrRuntimeState(input),
    () => ({ status: "loading", audienceUrl: null } satisfies ActivityQrRuntimeState)
  );
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!runtime.audienceUrl) {
      setQrDataUrl("");
      return;
    }

    void createQrDataUrl(runtime.audienceUrl, { width: 640 }).then(
      (nextQrDataUrl) => {
        if (!cancelled) setQrDataUrl(nextQrDataUrl);
      },
      () => {
        if (!cancelled) setQrDataUrl("");
      }
    );
    return () => {
      cancelled = true;
    };
  }, [runtime.audienceUrl]);

  if (qrDataUrl) {
    return (
      <ImageElementContent
        frame={props.frame}
        imageProps={{
          alt: "참여 QR 코드",
          fit: "contain",
          focusX: 0.5,
          focusY: 0.5,
          src: qrDataUrl
        }}
        projectId={props.projectId}
      />
    );
  }

  return <QrPlaceholder frame={props.frame} unavailable={runtime.status === "unavailable"} />;
}

function QrPlaceholder(props: {
  frame: { height: number; width: number };
  unavailable: boolean;
}) {
  return (
    <Group listening={false}>
      <Rect
        fill="#f8fafc"
        stroke="#93c5fd"
        strokeWidth={1}
        width={props.frame.width}
        height={props.frame.height}
      />
      <Text
        align="center"
        fill="#475467"
        fontSize={14}
        fontStyle="bold"
        padding={16}
        text={props.unavailable ? "참여 QR 코드\n준비 상태를 확인할 수 없습니다" : "참여 QR 코드\n발표 시작 후 표시됩니다"}
        verticalAlign="middle"
        width={props.frame.width}
        height={props.frame.height}
      />
    </Group>
  );
}
