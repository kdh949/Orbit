import base64
import copy
import hashlib
import shutil
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest
from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches

from app.ai.pptx_ooxml_generation import (
    PptxRenderUnavailableError,
    generate_pptx_ooxml,
    render_pptx_to_png_assets,
    shape_fallback_assets,
    strip_text_from_pptx_package,
    sync_pptx_ooxml,
)
from app.ai.pptx_design_importer import ImportedDesignAsset
from app.main import app


def template_slide_id(generated: object, slide_index: int = 0) -> str:
    return generated.template_blueprint["slides"][slide_index]["slideId"]


def test_pure_generation_preserves_package_entries_and_source_text(
    tmp_path: Path,
) -> None:
    pptx_path = sample_pptx(tmp_path)

    result = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    package_asset = next(
        asset for asset in result.assets if asset.asset_id == "current_package"
    )
    package_bytes = base64.b64decode(package_asset.content_base64)

    assert package_bytes == pptx_path.read_bytes()
    assert zip_entry_hashes(package_bytes) == zip_entry_hashes(pptx_path.read_bytes())
    assert len(result.template_blueprint["slides"]) == 1
    assert result.template_blueprint["currentPackageFileId"] == "asset:current_package"
    assert result.blueprint["slides"][0]["elements"]
    assert any(
        element["type"] == "text"
        and element["props"]["text"] == "Placeholder Title"
        for element in result.blueprint["slides"][0]["elements"]
    )


def test_apply_slot_texts_route_is_not_registered() -> None:
    assert "/ai/pptx-ooxml-apply-slot-texts" not in app.openapi()["paths"]


def test_generation_blueprint_uses_detected_canvas(tmp_path: Path) -> None:
    pptx_path = sample_pptx(tmp_path, wide=False)

    result = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    background = next(
        element
        for element in result.blueprint["slides"][0]["elements"]
        if element["role"] == "background"
    )
    title_slot = next(
        slot
        for slot in result.template_blueprint["slides"][0]["slots"]
        if slot["usage"] == "content-slot"
    )

    assert result.canvas["preset"] == "standard-4-3"
    assert result.blueprint["canvas"] == {"width": 1024, "height": 768}
    assert background["width"] == 1024
    assert background["height"] == 768
    assert title_slot["bounds"]["width"] <= 1024
    assert title_slot["bounds"]["height"] <= 768


def test_extracts_slot_mapping(tmp_path: Path) -> None:
    pptx_path = sample_pptx(tmp_path)
    result = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    slots = result.template_blueprint["slides"][0]["slots"]

    assert any(slot["usage"] == "content-slot" for slot in slots)
    assert any(
        slot["usage"] == "media-slot" and slot["replaceMode"] == "replace"
        for slot in slots
    )
    assert all(
        slot["source"].get("slidePart") == "ppt/slides/slide1.xml" for slot in slots
    )


def test_generation_includes_imported_image_assets(tmp_path: Path) -> None:
    pptx_path = sample_pptx(tmp_path)

    result = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    image_asset = next(asset for asset in result.assets if asset.asset_id == "image_1")

    assert image_asset.mime_type == "image/png"
    assert base64.b64decode(image_asset.content_base64).startswith(b"\x89PNG")


def test_sync_pptx_ooxml_applies_text_and_frame_patch(tmp_path: Path) -> None:
    pptx_path = sample_pptx(tmp_path)
    generated = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    title_slot = next(
        slot
        for slot in generated.template_blueprint["slides"][0]["slots"]
        if slot["usage"] == "content-slot"
    )
    title_element = next(
        element
        for element in generated.blueprint["slides"][0]["elements"]
        if element["elementId"] == title_slot["elementId"]
    )

    result = sync_pptx_ooxml(
        pptx_path,
        template_blueprint=generated.template_blueprint,
        deck_canvas={
            "preset": "wide-16-9",
            "width": 1920,
            "height": 1080,
            "aspectRatio": "16:9",
        },
        synced_deck_version=2,
        render=False,
        operations=[
            {
                "type": "update_element_props",
                "slideId": template_slide_id(generated),
                "elementId": title_slot["elementId"],
                "props": {"text": "Synced Title"},
            },
            {
                "type": "update_element_frame",
                "slideId": template_slide_id(generated),
                "elementId": title_slot["elementId"],
                "frame": {
                    "role": title_element.get("role"),
                    "x": 96,
                    "y": 48,
                    "width": 640,
                    "height": 120,
                    "rotation": title_element["rotation"],
                    "opacity": title_element["opacity"],
                    "zIndex": title_element["zIndex"],
                    "locked": title_element["locked"],
                    "visible": title_element["visible"],
                },
            },
        ],
    )
    package_asset = next(
        asset for asset in result.assets if asset.asset_id == "current_package"
    )
    package_bytes = base64.b64decode(package_asset.content_base64)

    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        slide_xml = package.read("ppt/slides/slide1.xml")

    assert b"Synced Title" in slide_xml
    assert b"Placeholder Title" not in slide_xml
    assert b'x="609600"' in slide_xml
    assert b'cx="4064000"' in slide_xml
    slide_root = ET.fromstring(slide_xml)
    assert any(
        body_pr.get("horzOverflow") == "clip"
        and body_pr.get("vertOverflow") == "clip"
        and body_pr.get("wrap") == "square"
        for body_pr in slide_root.findall(
            ".//{http://schemas.openxmlformats.org/drawingml/2006/main}bodyPr"
        )
    )


