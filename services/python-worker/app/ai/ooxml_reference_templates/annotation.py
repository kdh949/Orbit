from __future__ import annotations

import hashlib
import json
import posixpath
import zipfile
from collections.abc import Iterable, Mapping
from pathlib import Path, PurePosixPath
from typing import Any
from xml.etree import ElementTree as ET

from PIL import Image, ImageDraw
from pydantic import ValidationError

from app.ai.ooxml_reference_templates.inventory import (
    OFFICE_RELATIONSHIPS_NS,
    PACKAGE_RELATIONSHIPS_NS,
    ReferenceSource,
    inspect_reference_package,
)
from app.ai.ooxml_reference_templates.media_targets import inspect_image_media_usage
from app.ai.ooxml_reference_templates.models import (
    OoxmlReferenceTemplateManifest,
    OoxmlSourceSlide,
)


PRESENTATION_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
REL_NS = OFFICE_RELATIONSHIPS_NS
DIAGRAM_URI = "http://schemas.openxmlformats.org/drawingml/2006/diagram"

_SOURCE_SLIDE_FIELDS = {
    "sourceSlideId",
    "sourceSlidePart",
    "sourceOrder",
    "semanticRole",
    "relationships",
    "capacity",
    "previewId",
    "lockedInventorySha256",
    "slots",
}
_SLOT_FIELDS = {
    "slotId",
    "semanticRole",
    "contentType",
    "required",
    "locator",
    "capacity",
    "mutationPolicy",
    "replacementPolicy",
}
_SUPPORTED_CONTENT_TYPES = {"text", "image", "table", "chart"}
_ROLE_COUNT = 14
_MAX_IMAGE_SLOT_CANDIDATE_RECORDS = 1_000
_MAX_IMAGE_SLOT_LOCATOR_LENGTH = 160
_IMAGE_REPLACEMENT_DESCRIPTION_ALLOWLIST = {"Replace with image."}


class AnnotationValidationError(ValueError):
    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        super().__init__(f"{code}: {detail}")


def validate_source_slide_annotations(
    source_path: Path,
    manifest_value: Mapping[str, Any] | OoxmlReferenceTemplateManifest,
) -> OoxmlReferenceTemplateManifest:
    raw = _manifest_mapping(manifest_value)
    _reject_unknown_annotation_fields(raw)
    _reject_duplicate_annotation_identities(raw)
    _reject_non_slide_locators(raw)

    try:
        manifest = OoxmlReferenceTemplateManifest.model_validate(raw)
    except ValidationError as error:
        raise AnnotationValidationError(
            "invalid_annotation", "annotation does not match the strict manifest"
        ) from error

    inventory = inspect_reference_package(
        ReferenceSource(template_id=manifest.template_id, path=source_path)
    )
    if inventory["sha256"] != manifest.source_sha256:
        raise AnnotationValidationError(
            "source_checksum_mismatch", "source checksum does not match manifest"
        )
    if inventory["slideCount"] != manifest.slide_count:
        raise AnnotationValidationError(
            "source_slide_count_mismatch", "source slide count does not match manifest"
        )

    try:
        with zipfile.ZipFile(source_path, "r") as package:
            presentation_order = _presentation_slide_order(package)
            annotated_orders = [slide.source_order for slide in manifest.source_slides]
            if len(annotated_orders) != len(set(annotated_orders)):
                raise AnnotationValidationError(
                    "duplicate_source_order", "source slide orders must be unique"
                )
            for slide in manifest.source_slides:
                _validate_slide(package, presentation_order, slide)
    except AnnotationValidationError:
        raise
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        raise AnnotationValidationError(
            "malformed_source_package", "source package cannot be annotated"
        ) from error
    return manifest


