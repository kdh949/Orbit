import { Group as KonvaGroup, Rect as KonvaRect, Text as KonvaText } from "react-konva";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";

import { createQrDataUrl } from "../../editor/audience-link/audienceLinkUtils";
import { ImageElementContent } from "../../slides/rendering/ImageElementContent";
import { canonicalActivityUrl } from "./ActivityAudienceSlideRenderer";
import { useActivityElementRuntime } from "./ActivityElementRuntimeContext";

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
  const runtime = useActivityElementRuntime();
  const audienceUrl = runtime?.audienceUrl
    ? canonicalActivityUrl(runtime.audienceUrl, props.activityId)
    : null;
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