def test_sync_pptx_ooxml_skips_grouped_child_frame_patch(tmp_path: Path) -> None:
    pptx_path = sample_scaled_group_pptx(tmp_path)
    original_bytes = pptx_path.read_bytes()
    generated = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    target = next(
        element
        for element in generated.blueprint["slides"][0]["elements"]
        if element.get("props", {}).get("text") == "Grouped frame target"
    )
    original_frame = {
        key: target[key] for key in ("x", "y", "width", "height", "rotation")
    }

    result = sync_pptx_ooxml(
        pptx_path,
        template_blueprint=generated.template_blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=2,
        render=False,
        operations=[
            {
                "type": "update_element_frame",
                "slideId": template_slide_id(generated),
                "elementId": target["elementId"],
                "frame": {
                    "x": target["x"] + 100,
                    "y": target["y"] + 50,
                    "width": target["width"],
                    "height": target["height"],
                },
            }
        ],
    )
    package_bytes = current_package_bytes(result.assets)

    assert package_bytes == original_bytes
    assert result.warnings == [
        f"OOXML grouped frame sync skipped for {target['elementId']}."
    ]
    assert result.applied_operations == []
    assert [
        operation.reason_code for operation in result.unsupported_operations
    ] == ["GROUPED_FRAME_UNSUPPORTED"]

    synced_path = tmp_path / "grouped-frame-synced.pptx"
    synced_path.write_bytes(package_bytes)
    reimported = generate_pptx_ooxml(synced_path, "file_template", render=False)
    reimported_target = next(
        element
        for element in reimported.blueprint["slides"][0]["elements"]
        if element.get("props", {}).get("text") == "Grouped frame target"
    )
    assert {
        key: reimported_target[key]
        for key in ("x", "y", "width", "height", "rotation")
    } == original_frame


def test_sync_pptx_ooxml_round_trips_text_and_target_image(
    tmp_path: Path,
) -> None:
    pptx_path = sample_round_trip_pptx(tmp_path)
    original_bytes = pptx_path.read_bytes()
    generated = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    elements = generated.blueprint["slides"][0]["elements"]
    sources = generated.template_blueprint["slides"][0]["elementSources"]
    title = next(element for element in elements if element["type"] == "text")
    images = [element for element in elements if element["type"] == "image"]
    target_image = next(
        element for element in images if element["props"]["src"] == "asset:image_2"
    )
    untouched_image = next(
        element for element in images if element["props"]["src"] == "asset:image_1"
    )
    fallback_source = next(source for source in sources if source.get("fallbackReason"))
    target_source = source_for_element(sources, target_image["elementId"])
    untouched_source = source_for_element(sources, untouched_image["elementId"])
    replacement_bytes = png_bytes("#00ff00")
    replacement_data_url = (
        "data:image/png;base64," + base64.b64encode(replacement_bytes).decode("ascii")
    )

    result = sync_pptx_ooxml(
        pptx_path,
        template_blueprint=generated.template_blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=2,
        render=False,
        operations=[
            {
                "type": "update_element_props",
                "slideId": template_slide_id(generated),
                "elementId": title["elementId"],
                "props": {"text": "Synced round-trip title"},
            },
            {
                "type": "update_element_props",
                "slideId": template_slide_id(generated),
                "elementId": target_image["elementId"],
                "props": {"src": replacement_data_url},
            },
        ],
    )
    package_bytes = current_package_bytes(result.assets)
    target_relationship_id = picture_relationship_id(
        package_bytes, target_source["shapeId"]
    )

    assert result.warnings == []
    assert len(result.applied_operations) == 2
    assert result.unsupported_operations == []
    assert target_relationship_id != target_source["relationshipId"]
    assert source_for_element(
        result.element_sources,
        target_image["elementId"],
    )["relationshipId"] == target_relationship_id
    assert (
        picture_relationship_id(package_bytes, untouched_source["shapeId"])
        == untouched_source["relationshipId"]
    )
    assert relationship_blob(
        package_bytes,
        "ppt/slides/slide1.xml",
        target_relationship_id,
    ) == replacement_bytes
    assert relationship_blob(
        package_bytes,
        "ppt/slides/slide1.xml",
        untouched_source["relationshipId"],
    ) == relationship_blob(
        original_bytes,
        "ppt/slides/slide1.xml",
        untouched_source["relationshipId"],
    )
    assert shape_xml(package_bytes, fallback_source["shapeId"]) == shape_xml(
        original_bytes,
        fallback_source["shapeId"],
    )

    round_trip_path = tmp_path / "round-trip.pptx"
    round_trip_path.write_bytes(package_bytes)
    round_trip = generate_pptx_ooxml(
        round_trip_path,
        "file_round_trip",
        render=False,
    )

    assert any(
        element["type"] == "text"
        and element["props"]["text"] == "Synced round-trip title"
        for element in round_trip.blueprint["slides"][0]["elements"]
    )
    assert replacement_bytes in {
        base64.b64decode(asset.content_base64)
        for asset in round_trip.assets
        if asset.mime_type == "image/png"
    }
    assert any(
        source.get("fallbackReason") == fallback_source["fallbackReason"]
        for source in round_trip.template_blueprint["slides"][0]["elementSources"]
    )