def locked_inventory_sha256(
    source_path: Path,
    slide_part: str,
    editable_shape_ids: Iterable[str],
    editable_relationship_ids: Iterable[str | None] = (),
) -> str:
    try:
        with zipfile.ZipFile(source_path, "r") as package:
            return _locked_inventory_sha256_package(
                package,
                slide_part,
                editable_shape_ids,
                editable_relationship_ids,
            )
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        raise AnnotationValidationError(
            "malformed_source_package", "locked inventory cannot be calculated"
        ) from error


def build_image_slot_candidate_report(
    source_path: Path,
    manifest: OoxmlReferenceTemplateManifest,
) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(source_path, "r") as package:
            package_names = set(package.namelist())
            relationship_entries = {
                name: package.read(name)
                for name in package_names
                if name.endswith(".rels")
            }
            candidates: list[dict[str, Any]] = []
            exclusions: list[dict[str, Any]] = []
            exclusion_counts: dict[str, int] = {}
            direct_picture_count = 0

            for slide in sorted(
                manifest.source_slides, key=lambda item: item.source_order
            ):
                relationships = _relationship_records_for_part(
                    package, slide.source_slide_part
                )
                _, animated_shape_ids, root = _slide_objects(
                    package, slide.source_slide_part
                )
                shape_tree = root.find(f".//{{{PRESENTATION_NS}}}spTree")
                if shape_tree is None:
                    continue
                entries = {
                    **relationship_entries,
                    slide.source_slide_part: package.read(slide.source_slide_part),
                }
                for picture in (
                    child
                    for child in list(shape_tree)
                    if child.tag == f"{{{PRESENTATION_NS}}}pic"
                ):
                    direct_picture_count += 1
                    if direct_picture_count > _MAX_IMAGE_SLOT_CANDIDATE_RECORDS:
                        raise AnnotationValidationError(
                            "image_candidate_limit_exceeded",
                            "direct picture count exceeds the bounded report limit",
                        )
                    record, reasons = _image_candidate_record(
                        picture=picture,
                        slide=slide,
                        relationships=relationships,
                        package_names=package_names,
                        entries=entries,
                        animated_shape_ids=animated_shape_ids,
                    )
                    if reasons:
                        record["exclusionReasons"] = reasons
                        exclusions.append(record)
                        for reason in reasons:
                            exclusion_counts[reason] = (
                                exclusion_counts.get(reason, 0) + 1
                            )
                    else:
                        candidates.append(record)
    except AnnotationValidationError:
        raise
    except (OSError, KeyError, zipfile.BadZipFile, ET.ParseError) as error:
        raise AnnotationValidationError(
            "malformed_source_package",
            "image-slot candidates cannot be inspected",
        ) from error

    return {
        "schemaVersion": 1,
        "templateId": manifest.template_id,
        "manifestVersion": manifest.version,
        "sourceSha256": manifest.source_sha256,
        "slideCount": manifest.slide_count,
        "limits": {"maxDirectPictures": _MAX_IMAGE_SLOT_CANDIDATE_RECORDS},
        "summary": {
            "directPictureCount": direct_picture_count,
            "eligibleCandidateCount": len(candidates),
            "highConfidenceCandidateCount": sum(
                bool(candidate["highConfidence"]) for candidate in candidates
            ),
            "excludedPictureCount": len(exclusions),
            "exclusionReasonCounts": dict(sorted(exclusion_counts.items())),
        },
        "candidates": candidates,
        "exclusions": exclusions,
    }


