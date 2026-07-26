from __future__ import annotations


from typing import Literal

from xml.etree import ElementTree as ET


PML_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
DML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
IMAGE_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
)
SLIDE_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
)
NOTES_SLIDE_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"
)
NOTES_MASTER_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster"
)
THEME_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
)
SLIDE_LAYOUT_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"
)
SLIDE_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
)
NOTES_SLIDE_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"
)
NOTES_MASTER_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"
)
THEME_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.theme+xml"
P_SP = f"{{{PML_NS}}}sp"
P_PIC = f"{{{PML_NS}}}pic"
P_GRAPHIC_FRAME = f"{{{PML_NS}}}graphicFrame"
A_T = f"{{{DML_NS}}}t"
A_BLIP = f"{{{DML_NS}}}blip"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
TABLE_GRAPHIC_DATA_URI = "http://schemas.openxmlformats.org/drawingml/2006/table"
SUPPORTED_TABLE_PROPS = {
    "rows",
    "columnWidths",
    "rowHeights",
    "borderColor",
    "borderWidth",
}
SUPPORTED_TABLE_CELL_PROPS = {
    "text",
    "fill",
    "textColor",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "align",
    "verticalAlign",
    "borderColor",
    "borderWidth",
    "colSpan",
    "rowSpan",
}
SUPPORTED_TEXT_PROPS = {
    "text",
    "runs",
    "paragraphs",
    "bodyInset",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "italic",
    "underline",
    "color",
    "align",
    "verticalAlign",
    "writingMode",
    "autoFit",
    "fontScale",
    "lineSpaceReduction",
    "lineHeight",
    "bullet",
}
SUPPORTED_TEXT_PARAGRAPH_PROPS = {
    "text",
    "runs",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "italic",
    "underline",
    "color",
    "align",
    "lineHeight",
    "spaceBefore",
    "spaceAfter",
    "indent",
    "bullet",
}
SUPPORTED_TEXT_RUN_PROPS = {
    "text",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "italic",
    "underline",
    "color",
    "baseline",
}
SUPPORTED_TEXT_STYLE_PROPS = {
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "italic",
    "underline",
    "color",
    "baseline",
}
MAX_TEXT_DIFF_MATRIX_CELLS = 250_000
SOURCE_RENDER_MAX_DIMENSION = 1920
SOURCE_RENDER_MAX_BYTES = 16 * 1024 * 1024
SOURCE_RENDER_MAX_TOTAL_BYTES = 256 * 1024 * 1024
SOURCE_RENDER_MAX_PAGES = 1_000
SOURCE_RENDER_DECODE_TIMEOUT_SECONDS = 10.0
ET.register_namespace("p", PML_NS)
ET.register_namespace("a", DML_NS)
ET.register_namespace("r", REL_NS)
PptxImportPreference = Literal["appearance-first", "editability-first"]
PptxOoxmlSyncOperationType = Literal[
    "add_slide",
    "delete_slide",
    "add_element",
    "update_element_frame",
    "update_element_props",
    "delete_element",
    "reorder_slides",
    "update_speaker_notes",
]
PptxOoxmlUnsupportedReasonCode = Literal[
    "ADD_SLIDE_FAILED",
    "ADD_SLIDE_LAYOUT_UNSAFE",
    "ADD_ELEMENT_FAILED",
    "ADD_ELEMENT_TYPE_UNSUPPORTED",
    "AUTHORED_RASTER_FALLBACK_FAILED",
    "CROP_CAPABILITY_UNSAFE",
    "DELETE_SLIDE_FAILED",
    "DELETE_SLIDE_LOCATOR_UNSAFE",
    "DELETE_SLIDE_RELATIONSHIP_UNSAFE",
    "RICH_TEXT_CAPABILITY_UNSAFE",
    "ELEMENT_TYPE_MISMATCH",
    "FRAME_FIELDS_UNSUPPORTED",
    "GROUPED_FRAME_UNSUPPORTED",
    "MOTION_REFERENCE_COVERAGE_UNSAFE",
    "NOTES_BODY_LOCATOR_UNSAFE",
    "NOTES_BODY_NOT_WRITABLE",
    "NOTES_BODY_UPDATE_FAILED",
    "NOTES_MASTER_CAPABILITY_UNSAFE",
    "NOTES_PART_MISSING",
    "OPERATION_TYPE_UNSUPPORTED",
    "PROPS_FIELDS_UNSUPPORTED",
    "PROPS_UPDATE_FAILED",
    "SHAPE_MISSING",
    "SHARED_SHAPE_COHORT_UNSAFE",
    "SLIDE_PART_MISSING",
    "SLIDE_REORDER_LOCATOR_UNSAFE",
    "SLIDE_REORDER_PERMUTATION_INVALID",
    "SLIDE_REORDER_RELATIONSHIP_UNSAFE",
    "LAST_SLIDE_DELETE_FORBIDDEN",
    "SOURCE_MISSING",
    "SOURCE_NOT_WRITABLE",
    "SOURCE_PROVENANCE_UNSAFE",
    "SYNC_RESPONSE_INCOMPLETE",
    "TABLE_CELL_CAPABILITY_UNSAFE",
    "TABLE_STRUCTURE_UNSUPPORTED",
]
PptxOoxmlMotionCoverage = Literal["unknown", "absent", "partial", "complete"]
PptxOoxmlMotionScope = Literal["transition", "animations"]
PptxOoxmlMotionReasonCode = Literal[
    "SLIDE_MOTION_SOURCE_MISSING",
    "SLIDE_MOTION_PAYLOAD_INVALID",
    "SLIDE_TRANSITION_CAPABILITY_UNSAFE",
    "SLIDE_TRANSITION_UNSUPPORTED",
    "SLIDE_ANIMATION_CAPABILITY_UNSAFE",
    "SLIDE_ANIMATION_UNSUPPORTED",
    "SLIDE_ANIMATION_TARGET_UNRESOLVED",
    "SLIDE_MOTION_STRUCTURE_UNSUPPORTED",
]
VISUAL_SHAPE_NAMES = {"cxnSp", "graphicFrame", "grpSp", "pic", "sp"}