def test_sync_pptx_ooxml_round_trips_image_crop_and_rejects_unsafe_capability(
    tmp_path: Path,
) -> None:
    pptx_path = sample_round_trip_pptx(tmp_path)
    original_bytes = pptx_path.read_bytes()
    generated = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    target = next(
        element
        for element in generated.blueprint["slides"][0]["elements"]
        if element["type"] == "image" and element["props"]["src"] == "asset:image_2"
    )
    source = source_for_element(
        generated.template_blueprint["slides"][0]["elementSources"],
        target["elementId"],
    )
    crop = {"left": 0.2, "top": 0.1, "right": 0.15, "bottom": 0.05}
    operation = {
        "type": "update_element_props",
        "slideId": template_slide_id(generated),
        "elementId": target["elementId"],
        "props": {"crop": crop},
    }

    assert source["ooxmlEditCapabilities"]["crop"] == "picture"

    synced = sync_pptx_ooxml(
        pptx_path,
        template_blueprint=generated.template_blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=2,
        render=False,
        operations=[operation],
    )
    synced_bytes = current_package_bytes(synced.assets)

    assert synced.warnings == []
    assert len(synced.applied_operations) == 1
    assert synced.unsupported_operations == []
    assert picture_crop_rect(synced_bytes, source["shapeId"]) == {
        "l": "20000",
        "t": "10000",
        "r": "15000",
        "b": "5000",
    }

    synced_path = tmp_path / "crop-synced.pptx"
    synced_path.write_bytes(synced_bytes)
    reimported = generate_pptx_ooxml(synced_path, "file_crop", render=False)
    reimported_target = next(
        element
        for element in reimported.blueprint["slides"][0]["elements"]
        if element["type"] == "image" and element["props"].get("crop") == crop
    )
    assert reimported_target["props"]["crop"] == crop

    unsafe_blueprint = copy.deepcopy(generated.template_blueprint)
    unsafe_source = source_for_element(
        unsafe_blueprint["slides"][0]["elementSources"], target["elementId"]
    )
    unsafe_source["ooxmlEditCapabilities"]["crop"] = "none"
    rejected = sync_pptx_ooxml(
        pptx_path,
        template_blueprint=unsafe_blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=2,
        render=False,
        operations=[operation],
    )

    assert current_package_bytes(rejected.assets) == original_bytes
    assert rejected.applied_operations == []
    assert [
        unsupported.reason_code for unsupported in rejected.unsupported_operations
    ] == ["CROP_CAPABILITY_UNSAFE"]