def _image_candidate_record(
    *,
    picture: ET.Element[str],
    slide: OoxmlSourceSlide,
    relationships: list[dict[str, str]],
    package_names: set[str],
    entries: Mapping[str, bytes],
    animated_shape_ids: set[str],
) -> tuple[dict[str, Any], list[str]]:
    c_nv_pr = picture.find(f".//{{{PRESENTATION_NS}}}cNvPr")
    shape_id = c_nv_pr.attrib.get("id", "") if c_nv_pr is not None else ""
    blip = picture.find(f".//{{{DRAWING_NS}}}blip")
    relationship_id = (
        blip.attrib.get(f"{{{REL_NS}}}embed", "") if blip is not None else ""
    )
    matching_relationships = [
        relationship
        for relationship in relationships
        if relationship["id"] == relationship_id
    ]
    reasons: list[str] = []
    relationship_count: int | None = None
    embed_count: int | None = None

    if not shape_id:
        reasons.append("missing_shape_id")
    elif len(shape_id) > _MAX_IMAGE_SLOT_LOCATOR_LENGTH:
        reasons.append("unbounded_shape_id")
    if not relationship_id:
        reasons.append("missing_image_relationship")
    elif len(relationship_id) > _MAX_IMAGE_SLOT_LOCATOR_LENGTH:
        reasons.append("unbounded_relationship_id")
    elif len(matching_relationships) != 1:
        reasons.append("ambiguous_image_relationship")
    else:
        relationship = matching_relationships[0]
        if relationship["targetMode"] == "External":
            reasons.append("external_image_relationship")
        elif not relationship["type"].endswith("/image"):
            reasons.append("non_image_relationship")
        else:
            media_part = relationship["targetPart"]
            if media_part not in package_names:
                reasons.append("missing_media_part")
            usage = inspect_image_media_usage(
                entries,
                slide_part=slide.source_slide_part,
                relationship_id=relationship_id,
                media_part=media_part,
            )
            relationship_count = usage.relationship_count
            embed_count = usage.embed_count
            if not usage.is_exclusive:
                reasons.append("shared_media_target")
    if shape_id in animated_shape_ids:
        reasons.append("animated_picture")

    placeholder = picture.find(f".//{{{PRESENTATION_NS}}}ph") is not None
    authored_replacement_description = (
        c_nv_pr is not None
        and _normalize_replacement_description(c_nv_pr.attrib.get("descr", ""))
        in _IMAGE_REPLACEMENT_DESCRIPTION_ALLOWLIST
    )
    explicit_replacement_intent = placeholder or authored_replacement_description
    if placeholder:
        replacement_intent = {
            "sourceType": "placeholder",
            "usage": "media-slot",
            "replaceMode": "replace",
            "confidence": 0.95,
            "evidence": "direct-picture-placeholder",
        }
    elif authored_replacement_description:
        replacement_intent = {
            "sourceType": "slide",
            "usage": "media-slot",
            "replaceMode": "replace",
            "confidence": 0.95,
            "evidence": "source-authored-image-replacement-description",
        }
    else:
        replacement_intent = {
            "sourceType": "slide",
            "usage": "media-slot",
            "replaceMode": "preserve",
            "confidence": 0.55,
            "evidence": "no-explicit-source-replacement-intent",
        }
    record: dict[str, Any] = {
        "sourceSlideId": slide.source_slide_id,
        "sourceOrder": slide.source_order,
        "shapeId": (
            shape_id
            if len(shape_id) <= _MAX_IMAGE_SLOT_LOCATOR_LENGTH
            else None
        ),
        "relationshipId": (
            relationship_id
            if 0 < len(relationship_id) <= _MAX_IMAGE_SLOT_LOCATOR_LENGTH
            else None
        ),
        "replacementIntent": replacement_intent,
        "highConfidence": not reasons and explicit_replacement_intent,
    }
    if relationship_count is not None:
        record["mediaTargetRelationshipCount"] = relationship_count
    if embed_count is not None:
        record["slideEmbedCount"] = embed_count
    return record, sorted(set(reasons))


def _normalize_replacement_description(value: str) -> str:
    return " ".join(value.split())


