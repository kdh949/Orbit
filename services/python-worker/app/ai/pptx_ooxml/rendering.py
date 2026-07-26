from __future__ import annotations

import base64


import importlib


import math


import shutil

import subprocess

import zipfile


from io import BytesIO

from pathlib import Path

from tempfile import TemporaryDirectory

from typing import Any, cast

from xml.etree import ElementTree as ET

from PIL import Image


from app.ai.pptx_design_importer import (
    ImportedDesignAsset,
)


from app.ai.pptx_render_resource_limits import (
    PptxRenderResourceLimitError,
    run_bitmap_decode_with_timeout,
    validate_rendered_bitmap,
)

from typing import TYPE_CHECKING

from app.ai.pptx_ooxml.common import (
    CONTENT_TYPES_NS,
    PKG_REL_NS,
    SOURCE_RENDER_DECODE_TIMEOUT_SECONDS,
    SOURCE_RENDER_MAX_BYTES,
    SOURCE_RENDER_MAX_DIMENSION,
    SOURCE_RENDER_MAX_PAGES,
    SOURCE_RENDER_MAX_TOTAL_BYTES,
)

if TYPE_CHECKING:
    from app.ai.pptx_ooxml.models import (
        CanvasSpec,
    )


def rewrite_zip(
    source: zipfile.ZipFile,
    changed_entries: dict[str, bytes],
    added_entries: dict[str, bytes] | None = None,
) -> bytes:
    buffer = BytesIO()
    added = added_entries or {}
    with zipfile.ZipFile(buffer, "w") as target:
        for info in source.infolist():
            if info.filename in added:
                continue
            target.writestr(
                info,
                changed_entries.get(info.filename, source.read(info.filename)),
            )
        for name, content in added.items():
            target.writestr(name, content)
        for name, content in changed_entries.items():
            if name not in source.namelist():
                target.writestr(name, content)
    return buffer.getvalue()