__all__ = [
    "A_BLIP",
    "A_T",
    "CONTENT_TYPES_NS",
    "DML_NS",
    "IMAGE_REL_TYPE",
    "MAX_TEXT_DIFF_MATRIX_CELLS",
    "NOTES_MASTER_CONTENT_TYPE",
    "NOTES_MASTER_REL_TYPE",
    "NOTES_SLIDE_CONTENT_TYPE",
    "NOTES_SLIDE_REL_TYPE",
    "PKG_REL_NS",
    "PML_NS",
    "P_GRAPHIC_FRAME",
    "P_PIC",
    "P_SP",
    "PptxImportPreference",
    "PptxOoxmlMotionCoverage",
    "PptxOoxmlMotionReasonCode",
    "PptxOoxmlMotionScope",
    "PptxOoxmlSyncOperationType",
    "PptxOoxmlUnsupportedReasonCode",
    "REL_NS",
    "SLIDE_CONTENT_TYPE",
    "SLIDE_LAYOUT_REL_TYPE",
    "SLIDE_REL_TYPE",
    "SOURCE_RENDER_DECODE_TIMEOUT_SECONDS",
    "SOURCE_RENDER_MAX_BYTES",
    "SOURCE_RENDER_MAX_DIMENSION",
    "SOURCE_RENDER_MAX_PAGES",
    "SOURCE_RENDER_MAX_TOTAL_BYTES",
    "SUPPORTED_TABLE_CELL_PROPS",
    "SUPPORTED_TABLE_PROPS",
    "SUPPORTED_TEXT_PARAGRAPH_PROPS",
    "SUPPORTED_TEXT_PROPS",
    "SUPPORTED_TEXT_RUN_PROPS",
    "SUPPORTED_TEXT_STYLE_PROPS",
    "TABLE_GRAPHIC_DATA_URI",
    "THEME_CONTENT_TYPE",
    "THEME_REL_TYPE",
    "VISUAL_SHAPE_NAMES",
    "XML_SPACE",
]