def _locked_inventory_sha256_package(
    package: zipfile.ZipFile,
    slide_part: str,
    editable_shape_ids: Iterable[str],
    editable_relationship_ids: Iterable[str | None],
) -> str:
    shapes, _, _ = _slide_objects(package, slide_part)
    relationships = _relationships_for_part(package, slide_part)

    editable_shapes = set(editable_shape_ids)
    editable_relationships = {value for value in editable_relationship_ids if value}
    locked = {
        "shapes": [
            shapes[shape_id]
            for shape_id in sorted(shapes, key=_shape_id_sort_key)
            if shape_id not in editable_shapes
        ],
        "relationships": [
            relationships[relationship_id]
            for relationship_id in sorted(relationships)
            if relationship_id not in editable_relationships
        ],
    }
    return hashlib.sha256(_canonical_json_bytes(locked)).hexdigest()


def build_spike_candidate(
    *,
    source: ReferenceSource,
    inventory: Mapping[str, Any],
    manifest: Mapping[str, Any] | OoxmlReferenceTemplateManifest,
) -> dict[str, Any]:
    validated = validate_source_slide_annotations(source.path, manifest)
    if inventory.get("securityPreflight") != "passed":
        raise AnnotationValidationError(
            "security_preflight_failed", "candidate did not pass source preflight"
        )
    if inventory.get("sha256") != validated.source_sha256:
        raise AnnotationValidationError(
            "inventory_checksum_mismatch", "candidate inventory checksum drifted"
        )

    slots = [slot for slide in validated.source_slides for slot in slide.slots]
    supported_slots = [
        slot for slot in slots if slot.content_type in _SUPPORTED_CONTENT_TYPES
    ]
    roles = {slide.semantic_role for slide in validated.source_slides if slide.slots}
    eligible_slides = [slide for slide in validated.source_slides if slide.slots]
    coverage = len(supported_slots) / len(slots) if slots else 0.0
    role_coverage = len(roles) / _ROLE_COUNT
    return {
        "templateId": validated.template_id,
        "version": validated.version,
        "supportedLocatorCoverage": coverage,
        "roleCoverage": role_coverage,
        "capacityEligibleSlideCount": len(eligible_slides),
        "eligibleUniqueSourceSlideCount": len(
            {slide.source_slide_id for slide in eligible_slides}
        ),
        "hasCover": any(slide.semantic_role == "cover" for slide in eligible_slides),
        "hasClosing": any(
            slide.semantic_role == "closing" for slide in eligible_slides
        ),
        "roleEligibleCounts": {
            role: sum(slide.semantic_role == role for slide in eligible_slides)
            for role in sorted(roles)
        },
    }


def select_spike_template(
    candidates: Iterable[Mapping[str, Any]],
    *,
    target_slide_count_range: tuple[int, int] = (8, 10),
) -> dict[str, Any]:
    minimum, maximum = target_slide_count_range
    if minimum <= 0 or maximum < minimum:
        raise AnnotationValidationError(
            "invalid_target_range", "target slide count range is invalid"
        )
    target_counts = list(range(minimum, maximum + 1))
    prepared: list[dict[str, Any]] = []
    for candidate_value in candidates:
        candidate = dict(candidate_value)
        eligible = int(candidate.get("capacityEligibleSlideCount", 0))
        feasible_counts = [count for count in target_counts if eligible >= count]
        has_cover = bool(candidate.get("hasCover"))
        has_closing = bool(candidate.get("hasClosing"))
        candidate["targetSlideCounts"] = feasible_counts if has_cover and has_closing else []
        prepared.append(candidate)
    eligible_candidates = [
        candidate
        for candidate in prepared
        if candidate["targetSlideCounts"] == target_counts
    ]
    if not eligible_candidates:
        raise AnnotationValidationError(
            "no_spike_candidate", "no candidate can satisfy the 8-10 slide fixture"
        )

    selected = sorted(
        eligible_candidates,
        key=lambda item: (
            -float(item["supportedLocatorCoverage"]),
            -float(item["roleCoverage"]),
            -int(item["capacityEligibleSlideCount"]),
            -int(item["eligibleUniqueSourceSlideCount"]),
            str(item["templateId"]),
            int(item["version"]),
        ),
    )[0]
    rationale = {
        "supportedLocatorCoverage": selected["supportedLocatorCoverage"],
        "roleCoverage": selected["roleCoverage"],
        "capacityEligibleSlideCount": selected["capacityEligibleSlideCount"],
        "eligibleUniqueSourceSlideCount": selected[
            "eligibleUniqueSourceSlideCount"
        ],
        "hasCover": selected["hasCover"],
        "hasClosing": selected["hasClosing"],
        "roleEligibleCounts": selected["roleEligibleCounts"],
        "targetSlideCounts": selected["targetSlideCounts"],
        "rankingCriteria": [
            "supportedLocatorCoverage",
            "roleCoverage",
            "capacityEligibleSlideCount",
            "eligibleUniqueSourceSlideCount",
            "templateId",
            "version",
        ],
    }
    return {
        **selected,
        "rationale": rationale,
    }


