from __future__ import annotations

import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest
from PIL import Image
from pptx import Presentation
from pptx.util import Inches

from app.ai.ooxml_reference_templates.capacity import SlotCapacityError
from app.ai.ooxml_reference_templates.clone import clone_source_slides
from app.ai.ooxml_reference_templates.image_slots import replace_image_slot
from app.ai.ooxml_reference_templates.models import OoxmlImageTemplateSlot
from app.ai.ooxml_reference_templates.package import validate_cloned_package


DML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PML_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def _png(size: tuple[int, int], color: tuple[int, int, int, int]) -> bytes:
    output = BytesIO()
    Image.new("RGBA", size, color).save(output, format="PNG")
    return output.getvalue()


def _image_fixture(tmp_path: Path) -> tuple[bytes, str, str]:
    image_path = tmp_path / "original.png"
    image_path.write_bytes(_png((400, 300), (30, 90, 150, 180)))
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    picture = slide.shapes.add_picture(
        str(image_path), Inches(2), Inches(1), Inches(6), Inches(4)
    )
    picture.crop_left = 0.1
    picture.crop_top = 0.05
    picture.crop_right = 0.15
    picture.crop_bottom = 0.08
    picture.rotation = 17
    relationship_id = picture._pic.blipFill.blip.rEmbed
    output = BytesIO()
    presentation.save(output)
    enriched = _add_mask_opacity_and_effect(output.getvalue(), str(picture.shape_id))
    cloned = clone_source_slides(
        enriched, source_slide_parts=["ppt/slides/slide1.xml"]
    )
    return cloned.package_bytes, str(picture.shape_id), relationship_id


def _add_mask_opacity_and_effect(package_bytes: bytes, shape_id: str) -> bytes:
    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        entries = {item.filename: package.read(item.filename) for item in package.infolist()}
    root = ET.fromstring(entries["ppt/slides/slide1.xml"])
    picture = next(
        item
        for item in root.findall(f".//{{{PML_NS}}}pic")
        if item.find(f".//{{{PML_NS}}}cNvPr").get("id") == shape_id
    )
    blip = picture.find(f".//{{{DML_NS}}}blip")
    ET.SubElement(blip, f"{{{DML_NS}}}alphaModFix", {"amt": "72000"})
    geometry = picture.find(f".//{{{DML_NS}}}prstGeom")
    geometry.set("prst", "ellipse")
    shape_properties = picture.find(f"{{{PML_NS}}}spPr")
    effects = ET.SubElement(shape_properties, f"{{{DML_NS}}}effectLst")
    ET.SubElement(effects, f"{{{DML_NS}}}outerShdw", {"blurRad": "38100"})
    entries["ppt/slides/slide1.xml"] = ET.tostring(root, xml_declaration=True)
    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as package:
        for name, content in entries.items():
            package.writestr(name, content)
    return output.getvalue()


def _slot(shape_id: str, relationship_id: str, *, maximum: float = 1.5) -> OoxmlImageTemplateSlot:
    return OoxmlImageTemplateSlot.model_validate(
        {
            "slotId": "fixture-v1-slide-01-image",
            "semanticRole": "image",
            "contentType": "image",
            "required": True,
            "locator": {
                "slidePart": "ppt/slides/slide1.xml",
                "shapeId": shape_id,
                "placeholderType": None,
                "relationshipId": relationship_id,
            },
            "capacity": {
                "minAspectRatio": 1.2,
                "maxAspectRatio": maximum,
                "cropPolicy": "preserve-frame",
                "alphaRequired": True,
                "maskRequired": True,
            },
            "mutationPolicy": ["image-source"],
            "replacementPolicy": {"overflow": "fail"},
        }
    )


def _picture_state(package_bytes: bytes, shape_id: str, relationship_id: str) -> dict:
    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        slide = ET.fromstring(package.read("ppt/slides/slide1.xml"))
        relationships = ET.fromstring(package.read("ppt/slides/_rels/slide1.xml.rels"))
        picture = next(
            item
            for item in slide.findall(f".//{{{PML_NS}}}pic")
            if item.find(f".//{{{PML_NS}}}cNvPr").get("id") == shape_id
        )
        relation = next(
            item
            for item in relationships.findall(f"{{{PKG_REL_NS}}}Relationship")
            if item.get("Id") == relationship_id
        )
        media_part = "ppt/media/" + Path(relation.get("Target")).name
        return {
            "xfrm": ET.tostring(picture.find(f".//{{{DML_NS}}}xfrm")),
            "crop": ET.tostring(picture.find(f".//{{{DML_NS}}}srcRect")),
            "mask": ET.tostring(picture.find(f".//{{{DML_NS}}}prstGeom")),
            "alpha": ET.tostring(picture.find(f".//{{{DML_NS}}}alphaModFix")),
            "effect": ET.tostring(picture.find(f".//{{{DML_NS}}}effectLst")),
            "relationshipId": picture.find(f".//{{{DML_NS}}}blip").get(
                f"{{{REL_NS}}}embed"
            ),
            "relationshipTarget": relation.get("Target"),
            "media": package.read(media_part),
        }


def test_image_replacement_preserves_frame_crop_mask_rotation_opacity_and_effect(
    tmp_path: Path,
) -> None:
    source, shape_id, relationship_id = _image_fixture(tmp_path)
    before = _picture_state(source, shape_id, relationship_id)
    replacement = _png((800, 600), (180, 40, 80, 160))

    result = replace_image_slot(
        source,
        slot=_slot(shape_id, relationship_id),
        image_bytes=replacement,
        mime_type="image/png",
    )
    after = _picture_state(result.package_bytes, shape_id, relationship_id)

    for key in ("xfrm", "crop", "mask", "alpha", "effect"):
        assert after[key] == before[key]
    assert after["relationshipId"] == relationship_id
    assert after["relationshipTarget"] == before["relationshipTarget"]
    assert after["media"] == replacement
    assert result.warning_codes == []
    assert validate_cloned_package(result.package_bytes) == []


def test_image_aspect_ratio_capacity_fails_without_package_mutation(tmp_path: Path) -> None:
    source, shape_id, relationship_id = _image_fixture(tmp_path)

    with pytest.raises(SlotCapacityError) as caught:
        replace_image_slot(
            source,
            slot=_slot(shape_id, relationship_id, maximum=1.4),
            image_bytes=_png((1200, 300), (10, 20, 30, 255)),
            mime_type="image/png",
        )

    assert caught.value.code == "OOXML_REFERENCE_CAPACITY_IMAGE_ASPECT_RATIO"
    assert caught.value.retryable is False
    assert caught.value.package_bytes == source