def test_sync_pptx_ooxml_adds_writable_text_rect_and_image(
    tmp_path: Path,
) -> None:
    pptx_path = sample_round_trip_pptx(tmp_path)
    generated = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    first_image = png_bytes("#00ff00")
    second_image = png_bytes("#ffff00")
    added_elements = [
        {
            "elementId": "el_added_text",
            "type": "text",
            "x": 100,
            "y": 600,
            "width": 500,
            "height": 100,
            "props": {"text": "Added text"},
        },
        {
            "elementId": "el_added_rect",
            "type": "rect",
            "x": 700,
            "y": 600,
            "width": 300,
            "height": 100,
            "props": {
                "fill": "#336699",
                "stroke": "#0090FF",
                "strokeWidth": 3,
                "borderRadius": 18,
            },
        },
        {
            "elementId": "el_added_image",
            "type": "image",
            "x": 1100,
            "y": 550,
            "width": 240,
            "height": 180,
            "props": {
                "src": "data:image/png;base64,"
                + base64.b64encode(first_image).decode("ascii")
            },
        },
    ]

    added = sync_pptx_ooxml(
        pptx_path,
        template_blueprint=generated.template_blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=2,
        render=False,
        operations=[
            {
                "type": "add_element",
                "slideId": template_slide_id(generated),
                "element": element,
            }
            for element in added_elements
        ],
    )

    assert added.warnings == []
    added_sources = {
        source["elementId"]: source for source in added.element_sources
    }
    assert set(added_sources) == {
        "el_added_text",
        "el_added_rect",
        "el_added_image",
    }
    assert all(
        source["shapeId"] != "0" and source["writable"] is True
        for source in added_sources.values()
    )
    assert added_sources["el_added_image"]["relationshipId"].startswith("rId")
    assert (
        added_sources["el_added_image"]["ooxmlEditCapabilities"]["crop"]
        == "picture"
    )

    added_path = tmp_path / "added.pptx"
    added_path.write_bytes(current_package_bytes(added.assets))
    next_blueprint = copy.deepcopy(generated.template_blueprint)
    next_blueprint["slides"][0]["elementSources"].extend(added.element_sources)
    edited = sync_pptx_ooxml(
        added_path,
        template_blueprint=next_blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=3,
        render=False,
        operations=[
            {
                "type": "update_element_props",
                "slideId": template_slide_id(generated),
                "elementId": "el_added_text",
                "props": {"text": "Edited added text"},
            },
            {
                "type": "update_element_frame",
                "slideId": template_slide_id(generated),
                "elementId": "el_added_rect",
                "frame": {"x": 320, "y": 600, "width": 300, "height": 100},
            },
            {
                "type": "update_element_props",
                "slideId": template_slide_id(generated),
                "elementId": "el_added_rect",
                "props": {"fill": "#FEFEFE"},
            },
            {
                "type": "update_element_props",
                "slideId": template_slide_id(generated),
                "elementId": "el_added_rect",
                "props": {"stroke": "#FEFEFE"},
            },
            {
                "type": "update_element_props",
                "slideId": template_slide_id(generated),
                "elementId": "el_added_image",
                "props": {
                    "src": "data:image/png;base64,"
                    + base64.b64encode(second_image).decode("ascii"),
                    "crop": {
                        "left": 0.1,
                        "top": 0.2,
                        "right": 0.15,
                        "bottom": 0.05,
                    },
                },
            },
            {
                "type": "update_element_frame",
                "slideId": template_slide_id(generated),
                "elementId": "el_added_image",
                "frame": {
                    "opacity": 0.29,
                    "visible": False,
                    "zIndex": 17,
                },
            },
        ],
    )
    edited_bytes = current_package_bytes(edited.assets)

    assert edited.warnings == []
    assert b"Edited added text" in shape_xml(
        edited_bytes, added_sources["el_added_text"]["shapeId"]
    )
    assert b'x="2032000"' in shape_xml(
        edited_bytes, added_sources["el_added_rect"]["shapeId"]
    )
    edited_rect_xml = shape_xml(
        edited_bytes, added_sources["el_added_rect"]["shapeId"]
    )
    assert b'prst="roundRect"' in edited_rect_xml
    assert b'name="adj" fmla="val 18000"' in edited_rect_xml
    assert edited_rect_xml.count(b'<a:srgbClr val="FEFEFE"') == 2
    edited_image_source = source_for_element(
        edited.element_sources,
        "el_added_image",
    )
    assert relationship_blob(
        edited_bytes,
        "ppt/slides/slide1.xml",
        edited_image_source["relationshipId"],
    ) == second_image
    assert picture_crop_rect(
        edited_bytes, added_sources["el_added_image"]["shapeId"]
    ) == {"l": "10000", "t": "20000", "r": "15000", "b": "5000"}
    edited_image_xml = shape_xml(
        edited_bytes, added_sources["el_added_image"]["shapeId"]
    )
    assert b'alphaModFix amt="29000"' in edited_image_xml
    assert b'hidden="1"' in edited_image_xml

    edited_path = tmp_path / "edited-added.pptx"
    edited_path.write_bytes(edited_bytes)
    reshown_blueprint = copy.deepcopy(next_blueprint)
    reshown_blueprint["slides"][0]["elementSources"] = [
        edited_image_source
        if source["elementId"] == "el_added_image"
        else source
        for source in reshown_blueprint["slides"][0]["elementSources"]
    ]
    reshown = sync_pptx_ooxml(
        edited_path,
        template_blueprint=reshown_blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=4,
        render=False,
        operations=[
            {
                "type": "update_element_frame",
                "slideId": template_slide_id(generated),
                "elementId": "el_added_image",
                "frame": {"opacity": 0.29, "visible": True},
            }
        ],
    )
    reshown_bytes = current_package_bytes(reshown.assets)
    reshown_image_xml = shape_xml(
        reshown_bytes, added_sources["el_added_image"]["shapeId"]
    )
    assert b'alphaModFix amt="29000"' in reshown_image_xml
    assert b'hidden="1"' not in reshown_image_xml

    edited_path.write_bytes(reshown_bytes)
    round_trip = generate_pptx_ooxml(
        edited_path,
        "file_round_trip",
        render=False,
    )
    round_trip_shape_ids = {
        source["shapeId"]
        for source in round_trip.template_blueprint["slides"][0]["elementSources"]
    }

    assert {
        source["shapeId"] for source in added_sources.values()
    }.issubset(round_trip_shape_ids)
    assert any(
        element["type"] == "text" and element["props"]["text"] == "Edited added text"
        for element in round_trip.blueprint["slides"][0]["elements"]
    )
    assert second_image in {
        base64.b64decode(asset.content_base64)
        for asset in round_trip.assets
        if asset.mime_type == "image/png"
    }