def build_source_slide_catalog(
    manifest: OoxmlReferenceTemplateManifest,
    *,
    target_slide_count: int = 10,
) -> dict[str, Any]:
    if target_slide_count < 2 or target_slide_count > 10:
        raise AnnotationValidationError(
            "invalid_target_count", "review fixture must contain 2-10 slides"
        )
    eligible = [slide for slide in manifest.source_slides if slide.slots]
    covers = [slide for slide in eligible if slide.semantic_role == "cover"]
    closings = [slide for slide in eligible if slide.semantic_role == "closing"]
    if not covers or not closings:
        raise AnnotationValidationError(
            "fixture_role_missing", "review fixture requires cover and closing"
        )
    middle = [
        slide
        for slide in eligible
        if slide.semantic_role not in {"cover", "closing"}
    ]
    selected = [
        sorted(covers, key=lambda slide: slide.source_order)[0],
        *sorted(middle, key=lambda slide: slide.source_order)[
            : target_slide_count - 2
        ],
        sorted(closings, key=lambda slide: slide.source_order)[0],
    ]
    if len(selected) != target_slide_count:
        raise AnnotationValidationError(
            "fixture_capacity_missing", "not enough unique annotated source slides"
        )
    manifest_bytes = json.dumps(
        manifest.model_dump(by_alias=True, mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return {
        "schemaVersion": 1,
        "templateId": manifest.template_id,
        "version": manifest.version,
        "sourceSha256": manifest.source_sha256,
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "targetSlideCount": target_slide_count,
        "slides": [
            {
                "sourceSlideId": slide.source_slide_id,
                "sourceOrder": slide.source_order,
                "semanticRole": slide.semantic_role,
                "previewId": slide.preview_id,
                "slotIds": [slot.slot_id for slot in slide.slots],
                "lockedInventorySha256": slide.locked_inventory_sha256,
            }
            for slide in selected
        ],
    }


def render_source_slide_montage(
    catalog: Mapping[str, Any],
    preview_directory: Path,
    output_path: Path,
) -> None:
    slides = catalog.get("slides")
    if not isinstance(slides, list) or not slides:
        raise AnnotationValidationError(
            "invalid_review_catalog", "review catalog has no slides"
        )
    cards: list[Image.Image] = []
    for slide in slides:
        if not isinstance(slide, Mapping):
            raise AnnotationValidationError(
                "invalid_review_catalog", "review slide entry is invalid"
            )
        preview_id = str(slide.get("previewId", ""))
        if not preview_id or PurePosixPath(preview_id).name != preview_id:
            raise AnnotationValidationError(
                "invalid_preview_id", "preview ID is not a bounded filename"
            )
        preview_path = preview_directory / f"{preview_id}.png"
        try:
            with Image.open(preview_path) as image:
                preview = image.convert("RGB")
        except (OSError, ValueError) as error:
            raise AnnotationValidationError(
                "preview_missing", "review preview PNG cannot be loaded"
            ) from error
        preview.thumbnail((480, 270))
        card = Image.new("RGB", (500, 310), "white")
        card.paste(preview, ((500 - preview.width) // 2, 8))
        label = (
            f"{slide.get('sourceOrder')} · {slide.get('semanticRole')} · "
            f"{slide.get('sourceSlideId')}"
        )
        ImageDraw.Draw(card).text((10, 286), label, fill="black")
        cards.append(card)

    columns = 2
    rows = (len(cards) + columns - 1) // columns
    montage = Image.new("RGB", (columns * 500, rows * 310), "#d9d9d9")
    for index, card in enumerate(cards):
        montage.paste(card, ((index % columns) * 500, (index // columns) * 310))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    montage.save(output_path, format="PNG")


def _validate_slide(
    package: zipfile.ZipFile,
    presentation_order: list[str],
    slide: OoxmlSourceSlide,
) -> None:
    if slide.source_order > len(presentation_order):
        raise AnnotationValidationError(
            "source_order_mismatch", "source slide order is out of range"
        )
    if presentation_order[slide.source_order - 1] != slide.source_slide_part:
        raise AnnotationValidationError(
            "source_order_mismatch", "source slide order does not match package"
        )
    relationships = _relationships_for_part(package, slide.source_slide_part)
    layout_part = _related_part(relationships, "/slideLayout")
    layout_relationships = _relationships_for_part(package, layout_part)
    master_part = _related_part(layout_relationships, "/slideMaster")
    master_relationships = _relationships_for_part(package, master_part)
    theme_part = _related_part(master_relationships, "/theme")
    expected_parts = (
        slide.relationships.layout_part,
        slide.relationships.master_part,
        slide.relationships.theme_part,
    )
    if (layout_part, master_part, theme_part) != expected_parts:
        raise AnnotationValidationError(
            "relationship_mismatch", "layout, master, or theme relationship drifted"
        )

    shapes, animated_shape_ids, _ = _slide_objects(package, slide.source_slide_part)
    package_entries: dict[str, bytes] | None = None
    counts = {"text": 0, "image": 0, "table": 0, "chart": 0}
    for slot in slide.slots:
        shape = shapes.get(slot.locator.shape_id)
        if shape is None:
            raise AnnotationValidationError(
                "unsupported_locator", "slot shape does not exist on source slide"
            )
        kind = str(shape["kind"])
        if kind == "smartart":
            raise AnnotationValidationError(
                "excluded_smartart", "SmartArt is not an editable slot"
            )
        if slot.locator.shape_id in animated_shape_ids:
            raise AnnotationValidationError(
                "excluded_animation", "animated objects are not editable slots"
            )
        if kind == "decoration":
            raise AnnotationValidationError(
                "excluded_decoration", "decoration is not an editable slot"
            )
        if kind != slot.content_type:
            raise AnnotationValidationError(
                "unsupported_locator", "slot content type does not match source object"
            )
        relationship_id = slot.locator.relationship_id
        if relationship_id is not None and relationship_id not in relationships:
            raise AnnotationValidationError(
                "unsupported_locator", "slot relationship does not exist"
            )
        if slot.content_type == "image":
            if relationship_id is None:
                raise AnnotationValidationError(
                    "unsupported_locator", "image slot relationship is required"
                )
            relationship = relationships[relationship_id]
            if not relationship["type"].endswith("/image"):
                raise AnnotationValidationError(
                    "unsupported_locator", "image slot relationship is not an image"
                )
            if package_entries is None:
                package_entries = {
                    name: package.read(name)
                    for name in package.namelist()
                    if name.endswith(".rels") or name == slide.source_slide_part
                }
            usage = inspect_image_media_usage(
                package_entries,
                slide_part=slide.source_slide_part,
                relationship_id=relationship_id,
                media_part=relationship["targetPart"],
            )
            if not usage.is_exclusive:
                raise AnnotationValidationError(
                    "shared_image_media_target",
                    "image slot media target is shared by another package consumer",
                )
        counts[slot.content_type] += 1

    declared = slide.capacity
    if counts != {
        "text": declared.text_slot_count,
        "image": declared.image_slot_count,
        "table": declared.table_slot_count,
        "chart": declared.chart_slot_count,
    }:
        raise AnnotationValidationError(
            "capacity_mismatch", "declared slot capacity does not match annotations"
        )
    expected_locked = _locked_inventory_sha256_package(
        package,
        slide.source_slide_part,
        (slot.locator.shape_id for slot in slide.slots),
        (slot.locator.relationship_id for slot in slide.slots),
    )
    if slide.locked_inventory_sha256 != expected_locked:
        raise AnnotationValidationError(
            "locked_inventory_mismatch", "locked source inventory checksum drifted"
        )


def _manifest_mapping(
    value: Mapping[str, Any] | OoxmlReferenceTemplateManifest,
) -> dict[str, Any]:
    if isinstance(value, OoxmlReferenceTemplateManifest):
        return value.model_dump(by_alias=True, mode="json")
    return dict(value)


def _reject_unknown_annotation_fields(raw: Mapping[str, Any]) -> None:
    slides = raw.get("sourceSlides")
    if not isinstance(slides, list):
        return
    for slide in slides:
        if not isinstance(slide, Mapping):
            continue
        if set(slide) - _SOURCE_SLIDE_FIELDS:
            raise AnnotationValidationError(
                "unknown_field", "source slide annotation has unknown fields"
            )
        slots = slide.get("slots")
        if not isinstance(slots, list):
            continue
        for slot in slots:
            if isinstance(slot, Mapping) and set(slot) - _SLOT_FIELDS:
                raise AnnotationValidationError(
                    "unknown_field", "slot annotation has unknown fields"
                )


def _reject_duplicate_annotation_identities(raw: Mapping[str, Any]) -> None:
    slots = [
        slot
        for slide in raw.get("sourceSlides", [])
        if isinstance(slide, Mapping)
        for slot in slide.get("slots", [])
        if isinstance(slot, Mapping)
    ]
    slot_ids = [slot.get("slotId") for slot in slots]
    if len(slot_ids) != len(set(slot_ids)):
        raise AnnotationValidationError("duplicate_slot_id", "slot IDs must be unique")
    locators = [
        (
            slot.get("locator", {}).get("slidePart"),
            slot.get("locator", {}).get("shapeId"),
            slot.get("locator", {}).get("relationshipId"),
        )
        for slot in slots
        if isinstance(slot.get("locator"), Mapping)
    ]
    if len(locators) != len(set(locators)):
        raise AnnotationValidationError(
            "duplicate_locator", "slot locators must be unique"
        )


def _reject_non_slide_locators(raw: Mapping[str, Any]) -> None:
    for slide in raw.get("sourceSlides", []):
        if not isinstance(slide, Mapping):
            continue
        for slot in slide.get("slots", []):
            if not isinstance(slot, Mapping) or not isinstance(
                slot.get("locator"), Mapping
            ):
                continue
            part = str(slot["locator"].get("slidePart", ""))
            if part.startswith(("ppt/slideMasters/", "ppt/slideLayouts/")):
                raise AnnotationValidationError(
                    "excluded_master_layout", "master/layout objects cannot be slots"
                )


def _presentation_slide_order(package: zipfile.ZipFile) -> list[str]:
    presentation = ET.fromstring(package.read("ppt/presentation.xml"))
    relationships = _relationships_for_part(package, "ppt/presentation.xml")
    order: list[str] = []
    relationship_attribute = f"{{{REL_NS}}}id"
    for slide_id in presentation.findall(f".//{{{PRESENTATION_NS}}}sldId"):
        relationship_id = slide_id.attrib[relationship_attribute]
        order.append(str(relationships[relationship_id]["targetPart"]))
    return order


def _relationships_for_part(
    package: zipfile.ZipFile, part: str
) -> dict[str, dict[str, str]]:
    part_path = PurePosixPath(part)
    rels_part = str(part_path.parent / "_rels" / f"{part_path.name}.rels")
    root = ET.fromstring(package.read(rels_part))
    relationships: dict[str, dict[str, str]] = {}
    for relationship in root.findall(
        f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
    ):
        if relationship.attrib.get("TargetMode") == "External":
            continue
        relationship_id = relationship.attrib["Id"]
        target = relationship.attrib["Target"]
        relationships[relationship_id] = {
            "id": relationship_id,
            "type": relationship.attrib["Type"],
            "targetPart": posixpath.normpath(
                posixpath.join(str(part_path.parent), target)
            ),
        }
    return relationships


def _relationship_records_for_part(
    package: zipfile.ZipFile, part: str
) -> list[dict[str, str]]:
    part_path = PurePosixPath(part)
    rels_part = str(part_path.parent / "_rels" / f"{part_path.name}.rels")
    root = ET.fromstring(package.read(rels_part))
    records: list[dict[str, str]] = []
    for relationship in root.findall(
        f"{{{PACKAGE_RELATIONSHIPS_NS}}}Relationship"
    ):
        target = relationship.attrib.get("Target", "")
        records.append(
            {
                "id": relationship.attrib.get("Id", ""),
                "type": relationship.attrib.get("Type", ""),
                "targetMode": relationship.attrib.get("TargetMode", "Internal"),
                "targetPart": (
                    target.lstrip("/")
                    if target.startswith("/")
                    else posixpath.normpath(
                        posixpath.join(str(part_path.parent), target)
                    )
                ),
            }
        )
    return records


def _related_part(
    relationships: Mapping[str, Mapping[str, str]], type_suffix: str
) -> str:
    matches = [
        value["targetPart"]
        for value in relationships.values()
        if value["type"].endswith(type_suffix)
    ]
    if len(matches) != 1:
        raise AnnotationValidationError(
            "relationship_mismatch", f"expected one {type_suffix} relationship"
        )
    return matches[0]


def _slide_objects(
    package: zipfile.ZipFile, slide_part: str
) -> tuple[dict[str, dict[str, Any]], set[str], ET.Element[str]]:
    root = ET.fromstring(package.read(slide_part))
    animated_shape_ids = {
        value
        for timing in root.findall(f".//{{{PRESENTATION_NS}}}timing")
        for element in timing.iter()
        for key, value in element.attrib.items()
        if key.rsplit("}", 1)[-1] in {"spid", "spId"}
    }
    shapes: dict[str, dict[str, Any]] = {}
    for element in root.iter():
        local = element.tag.rsplit("}", 1)[-1]
        if local not in {"sp", "pic", "graphicFrame", "cxnSp"}:
            continue
        c_nv_pr = element.find(f".//{{{PRESENTATION_NS}}}cNvPr")
        if c_nv_pr is None or "id" not in c_nv_pr.attrib:
            continue
        shape_id = c_nv_pr.attrib["id"]
        kind = _shape_kind(element, local)
        shapes[shape_id] = {
            "shapeId": shape_id,
            "name": c_nv_pr.attrib.get("name", ""),
            "kind": kind,
        }
    return shapes, animated_shape_ids, root


def _shape_kind(element: ET.Element[str], local: str) -> str:
    if local == "pic":
        return "image"
    if local == "graphicFrame":
        graphic_data = element.find(f".//{{{DRAWING_NS}}}graphicData")
        uri = graphic_data.attrib.get("uri", "") if graphic_data is not None else ""
        if "diagram" in uri or uri == DIAGRAM_URI:
            return "smartart"
        if uri.endswith("/table"):
            return "table"
        if uri.endswith("/chart"):
            return "chart"
        return "decoration"
    text = "".join(element.itertext()).strip()
    return "text" if text else "decoration"


def _shape_id_sort_key(value: str) -> tuple[int, str]:
    return (int(value), value) if value.isdigit() else (2**31 - 1, value)


def _canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
