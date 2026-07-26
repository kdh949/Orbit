from __future__ import annotations

PML_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
DML_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
ORBIT_OOXML_NS = "urn:orbit:deck:ooxml"
TABLE_GRAPHIC_DATA_URI = (
    "http://schemas.openxmlformats.org/drawingml/2006/table"
)

SLIDE_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
)
SLIDE_LAYOUT_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"
)
SLIDE_MASTER_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster"
)
IMAGE_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
)
THEME_REL_TYPE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
)
VECTOR_IMPORT_FLAG = "ORBIT_PPTX_OOXML_VECTOR_IMPORT"
DEFAULT_TEXT_BODY_HORIZONTAL_INSET_EMU = 91440
DEFAULT_TEXT_BODY_VERTICAL_INSET_EMU = 45720
DEFAULT_PPTX_FONT_FAMILY = "Aptos, Calibri, Arial, sans-serif"
PPTX_FONT_BROWSER_FALLBACK = "PPTX_FONT_BROWSER_FALLBACK"
PPTX_FONT_FAMILY_ALIASES = {
    "pretendard": ("Pretendard", None),
    "pretendard extralight": ("Pretendard", 200),
    "pretendard medium": ("Pretendard", 500),
    "pretendard semibold": ("Pretendard", 600),
    "pretendard extrabold": ("Pretendard", 800),
}
PPTX_BROWSER_AVAILABLE_FONT_FAMILIES = frozenset(
    {"Pretendard", "Arial", "sans-serif", "serif", "monospace"}
)
RICH_TEXT_UNSUPPORTED_HYPERLINK = "PPTX_RICH_TEXT_UNSUPPORTED_HYPERLINK"
TABLE_STRUCTURE_UNSUPPORTED = "PPTX_TABLE_STRUCTURE_UNSUPPORTED"
TABLE_TRACK_MISMATCH = "PPTX_TABLE_TRACK_MISMATCH"
MAX_TABLE_CELL_LOCATORS = 10_000
MAX_MOTION_DIAGNOSTIC_DETAILS = 500
FALLBACK_SCHEME_COLORS = {
    "bg1": "#FFFFFF",
    "tx1": "#111827",
    "bg2": "#FFFFFF",
    "tx2": "#111827",
    "accent1": "#2563EB",
    "accent2": "#7C3AED",
    "accent3": "#0EA5E9",
    "accent4": "#10B981",
    "accent5": "#F59E0B",
    "accent6": "#EF4444",
    "dk1": "#111827",
    "lt1": "#FFFFFF",
    "dk2": "#111827",
    "lt2": "#FFFFFF",
}
SCHEME_COLOR_ALIASES = {
    "bg1": "lt1",
    "tx1": "dk1",
    "bg2": "lt2",
    "tx2": "dk2",
}