def render_pptx_to_png_assets(
    package_bytes: bytes,
    canvas: CanvasSpec,
) -> list[ImportedDesignAsset]:
    from app.ai.pptx_ooxml.models import (
        PptxRenderUnavailableError,
    )

    executable = shutil.which("libreoffice") or shutil.which("soffice")
    if executable is None:
        raise PptxRenderUnavailableError(
            "LibreOffice is required to render PPTX slides."
        )

    with TemporaryDirectory(prefix="orbit-ooxml-render-") as temp_dir:
        temp_path = Path(temp_dir)
        pptx_path = temp_path / "source.pptx"
        out_dir = temp_path / "out"
        profile_dir = temp_path / "profile"
        out_dir.mkdir()
        profile_dir.mkdir()
        pptx_path.write_bytes(package_bytes)
        try:
            subprocess.run(
                [
                    executable,
                    "--headless",
                    f"-env:UserInstallation={profile_dir.resolve().as_uri()}",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(out_dir),
                    str(pptx_path),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise PptxRenderUnavailableError(
                "LibreOffice failed to render PPTX slides."
            ) from error
        pdf_path = out_dir / "source.pdf"
        if not pdf_path.exists():
            raise PptxRenderUnavailableError("LibreOffice did not produce a PDF.")
        return render_pdf_to_png_assets(pdf_path, canvas)


def render_pdf_to_png_assets(
    pdf_path: Path,
    canvas: CanvasSpec,
) -> list[ImportedDesignAsset]:
    from app.ai.pptx_ooxml.models import (
        PptxRenderUnavailableError,
    )

    fitz: Any = importlib.import_module("fitz")
    assets: list[ImportedDesignAsset] = []
    document = fitz.open(str(pdf_path))
    try:
        if document.page_count <= 0 or document.page_count > SOURCE_RENDER_MAX_PAGES:
            raise PptxRenderUnavailableError("PPTX_SOURCE_RENDER_PAGE_COUNT_LIMIT")
        total_bytes = 0
        for page_index in range(document.page_count):
            page = document.load_page(page_index)
            matrix = fitz.Matrix(
                canvas.width / float(page.rect.width),
                canvas.height / float(page.rect.height),
            )
            try:
                png_bytes, pixel_width, pixel_height = run_bitmap_decode_with_timeout(
                    lambda: render_source_pdf_page_png(page, matrix),
                    timeout_seconds=SOURCE_RENDER_DECODE_TIMEOUT_SECONDS,
                    timeout_code="PPTX_SOURCE_RENDER_DECODE_TIMEOUT",
                )
                validate_rendered_bitmap(
                    png_bytes,
                    width=pixel_width,
                    height=pixel_height,
                    max_dimension=SOURCE_RENDER_MAX_DIMENSION,
                    max_bytes=SOURCE_RENDER_MAX_BYTES,
                    dimension_code="PPTX_SOURCE_RENDER_DIMENSION_LIMIT",
                    byte_code="PPTX_SOURCE_RENDER_BYTE_LIMIT",
                )
                total_bytes += len(png_bytes)
                if total_bytes > SOURCE_RENDER_MAX_TOTAL_BYTES:
                    raise PptxRenderResourceLimitError("PPTX_SOURCE_RENDER_BYTE_LIMIT")
            except PptxRenderResourceLimitError as error:
                raise PptxRenderUnavailableError(error.code) from error
            assets.append(
                ImportedDesignAsset(
                    assetId=f"slide_render_{page_index + 1}",
                    fileName=f"slide-{page_index + 1:02d}.png",
                    mimeType="image/png",
                    contentBase64=base64.b64encode(png_bytes).decode("ascii"),
                )
            )
    finally:
        document.close()
    if not assets:
        raise PptxRenderUnavailableError("Rendered PDF has no pages.")
    return assets


def render_source_pdf_page_png(page: Any, matrix: Any) -> tuple[bytes, int, int]:
    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
    return pixmap.tobytes("png"), int(pixmap.width), int(pixmap.height)


def shape_fallback_assets(
    blueprint: dict[str, Any],
    slide_render_assets: list[ImportedDesignAsset],
    warnings: list[str],
) -> list[ImportedDesignAsset]:
    render_assets_by_slide = slide_render_assets_by_index(slide_render_assets)
    assets: list[ImportedDesignAsset] = []
    seen_asset_ids: set[str] = set()
    slides = blueprint.get("slides", [])
    if not isinstance(slides, list):
        return assets

    for index, slide in enumerate(slides):
        if not isinstance(slide, dict):
            continue
        slide_index = int_value(slide.get("sourceSlideIndex"), index + 1)
        fallback_elements = [
            element
            for element in slide.get("elements", [])
            if isinstance(element, dict)
            and shape_fallback_asset_id_from_element(element) is not None
        ]
        if not fallback_elements:
            continue

        render_asset = render_assets_by_slide.get(slide_index)
        if render_asset is None:
            warnings.append(
                f"Shape image fallback skipped; slide render missing: {slide_index}"
            )
            continue

        try:
            image_bytes = base64.b64decode(render_asset.content_base64)
            rendered = decode_source_render_image(image_bytes)
        except PptxRenderResourceLimitError as error:
            warnings.append(error.code)
            continue
        except Exception:
            warnings.append(
                f"Shape image fallback skipped; slide render unreadable: {slide_index}"
            )
            continue

        for element in fallback_elements:
            asset_id = shape_fallback_asset_id_from_element(element)
            if asset_id is None or asset_id in seen_asset_ids:
                continue
            crop_box = element_crop_box(element, rendered.size)
            if crop_box is None:
                warnings.append(
                    f"Shape image fallback skipped; invalid frame: {asset_id}"
                )
                continue
            crop = rendered.crop(crop_box)
            buffer = BytesIO()
            crop.save(buffer, format="PNG")
            assets.append(
                ImportedDesignAsset(
                    assetId=asset_id,
                    fileName=f"{asset_id}.png",
                    mimeType="image/png",
                    contentBase64=base64.b64encode(buffer.getvalue()).decode("ascii"),
                )
            )
            seen_asset_ids.add(asset_id)

    return assets


def decode_source_render_image(image_bytes: bytes) -> Image.Image:
    if not image_bytes or len(image_bytes) > SOURCE_RENDER_MAX_BYTES:
        raise PptxRenderResourceLimitError("PPTX_SOURCE_RENDER_BYTE_LIMIT")

    def decode() -> Image.Image:
        with Image.open(BytesIO(image_bytes)) as source_image:
            source_image.load()
            return cast(Image.Image, source_image.convert("RGBA"))

    rendered = run_bitmap_decode_with_timeout(
        decode,
        timeout_seconds=SOURCE_RENDER_DECODE_TIMEOUT_SECONDS,
        timeout_code="PPTX_SOURCE_RENDER_DECODE_TIMEOUT",
    )
    validate_rendered_bitmap(
        image_bytes,
        width=rendered.width,
        height=rendered.height,
        max_dimension=SOURCE_RENDER_MAX_DIMENSION,
        max_bytes=SOURCE_RENDER_MAX_BYTES,
        dimension_code="PPTX_SOURCE_RENDER_DIMENSION_LIMIT",
        byte_code="PPTX_SOURCE_RENDER_BYTE_LIMIT",
    )
    return rendered


def blueprint_has_shape_fallbacks(blueprint: dict[str, Any]) -> bool:
    slides = blueprint.get("slides", [])
    if not isinstance(slides, list):
        return False
    return any(
        isinstance(element, dict)
        and shape_fallback_asset_id_from_element(element) is not None
        for slide in slides
        if isinstance(slide, dict)
        for element in slide.get("elements", [])
    )


def strip_text_from_pptx_package(package_bytes: bytes) -> bytes:
    changed_entries: dict[str, bytes] = {}
    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        for name in package.namelist():
            if not is_presentation_visual_part(name):
                continue
            root = ET.fromstring(package.read(name))
            if remove_text_bodies(root):
                changed_entries[name] = xml_bytes(root)
        if not changed_entries:
            return package_bytes
        return rewrite_zip(package, changed_entries)


def is_presentation_visual_part(name: str) -> bool:
    return (
        name.startswith("ppt/slides/slide")
        or name.startswith("ppt/slideLayouts/slideLayout")
        or name.startswith("ppt/slideMasters/slideMaster")
    ) and name.endswith(".xml")


def remove_text_bodies(element: ET.Element[Any]) -> bool:
    from app.ai.pptx_ooxml.routing import (
        local_name,
    )

    changed = False
    for child in list(element):
        if local_name(child) == "txBody":
            element.remove(child)
            changed = True
        elif remove_text_bodies(child):
            changed = True
    return changed


def slide_render_assets_by_index(
    slide_render_assets: list[ImportedDesignAsset],
) -> dict[int, ImportedDesignAsset]:
    assets: dict[int, ImportedDesignAsset] = {}
    for asset in slide_render_assets:
        prefix = "slide_render_"
        if not asset.asset_id.startswith(prefix):
            continue
        try:
            slide_index = int(asset.asset_id.removeprefix(prefix))
        except ValueError:
            continue
        assets[slide_index] = asset
    return assets


def shape_fallback_asset_id_from_element(element: dict[str, Any]) -> str | None:
    props = element.get("props")
    if not isinstance(props, dict):
        return None
    src = props.get("src")
    if not isinstance(src, str):
        return None
    prefix = "asset:shape_render_"
    if not src.startswith(prefix):
        return None
    return src.removeprefix("asset:")


def element_crop_box(
    element: dict[str, Any],
    image_size: tuple[int, int],
) -> tuple[int, int, int, int] | None:
    image_width, image_height = image_size
    x = math_floor_float(element.get("x"))
    y = math_floor_float(element.get("y"))
    width = math_ceil_float(element.get("width"))
    height = math_ceil_float(element.get("height"))
    if width <= 0 or height <= 0:
        return None
    left = max(0, min(image_width, x))
    top = max(0, min(image_height, y))
    right = max(left, min(image_width, x + width))
    bottom = max(top, min(image_height, y + height))
    if right <= left or bottom <= top:
        return None
    return left, top, right, bottom


def math_floor_float(value: Any) -> int:
    try:
        return math.floor(float(value))
    except (TypeError, ValueError):
        return 0


def math_ceil_float(value: Any) -> int:
    try:
        return math.ceil(float(value))
    except (TypeError, ValueError):
        return 0


def package_asset(
    asset_id: str, package_bytes: bytes, file_name: str
) -> ImportedDesignAsset:
    return ImportedDesignAsset(
        assetId=asset_id,
        fileName=file_name,
        mimeType="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        contentBase64=base64.b64encode(package_bytes).decode("ascii"),
    )


def empty_relationships_xml() -> bytes:
    return (
        b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        b'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
    )


def extension_for_mime_type(mime_type: str) -> str:
    subtype = mime_type.rsplit("/", maxsplit=1)[-1].lower()
    if subtype == "jpeg":
        return "jpg"
    if subtype in {"png", "jpg", "gif", "webp"}:
        return subtype
    return "png"


def int_value(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def xml_bytes(element: ET.Element[Any]) -> bytes:
    namespace = namespace_for_tag(element.tag)
    if namespace in {CONTENT_TYPES_NS, PKG_REL_NS}:
        ET.register_namespace("", namespace)
    return cast(bytes, ET.tostring(element, encoding="utf-8", xml_declaration=True))


def namespace_for_tag(tag: str) -> str | None:
    if not tag.startswith("{"):
        return None
    return tag[1:].partition("}")[0]


def safe_file_stem(path: Path) -> str:
    stem = path.stem.strip() or "presentation"
    return "".join(
        char if char.isascii() and (char.isalnum() or char in "_-") else "_"
        for char in stem
    )


def safe_id_component(value: str) -> str:
    normalized = "".join(
        char if char.isascii() and (char.isalnum() or char in "_-") else "_"
        for char in value
    )
    return normalized or "pptx"
