import { maxAssetUploadSizeBytes } from "@orbit/shared/files";

import { defaultImageInsertFrame } from "./editorLayout";

export const editorImageAccept =
  ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
export const pptxImportAccept =
  ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation";

const editorImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const pptxMimeType =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function getEditorImageValidationMessage(
  file: Pick<File, "name" | "size" | "type">
) {
  if (!isSupportedEditorImageFile(file)) {
    return "JPG, PNG, WebP 이미지 파일만 업로드할 수 있습니다.";
  }

  if (file.size > maxAssetUploadSizeBytes) {
    return `이미지 크기는 최대 ${formatBytes(maxAssetUploadSizeBytes)}까지 가능합니다.`;
  }

  if (file.size <= 0) {
    return "빈 파일은 업로드할 수 없습니다.";
  }

  return "";
}

function isSupportedEditorImageFile(file: Pick<File, "name" | "type">) {
  if (editorImageMimeTypes.has(file.type.toLowerCase())) {
    return true;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["jpg", "jpeg", "png", "webp"].includes(extension);
}

export function getPptxImportValidationMessage(
  file: Pick<File, "name" | "size" | "type">
) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isPptx = file.type === pptxMimeType || extension === "pptx";

  if (!isPptx) {
    return "PPTX 파일만 가져올 수 있습니다.";
  }

  if (file.size > maxAssetUploadSizeBytes) {
    return `PPTX 파일 크기는 최대 ${formatBytes(maxAssetUploadSizeBytes)}까지 가능합니다.`;
  }

  if (file.size <= 0) {
    return "빈 PPTX 파일은 가져올 수 없습니다.";
  }

  return "";
}

function formatBytes(bytes: number) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function toEditorErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
}

export async function readImageNaturalSize(file: File) {
  if (typeof window === "undefined") {
    return {
      height: defaultImageInsertFrame.height,
      width: defaultImageInsertFrame.width
    };
  }

  const objectUrl = window.URL.createObjectURL(file);

  try {
    return await new Promise<{ height: number; width: number }>((resolve, reject) => {
      const image = new window.Image();

      image.onload = () => {
        resolve({
          height: image.naturalHeight || defaultImageInsertFrame.height,
          width: image.naturalWidth || defaultImageInsertFrame.width
        });
      };
      image.onerror = () => reject(new Error("이미지 크기를 읽지 못했습니다."));
      image.src = objectUrl;
    });
  } finally {
    window.URL.revokeObjectURL(objectUrl);
  }
}