def test_sync_pptx_ooxml_scopes_duplicate_element_ids_to_slide_part(
    tmp_path: Path,
) -> None:
    pptx_path, shape_ids = sample_duplicate_element_ids_pptx(tmp_path)
    original_bytes = pptx_path.read_bytes()
    generated = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    blueprint = copy.deepcopy(generated.template_blueprint)
    mapped_sources: list[dict[str, dict]] = []
    for slide_index, ids in enumerate(shape_ids):
        sources = blueprint["slides"][slide_index]["elementSources"]
        text_source = next(source for source in sources if source["shapeId"] == ids["text"])
        image_source = next(
            source for source in sources if source["shapeId"] == ids["image"]
        )
        delete_source = next(
            source for source in sources if source["shapeId"] == ids["delete"]
        )
        text_source["elementId"] = "el_shared_text"
        image_source["elementId"] = "el_shared_image"
        delete_source["elementId"] = "el_shared_delete"
        assert image_source["ooxmlEditCapabilities"]["frame"] is True
        image_source["ooxmlEditCapabilities"]["frame"] = False
        assert delete_source["ooxmlEditCapabilities"]["delete"] is True
        delete_source["ooxmlEditCapabilities"]["delete"] = False
        mapped_sources.append(
            {"text": text_source, "image": image_source, "delete": delete_source}
        )

    replacement_image = png_bytes("#ffff00")
    synced = sync_pptx_ooxml(
        pptx_path,
        template_blueprint=blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=2,
        render=False,
        operations=[
            {
                "type": "update_element_props",
                "slideId": blueprint["slides"][1]["slideId"],
                "elementId": "el_shared_text",
                "props": {"text": "Only slide two"},
            },
            {
                "type": "update_element_frame",
                "slideId": blueprint["slides"][1]["slideId"],
                "elementId": "el_shared_image",
                "frame": {"x": 400, "y": 300, "width": 240, "height": 180},
            },
            {
                "type": "update_element_props",
                "slideId": blueprint["slides"][1]["slideId"],
                "elementId": "el_shared_image",
                "props": {
                    "src": "data:image/png;base64,"
                    + base64.b64encode(replacement_image).decode("ascii")
                },
            },
            {
                "type": "delete_element",
                "slideId": blueprint["slides"][1]["slideId"],
                "elementId": "el_shared_delete",
            },
        ],
    )
    synced_bytes = current_package_bytes(synced.assets)

    assert synced.warnings == []
    assert package_entry(synced_bytes, "ppt/slides/slide1.xml") == package_entry(
        original_bytes, "ppt/slides/slide1.xml"
    )
    assert package_entry(
        synced_bytes, "ppt/slides/_rels/slide1.xml.rels"
    ) == package_entry(original_bytes, "ppt/slides/_rels/slide1.xml.rels")
    assert b"Only slide two" in shape_xml(
        synced_bytes,
        mapped_sources[1]["text"]["shapeId"],
        "ppt/slides/slide2.xml",
    )
    assert b'x="2540000"' in shape_xml(
        synced_bytes,
        mapped_sources[1]["image"]["shapeId"],
        "ppt/slides/slide2.xml",
    )
    synced_image_source = next(
        source
        for source in synced.element_sources
        if source["slidePart"] == "ppt/slides/slide2.xml"
        and source["elementId"] == "el_shared_image"
    )
    assert relationship_blob(
        synced_bytes,
        "ppt/slides/slide2.xml",
        synced_image_source["relationshipId"],
    ) == replacement_image
    with pytest.raises(AssertionError):
        shape_xml(
            synced_bytes,
            mapped_sources[1]["delete"]["shapeId"],
            "ppt/slides/slide2.xml",
        )

    synced_path = tmp_path / "duplicate-ids-synced.pptx"
    synced_path.write_bytes(synced_bytes)
    added = sync_pptx_ooxml(
        synced_path,
        template_blueprint=blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=3,
        render=False,
        operations=[
            {
                "type": "add_element",
                "slideId": blueprint["slides"][slide_index - 1]["slideId"],
                "element": {
                    "elementId": "el_shared_added",
                    "type": "text",
                    "x": 100,
                    "y": 600,
                    "width": 400,
                    "height": 80,
                    "props": {"text": f"Added on slide {slide_index}"},
                },
            }
            for slide_index in (1, 2)
        ],
    )
    added_sources = [
        source
        for source in added.element_sources
        if source["elementId"] == "el_shared_added"
    ]

    assert added.warnings == []
    assert {source["slidePart"] for source in added_sources} == {
        "ppt/slides/slide1.xml",
        "ppt/slides/slide2.xml",
    }


