import type { ImageElementProps } from "@orbit/shared";
import {
  Group as KonvaGroup,
  Image as KonvaImageComponent,
  Rect as KonvaRect,
  Text as KonvaText
} from "react-konva";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";

import { resolveEditorAssetUrl } from "../../editor/shared/editorAssetUrl";
import { getImageElementLayout } from "./imageElementLayout";
import { getReadySlideImage, loadSlideImage } from "./slideImageCache";

type KonvaComponent = ComponentType<any>;

const Group = KonvaGroup as unknown as KonvaComponent;
const KonvaImage = KonvaImageComponent as unknown as KonvaComponent;
const Rect = KonvaRect as unknown as KonvaComponent;
const Text = KonvaText as unknown as KonvaComponent;

export function ImageElementContent(props: {
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  imageProps: ImageElementProps;
  projectId: string;
}) {
  const { frame, imageProps, projectId } = props;
  const image = useLoadedImage(projectId, resolveEditorAssetUrl(imageProps.src));
  const layout =
    image && image.naturalWidth > 0 && image.naturalHeight > 0
      ? getImageElementLayout({
          crop: imageProps.crop,
          fit: imageProps.fit,
          focusX: imageProps.focusX,
          focusY: imageProps.focusY,
          frameHeight: frame.height,
          frameWidth: frame.width,
          imageHeight: image.naturalHeight,
          imageWidth: image.naturalWidth
        })
      : null;

  return (
    <Group
      listening={false}
      clipX={0}
      clipY={0}
      clipWidth={frame.width}
      clipHeight={frame.height}
    >
      {image && layout ? null : (
        <Rect
          fill="#f8fafc"
          stroke="#93c5fd"
          strokeWidth={1}
          width={frame.width}
          height={frame.height}
        />
      )}
      {image && layout ? (
        <KonvaImage
          crop={layout.crop}
          image={image}
          x={layout.x}
          y={layout.y}
          width={layout.width}
          height={layout.height}
        />
      ) : (
        <Text
          align="center"
          fill="#475467"
          fontSize={14}
          fontStyle="bold"
          padding={16}
          text={`IMAGE\n${truncateValue(imageProps.alt || imageProps.src, 44)}`}
          verticalAlign="middle"
          width={frame.width}
          height={frame.height}
        />
      )}
    </Group>
  );
}

function useLoadedImage(projectId: string, src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(() =>
    getReadySlideImage(projectId, src)
  );

  useEffect(() => {
    if (!src || typeof window === "undefined") {
      setImage(null);
      return;
    }

    let cancelled = false;
    const readyImage = getReadySlideImage(projectId, src);
    if (readyImage) {
      setImage(readyImage);
      return;
    }

    setImage(null);
    void loadSlideImage(projectId, src, "high").then((nextImage) => {
      if (!cancelled) {
        setImage(nextImage);
      }
    }).catch(() => {
      if (!cancelled) {
        setImage(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, src]);

  return image;
}

function truncateValue(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
