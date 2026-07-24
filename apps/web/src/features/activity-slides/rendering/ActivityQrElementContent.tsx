import { Group as KonvaGroup, Rect as KonvaRect, Text as KonvaText } from "react-konva";
import type { ComponentType } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from "react";

import { createQrDataUrl } from "../../editor/audience-link/audienceLinkUtils";
import { ImageElementContent } from "../../slides/rendering/ImageElementContent";
import { useActivityElementRuntime } from "./ActivityElementRuntimeContext";
import { resolveActivityQrElementAudienceUrl } from "./activityQrElementRuntime";
import {
  getActivityQrRuntimeState,
  subscribeActivityQrRuntime,
  type ActivityQrRuntimeInput,
  type ActivityQrRuntimeState
} from "./activityQrRuntime";

type KonvaComponent = ComponentType<any>;
const Group = KonvaGroup as unknown as KonvaComponent;
const Rect = KonvaRect as unknown as KonvaComponent;
const Text = KonvaText as unknown as KonvaComponent;
const inactiveRuntimeState: ActivityQrRuntimeState = {
  status: "not-prepared",
  audienceUrl: null
};

export function ActivityQrElementContent(props: {
  activityId: string;
  deckId: string;
  frame: { x: number; y: number; width: number; height: number; rotation: number };
  projectId: string;
}) {
  const runtime = useActivityElementRuntime();
  const lookupInput = useMemo<ActivityQrRuntimeInput>(
    () => ({
      activityId: props.activityId,
      deckId: props.deckId,
      projectId: props.projectId
    }),
    [props.activityId, props.deckId, props.projectId]
  );
  const lookupState = useActivityQrLookup(runtime !== null, lookupInput);
  const audienceUrl = resolveActivityQrElementAudienceUrl({
    activityId: props.activityId,
    lookupState,
    runtime
  });
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!audienceUrl) {
      setQrDataUrl("");
      return;
    }

    void createQrDataUrl(audienceUrl, { width: 640 }).then(
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
  }, [audienceUrl]);

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

  return <QrPlaceholder frame={props.frame} />;
}

function useActivityQrLookup(
  hasInjectedRuntime: boolean,
  input: ActivityQrRuntimeInput
) {
  const subscribe = useCallback(
    (listener: () => void) =>
      hasInjectedRuntime
        ? () => undefined
        : subscribeActivityQrRuntime(input, listener),
    [hasInjectedRuntime, input]
  );
  const getSnapshot = useCallback(
    () =>
      hasInjectedRuntime
        ? inactiveRuntimeState
        : getActivityQrRuntimeState(input),
    [hasInjectedRuntime, input]
  );

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => inactiveRuntimeState
  );
}

function QrPlaceholder(props: {
  frame: { height: number; width: number };
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
        text="참여 QR 코드\n발표 시작 후 표시됩니다"
        verticalAlign="middle"
        width={props.frame.width}
        height={props.frame.height}
      />
    </Group>
  );
}