@pytest.mark.parametrize(
    "src",
    [
        "not-a-data-url",
        "data:image/svg+xml;base64,PHN2Zy8+",
        "data:image/png;base64,!!!",
        "data:image/png;base64,bm90LWFuLWltYWdl",
    ],
)
def test_sync_pptx_ooxml_rejects_invalid_image_data_without_package_changes(
    tmp_path: Path,
    src: str,
) -> None:
    pptx_path = sample_pptx(tmp_path)
    generated = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    image = next(
        element
        for element in generated.blueprint["slides"][0]["elements"]
        if element["type"] == "image"
    )

    result = sync_pptx_ooxml(
        pptx_path,
        template_blueprint=generated.template_blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=2,
        render=False,
        operations=[
            {
                "type": "update_element_props",
                "slideId": template_slide_id(generated),
                "elementId": image["elementId"],
                "props": {"src": src},
            },
            {
                "type": "add_element",
                "slideId": template_slide_id(generated),
                "element": {
                    "elementId": "el_invalid_image",
                    "type": "image",
                    "x": 0,
                    "y": 0,
                    "width": 100,
                    "height": 100,
                    "props": {"src": src},
                },
            },
        ],
    )

    assert current_package_bytes(result.assets) == pptx_path.read_bytes()
    assert len(result.warnings) == 2
    assert all("OOXML" in warning and "image" in warning for warning in result.warnings)


def test_renders_slide_pngs_when_libreoffice_is_available(tmp_path: Path) -> None:
    if not (shutil.which("libreoffice") or shutil.which("soffice")):
        pytest.skip("LibreOffice is not installed.")

    pptx_path = sample_pptx(tmp_path)
    result = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    canvas = type(
        "Canvas",
        (),
        {"width": 1920, "height": 1080, "preset": "wide-16-9", "aspect_ratio": "16:9"},
    )()

    try:
        assets = render_pptx_to_png_assets(
            base64.b64decode(result.assets[0].content_base64),
            canvas,
        )
    except PptxRenderUnavailableError as error:
        pytest.skip(str(error))

    assert len(assets) == 1
    assert assets[0].mime_type == "image/png"
    assert base64.b64decode(assets[0].content_base64).startswith(b"\x89PNG")


def test_shape_fallback_assets_crop_from_slide_render() -> None:
    slide_render = BytesIO()
    Image.new("RGB", (100, 80), "#336699").save(slide_render, format="PNG")
    warnings: list[str] = []

    assets = shape_fallback_assets(
        {
            "slides": [
                {
                    "sourceSlideIndex": 1,
                    "elements": [
                        {
                            "type": "image",
                            "x": 10,
                            "y": 15,
                            "width": 30,
                            "height": 25,
                            "props": {
                                "src": "asset:shape_render_1_slide_2",
                            },
                        }
                    ],
                }
            ]
        },
        [
            ImportedDesignAsset(
                assetId="slide_render_1",
                fileName="slide-01.png",
                mimeType="image/png",
                contentBase64=base64.b64encode(slide_render.getvalue()).decode(
                    "ascii"
                ),
            )
        ],
        warnings,
    )
    crop = Image.open(BytesIO(base64.b64decode(assets[0].content_base64)))

    assert warnings == []
    assert assets[0].asset_id == "shape_render_1_slide_2"
    assert assets[0].mime_type == "image/png"
    assert crop.size == (30, 25)


def test_strip_text_from_pptx_package_removes_text_bodies(tmp_path: Path) -> None:
    pptx_path = sample_pptx(tmp_path)

    stripped = strip_text_from_pptx_package(pptx_path.read_bytes())

    with zipfile.ZipFile(BytesIO(stripped), "r") as package:
        slide_xml = package.read("ppt/slides/slide1.xml")

    assert b"Placeholder Title" not in slide_xml
    assert b"<p:txBody>" not in slide_xml


