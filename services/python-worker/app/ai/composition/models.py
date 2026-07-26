from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal

from app.ai.design_program import (
    BackgroundMode,
    CompositionId,
    SlideCompositionDirection,
)

MediaRequirement = Literal["none", "optional", "required"]
Element = dict[str, Any]
Factory = Callable[[SlideCompositionDirection, dict[str, Any], "Style"], tuple[list[Element], str]]

CANVAS_WIDTH = 1920
CANVAS_HEIGHT = 1080
SAFE_X = 120
SAFE_Y = 88
SAFE_WIDTH = 1680
SAFE_HEIGHT = 904
GRID_COLUMN_WIDTH = 118
GRID_GUTTER = 24
GRID_STEP = GRID_COLUMN_WIDTH + GRID_GUTTER


@dataclass(frozen=True)
class CompositionSpec:
    composition_id: CompositionId
    purposes: tuple[str, ...]
    min_items: int
    max_items: int
    media_requirement: MediaRequirement
    variants: tuple[BackgroundMode, ...]
    silhouette: str
    focal_rule: str
    factory: Factory


@dataclass(frozen=True)
class Style:
    background: str
    surface: str
    text: str
    muted_text: str
    focal: str
    secondary: str
    heading_font: str
    body_font: str
    cover_size: int
    title_size: int
    body_size: int
    caption_size: int


@dataclass(frozen=True)
class CompiledComposition:
    elements: list[Element]
    primary_focal_element_id: str
    layout: str
    background_color: str


class CompositionCompileError(RuntimeError):
    pass
