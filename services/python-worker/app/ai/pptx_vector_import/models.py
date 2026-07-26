from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from xml.etree import ElementTree as ET

from app.ai.pptx_design_importer import ImportedDesignAsset

@dataclass(frozen=True)
class OoxmlScale:
    canvas_width: int
    canvas_height: int
    slide_width_emu: int
    slide_height_emu: int

    @property
    def scale_x(self) -> float:
        return self.canvas_width / max(1, self.slide_width_emu)

    @property
    def scale_y(self) -> float:
        return self.canvas_height / max(1, self.slide_height_emu)

    @property
    def average_scale(self) -> float:
        return (self.scale_x + self.scale_y) / 2


@dataclass
class OoxmlImportState:
    assets: list[ImportedDesignAsset]
    asset_ids_by_content_hash: dict[str, str]
    asset_colors: dict[str, str]
    theme_colors: dict[str, str]
    theme_fonts: OoxmlThemeFonts
    theme_styles: OoxmlThemeStyles
    warnings: list[str]
    text_style_context: OoxmlTextStyleContext | None = None
    z_cursor: int = 1

    def next_z(self) -> int:
        value = self.z_cursor
        self.z_cursor += 1
        return value


@dataclass(frozen=True)
class OoxmlThemeStyles:
    line_styles: tuple[ET.Element[Any], ...] = ()
    effect_styles: tuple[ET.Element[Any], ...] = ()


@dataclass(frozen=True)
class OoxmlThemeFonts:
    major_latin: str = "Calibri"
    major_east_asian: str = "Calibri"
    major_complex_script: str = "Calibri"
    minor_latin: str = "Calibri"
    minor_east_asian: str = "Calibri"
    minor_complex_script: str = "Calibri"


@dataclass(frozen=True)
class OoxmlTextStyleContext:
    layout: ET.Element[Any] | None
    master: ET.Element[Any] | None
    theme_fonts: OoxmlThemeFonts


@dataclass(frozen=True)
class OoxmlTextCascade:
    layout_shape: ET.Element[Any] | None
    master_shape: ET.Element[Any] | None
    master_text_style: ET.Element[Any] | None
    theme_fonts: OoxmlThemeFonts