def test_sync_pptx_ooxml_adds_authored_slide_and_same_batch_image(
    tmp_path: Path,
) -> None:
    pptx_path = sample_pptx(tmp_path)
    generated = generate_pptx_ooxml(pptx_path, "file_template", render=False)
    blueprint = copy.deepcopy(generated.template_blueprint)
    blueprint["slides"].append(
        {
            "slideId": "slide_authored",
            "slideIndex": 2,
            "sourceSlideIndex": 2,
            "sourceSlidePart": "ppt/slides/slide2.xml",
            "ooxmlOrigin": "authored",
            "slots": [],
            "elementSources": [],
        }
    )
    image_src = "data:image/png;base64," + base64.b64encode(
        png_bytes("#22c55e")
    ).decode("ascii")

    result = sync_pptx_ooxml(
        pptx_path,
        template_blueprint=blueprint,
        deck_canvas=generated.canvas,
        synced_deck_version=2,
        render=False,
        operations=[
            {
                "type": "add_slide",
                "sourceSlidePart": "ppt/slides/slide2.xml",
                "slide": {
                    "slideId": "slide_authored",
                    "order": 2,
                    "title": "Authored slide",
                    "elements": [
                        {
                            "elementId": "el_authored_text",
                            "type": "text",
                            "x": 120,
                            "y": 100,
                            "width": 600,
                            "height": 100,
                            "props": {"text": "Authored title"},
                        },
                        {
                            "elementId": "el_authored_rect",
                            "type": "rect",
                            "x": 120,
                            "y": 260,
                            "width": 400,
                            "height": 180,
                            "props": {"fill": "#2563EB"},
                        },
                    ],
                },
            },
            {
                "type": "add_element",
                "slideId": "slide_authored",
                "sourceSlidePart": "ppt/slides/slide2.xml",
                "element": {
                    "elementId": "el_authored_image",
                    "type": "image",
                    "x": 800,
                    "y": 260,
                    "width": 320,
                    "height": 180,
                    "props": {"src": image_src, "fit": "contain"},
                },
            },
            {
                "type": "reorder_slides",
                "slideOrders": [
                    {
                        "slideId": "slide_authored",
                        "order": 1,
                        "sourceSlidePart": "ppt/slides/slide2.xml",
                    },
                    {
                        "slideId": template_slide_id(generated),
                        "order": 2,
                        "sourceSlidePart": "ppt/slides/slide1.xml",
                    },
                ],
            },
        ],
    )

    assert result.unsupported_operations == []
    assert [item.operation_type for item in result.applied_operations] == [
        "add_slide",
        "add_element",
        "reorder_slides",
    ]
    assert {source["elementId"] for source in result.element_sources} == {
        "el_authored_text",
        "el_authored_rect",
        "el_authored_image",
    }
    package_bytes = current_package_bytes(result.assets)
    round_trip = Presentation(BytesIO(package_bytes))
    assert len(round_trip.slides) == 2
    assert any(
        "Authored title" in shape.text
        for shape in round_trip.slides[0].shapes
        if hasattr(shape, "text")
    )
    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        assert "ppt/slides/slide2.xml" in package.namelist()
        rels = ET.fromstring(package.read("ppt/slides/_rels/slide2.xml.rels"))
        assert any(
            str(relationship.get("Type", "")).endswith("/slideLayout")
            for relationship in rels
        )
        assert b'/ppt/slides/slide2.xml' in package.read("[Content_Types].xml")


def sample_pptx(tmp_path: Path, *, wide: bool = True) -> Path:
    pptx_path = tmp_path / "template.pptx"
    image_path = tmp_path / "image.png"
    Image.new("RGB", (32, 32), "#ff0000").save(image_path)

    presentation = Presentation()
    presentation.slide_width = Inches(13.333333 if wide else 10)
    presentation.slide_height = Inches(7.5)
    slide = presentation.slides.add_slide(presentation.slide_layouts[0])
    slide.shapes.title.text_frame.text = "Placeholder Title"
    slide.placeholders[1].text_frame.text = "Placeholder Subtitle"
    slide.shapes.add_picture(
        str(image_path), Inches(7), Inches(2), Inches(2), Inches(2)
    )
    presentation.save(pptx_path)
    return pptx_path


def sample_round_trip_pptx(tmp_path: Path) -> Path:
    pptx_path = tmp_path / "round-trip-source.pptx"
    first_image_path = tmp_path / "first.png"
    second_image_path = tmp_path / "second.png"
    first_image_path.write_bytes(png_bytes("#ff0000"))
    second_image_path.write_bytes(png_bytes("#0000ff"))

    presentation = Presentation()
    presentation.slide_width = Inches(13.333333)
    presentation.slide_height = Inches(7.5)
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    slide.shapes.add_textbox(
        Inches(1), Inches(0.5), Inches(5), Inches(0.8)
    ).text_frame.text = "Original round-trip title"
    slide.shapes.add_picture(
        str(first_image_path), Inches(1), Inches(2), Inches(2), Inches(2)
    )
    slide.shapes.add_picture(
        str(second_image_path), Inches(4), Inches(2), Inches(2), Inches(2)
    )
    slide.shapes.add_shape(
        MSO_SHAPE.CLOUD,
        Inches(8),
        Inches(2),
        Inches(2),
        Inches(1.5),
    )
    presentation.save(pptx_path)
    return pptx_path


