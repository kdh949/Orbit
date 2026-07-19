import json
from typing import Any

from fastapi import UploadFile
from pydantic import TypeAdapter, ValidationError


PPTX_PACKAGE_MAX_BYTES = 50 * 1024 * 1024
TEMPLATE_BLUEPRINT_MAX_BYTES = 16 * 1024 * 1024
OPERATIONS_MAX_BYTES = 72 * 1024 * 1024
SLIDE_MOTION_MAX_BYTES = 16 * 1024 * 1024
DECK_CANVAS_MAX_BYTES = 4 * 1024

PPTX_MIME_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)
JSON_MIME_TYPE = "application/json"

_json_object_adapter = TypeAdapter(dict[str, Any])
_operations_adapter = TypeAdapter(list[dict[str, Any]])


class PptxOoxmlSyncTransportError(ValueError):
    def __init__(
        self,
        code: str,
        field: str,
        *,
        status_code: int = 400,
        max_bytes: int | None = None,
    ) -> None:
        super().__init__(f"{code}:{field}")
        self.code = code
        self.field = field
        self.status_code = status_code
        self.max_bytes = max_bytes

    def detail(self) -> dict[str, str | int]:
        detail: dict[str, str | int] = {
            "code": self.code,
            "field": self.field,
        }
        if self.max_bytes is not None:
            detail["maxBytes"] = self.max_bytes
        return detail


async def read_pptx_package(file: UploadFile) -> bytes:
    if normalized_mime_type(file.content_type) != PPTX_MIME_TYPE:
        raise PptxOoxmlSyncTransportError(
            "PPTX_OOXML_SYNC_PACKAGE_MIME_INVALID",
            "file",
            status_code=415,
        )
    return await read_bounded_upload(
        file,
        field="file",
        max_bytes=PPTX_PACKAGE_MAX_BYTES,
        too_large_code="PPTX_OOXML_SYNC_PACKAGE_TOO_LARGE",
    )


async def parse_json_part(
    *,
    field: str,
    upload: UploadFile | None,
    legacy_text: str | None,
    max_bytes: int,
    expected: str,
) -> dict[str, Any] | list[dict[str, Any]]:
    if upload is not None and legacy_text is not None:
        raise PptxOoxmlSyncTransportError(
            "PPTX_OOXML_SYNC_PART_DUPLICATED",
            field,
        )
    if upload is not None:
        if normalized_mime_type(upload.content_type) != JSON_MIME_TYPE:
            raise PptxOoxmlSyncTransportError(
                "PPTX_OOXML_SYNC_PART_MIME_INVALID",
                field,
                status_code=415,
            )
        content = await read_bounded_upload(
            upload,
            field=field,
            max_bytes=max_bytes,
            too_large_code="PPTX_OOXML_SYNC_PART_TOO_LARGE",
        )
    elif legacy_text is not None:
        content = legacy_text.encode("utf-8")
        if len(content) > max_bytes:
            raise PptxOoxmlSyncTransportError(
                "PPTX_OOXML_SYNC_PART_TOO_LARGE",
                field,
                status_code=413,
                max_bytes=max_bytes,
            )
    else:
        raise PptxOoxmlSyncTransportError(
            "PPTX_OOXML_SYNC_PART_MISSING",
            field,
        )

    try:
        value = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PptxOoxmlSyncTransportError(
            "PPTX_OOXML_SYNC_JSON_INVALID",
            field,
        ) from error

    try:
        if expected == "object":
            return _json_object_adapter.validate_python(value)
        operations = _operations_adapter.validate_python(value)
        if len(operations) > 500:
            raise PptxOoxmlSyncTransportError(
                "PPTX_OOXML_SYNC_JSON_SCHEMA_INVALID",
                field,
            )
        return operations
    except ValidationError as error:
        raise PptxOoxmlSyncTransportError(
            "PPTX_OOXML_SYNC_JSON_SCHEMA_INVALID",
            field,
        ) from error


async def read_bounded_upload(
    upload: UploadFile,
    *,
    field: str,
    max_bytes: int,
    too_large_code: str,
) -> bytes:
    content = await upload.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise PptxOoxmlSyncTransportError(
            too_large_code,
            field,
            status_code=413,
            max_bytes=max_bytes,
        )
    return content


def normalized_mime_type(content_type: str | None) -> str:
    return (content_type or "").partition(";")[0].strip().lower()