def sample_scaled_group_pptx(tmp_path: Path) -> Path:
    pptx_path = tmp_path / "scaled-group.pptx"
    presentation = Presentation()
    presentation.slide_width = Inches(13.333333)
    presentation.slide_height = Inches(7.5)
    slide = presentation.slides.add_slide(presentation.slide_layouts[6])
    box = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(1),
        Inches(1),
        Inches(2),
        Inches(1),
    )
    target = slide.shapes.add_textbox(
        Inches(1.2),
        Inches(1.2),
        Inches(1.4),
        Inches(0.5),
    )
    target.text_frame.text = "Grouped frame target"
    group = slide.shapes.add_group_shape([box, target])
    group.left = Inches(4)
    group.top = Inches(2)
    group.width = Inches(5)
    group.height = Inches(2.5)
    presentation.save(pptx_path)
    return pptx_path


def sample_duplicate_element_ids_pptx(
    tmp_path: Path,
) -> tuple[Path, list[dict[str, str]]]:
    pptx_path = tmp_path / "duplicate-element-ids.pptx"
    presentation = Presentation()
    presentation.slide_width = Inches(13.333333)
    presentation.slide_height = Inches(7.5)
    shape_ids: list[dict[str, str]] = []
    for slide_index, color in enumerate(("#ff0000", "#0000ff"), start=1):
        image_path = tmp_path / f"duplicate-{slide_index}.png"
        image_path.write_bytes(png_bytes(color))
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        text = slide.shapes.add_textbox(
            Inches(1), Inches(0.5), Inches(5), Inches(0.8)
        )
        text.text_frame.text = f"Slide {slide_index} title"
        image = slide.shapes.add_picture(
            str(image_path), Inches(1), Inches(2), Inches(2), Inches(2)
        )
        delete_shape = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE,
            Inches(4),
            Inches(2),
            Inches(2),
            Inches(1),
        )
        shape_ids.append(
            {
                "text": str(text.shape_id),
                "image": str(image.shape_id),
                "delete": str(delete_shape.shape_id),
            }
        )
    presentation.save(pptx_path)
    return pptx_path, shape_ids


def png_bytes(color: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (8, 8), color).save(output, format="PNG")
    return output.getvalue()


def current_package_bytes(assets: list[ImportedDesignAsset]) -> bytes:
    package = next(asset for asset in assets if asset.asset_id == "current_package")
    return base64.b64decode(package.content_base64)


def source_for_element(sources: list[dict], element_id: str) -> dict:
    return next(source for source in sources if source["elementId"] == element_id)


def picture_relationship_id(package_bytes: bytes, shape_id: str) -> str:
    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        root = ET.fromstring(package.read("ppt/slides/slide1.xml"))
    for picture in root.iter():
        if not picture.tag.endswith("pic"):
            continue
        c_nv_pr = next(
            (node for node in picture.iter() if node.tag.endswith("cNvPr")),
            None,
        )
        if c_nv_pr is None or c_nv_pr.get("id") != shape_id:
            continue
        blip = next(node for node in picture.iter() if node.tag.endswith("blip"))
        return next(value for key, value in blip.attrib.items() if key.endswith("embed"))
    raise AssertionError(f"picture shape not found: {shape_id}")


def picture_crop_rect(package_bytes: bytes, shape_id: str) -> dict[str, str]:
    root = ET.fromstring(shape_xml(package_bytes, shape_id))
    source_rect = next(
        (node for node in root.iter() if node.tag.endswith("srcRect")),
        None,
    )
    if source_rect is None:
        raise AssertionError(f"picture crop not found: {shape_id}")
    return dict(source_rect.attrib)


def relationship_blob(
    package_bytes: bytes,
    slide_part: str,
    relationship_id: str,
) -> bytes:
    slide_path = Path(slide_part)
    rels_part = f"{slide_path.parent.as_posix()}/_rels/{slide_path.name}.rels"
    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        root = ET.fromstring(package.read(rels_part))
        relationship = next(
            child for child in root if child.get("Id") == relationship_id
        )
        target = relationship.get("Target", "")
        media_part = str((Path(slide_part).parent / target).resolve()).replace("\\", "/")
        media_part = media_part.split("/ppt/", maxsplit=1)[-1]
        return package.read(f"ppt/{media_part}")


def shape_xml(
    package_bytes: bytes,
    shape_id: str,
    slide_part: str = "ppt/slides/slide1.xml",
) -> bytes:
    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        root = ET.fromstring(package.read(slide_part))
    for shape in root.iter():
        if not shape.tag.endswith(("sp", "pic")):
            continue
        c_nv_pr = next(
            (node for node in shape.iter() if node.tag.endswith("cNvPr")),
            None,
        )
        if c_nv_pr is not None and c_nv_pr.get("id") == shape_id:
            return ET.tostring(shape)
    raise AssertionError(f"shape not found: {shape_id}")


def package_entry(package_bytes: bytes, name: str) -> bytes:
    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        return package.read(name)


def zip_entry_hashes(package_bytes: bytes) -> dict[str, str]:
    with zipfile.ZipFile(BytesIO(package_bytes), "r") as package:
        return {
            info.filename: hashlib.sha256(package.read(info.filename)).hexdigest()
            for info in package.infolist()
        }
