from __future__ import annotations

import base64
import json
import re
import textwrap
from copy import deepcopy
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.ai.pptx_design_importer import ImportedDesignBlueprint


Audience = Literal["general", "executive", "technical", "sales"]
Purpose = Literal["inform", "persuade", "teach", "report"]
Tone = Literal["professional", "friendly", "confident", "concise"]
Template = Literal["default", "pitch", "report", "lesson"]
VisualRhythm = Literal["auto", "clean", "editorial", "bold", "technical"]
DensityTarget = Literal["low", "medium", "high"]
MediaPolicy = Literal["avoid", "balanced", "placeholder-ok"]
LayoutDiversity = Literal["stable", "varied"]
ImageReviewMode = Literal["auto", "off"]
DesignProfile = Literal[
    "executive-report",
    "startup-pitch",
    "editorial",
    "technical",
    "training",
]
SlideType = Literal[
    "title",
    "cover",
    "problem",
    "solution",
    "feature-grid",
    "process",
    "data",
    "comparison",
    "architecture",
    "quote",
    "chart",
    "summary",
]
MediaKind = Literal["none", "provided", "generate", "placeholder"]
SlotPreset = Literal[
    "title_center",
    "title_left_visual_right",
    "title_full_bleed_image",
    "big_number_focus",
    "metric_cards",
    "insight_with_evidence",
    "before_after",
    "us_vs_them",
    "criteria_table",
    "quote_center",
    "quote_with_source",
    "quote_left_image_right",
]
DeckLayout = Literal[
    "title",
    "title-content",
    "section",
    "two-column",
    "image-left",
    "image-right",
    "chart-focus",
    "quote",
    "closing",
]
AgentStatus = Literal["succeeded", "failed"]


class GenerateDeckReference(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    file_id: str = Field(alias="fileId", min_length=1)


class GenerateDeckReferenceKeyword(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(min_length=1)


class ReferenceContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    file_id: str = Field(alias="fileId", min_length=1)
    content: str = Field(min_length=1)
    title: str = ""


class GenerateDeckMetadata(BaseModel):
    audience: Audience = "general"
    purpose: Purpose = "inform"
    tone: Tone = "professional"


class DesignOptions(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    profile: DesignProfile | None = None
    style_pack_id: str | None = Field(default=None, alias="stylePackId")
    slide_preset_id: str | None = Field(default=None, alias="slidePresetId")
    visual_rhythm: VisualRhythm = Field(default="auto", alias="visualRhythm")
    density_target: DensityTarget = Field(default="medium", alias="densityTarget")
    media_policy: MediaPolicy = Field(default="balanced", alias="mediaPolicy")
    layout_diversity: LayoutDiversity = Field(
        default="stable",
        alias="layoutDiversity",
    )


class SlideCountRange(BaseModel):
    min: int = Field(default=5, ge=1, le=20)
    max: int = Field(default=8, ge=1, le=20)

    @model_validator(mode="after")
    def validate_order(self) -> SlideCountRange:
        if self.min > self.max:
            raise ValueError("min must be less than or equal to max")
        return self


class GenerateDeckRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(alias="projectId", min_length=1)
    topic: str = Field(min_length=1)
    prompt: str = ""
    design_prompt: str = Field(default="", alias="designPrompt")
    target_duration_minutes: int = Field(
        default=10,
        alias="targetDurationMinutes",
        ge=1,
        le=120,
    )
    slide_count_range: SlideCountRange = Field(
        default_factory=SlideCountRange,
        alias="slideCountRange",
    )
    template: Template = "default"
    metadata: GenerateDeckMetadata = Field(default_factory=GenerateDeckMetadata)
    design: DesignOptions = Field(default_factory=DesignOptions)
    references: list[GenerateDeckReference] = Field(default_factory=list)
    design_references: list[GenerateDeckReference] = Field(
        default_factory=list,
        alias="designReferences",
    )
    reference_keywords: list[GenerateDeckReferenceKeyword] = Field(
        default_factory=list,
        alias="referenceKeywords",
    )
    reference_context: list[ReferenceContext] = Field(
        default_factory=list,
        alias="referenceContext",
    )
    template_blueprint: dict[str, Any] | None = Field(
        default=None,
        alias="templateBlueprint",
    )
    design_blueprint: dict[str, Any] | None = Field(
        default=None,
        alias="designBlueprint",
    )


class RawInput(BaseModel):
    project_id: str
    topic: str
    prompt: str
    design_prompt: str = ""
    target_duration_minutes: int
    slide_count: int
    min_slide_count: int
    max_slide_count: int
    template: Template
    metadata: GenerateDeckMetadata
    design: DesignOptions
    references: list[GenerateDeckReference]
    design_references: list[GenerateDeckReference]
    reference_keywords: list[GenerateDeckReferenceKeyword]
    reference_context: list[ReferenceContext]
    template_blueprint: dict[str, Any] | None = None
    design_blueprint: dict[str, Any] | None = None


class DeckOutline(BaseModel):
    title: str
    slide_titles: list[str]


class SourceEvidence(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    file_id: str = Field(alias="fileId")
    note: str
    confidence: float = 0.7


class VisualIntent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    emphasis: str = ""
    mood: str = ""
    structure: str = ""
    palette_hint: str = Field(default="", alias="paletteHint")
    emphasis_style: str = Field(default="", alias="emphasisStyle")
    composition: str = ""
    decoration_density: str = Field(default="", alias="decorationDensity")
    media_style: str = Field(default="", alias="mediaStyle")
    metric_card_caption: str = Field(default="", alias="metricCardCaption")


class MediaIntent(BaseModel):
    kind: MediaKind = "none"
    prompt: str = ""
    alt: str = ""
    caption: str = ""
    rationale: str = ""
    required: bool = False
    placement: str = "auto"
    src: str = ""


class GeneratedSlideContent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1)
    message: str = Field(min_length=1)
    speaker_notes: str = Field(alias="speakerNotes", min_length=1)
    keywords: list[str] = Field(default_factory=list)
    slide_type: SlideType | None = Field(default=None, alias="slideType")
    layout_variant: str = Field(default="", alias="layoutVariant")
    slot_preset: SlotPreset | None = Field(default=None, alias="slotPreset")
    visual_intent: VisualIntent = Field(
        default_factory=VisualIntent,
        alias="visualIntent",
    )
    media_intent: MediaIntent = Field(
        default_factory=MediaIntent,
        alias="mediaIntent",
    )


class GeneratedDeckContentPlan(BaseModel):
    title: str = Field(min_length=1)
    slides: list[GeneratedSlideContent] = Field(min_length=1)


class SlidePlan(BaseModel):
    order: int
    slide_type: SlideType
    title: str
    message: str
    speaker_notes: str
    keywords: list[str]
    evidence: list[SourceEvidence]
    layout_variant: str = ""
    slot_preset: SlotPreset | None = None
    requested_slot_preset: SlotPreset | None = None
    visual_intent: VisualIntent = Field(default_factory=VisualIntent)
    media_intent: MediaIntent = Field(default_factory=MediaIntent)


class ElementIntent(BaseModel):
    role: Literal[
        "background",
        "title",
        "subtitle",
        "body",
        "highlight",
        "footer",
        "chart",
    ]
    text: str = ""


class VisualPlan(BaseModel):
    slide_type: SlideType
    layout: DeckLayout
    layout_variant: str = ""
    slot_preset: SlotPreset
    visual_intent: VisualIntent = Field(default_factory=VisualIntent)
    media_intent: MediaIntent = Field(default_factory=MediaIntent)
    intents: list[ElementIntent]


class LayoutSlot(BaseModel):
    role: str
    x: int
    y: int
    width: int
    height: int
    z_index: int


class LayoutPlan(BaseModel):
    slots: list[LayoutSlot]


class ValidationIssue(BaseModel):
    scope: Literal["deck", "slide", "element"]
    path: str = ""
    message: str


class ValidationResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    passed: bool
    layout_issues: list[ValidationIssue] = Field(
        default_factory=list,
        alias="layoutIssues",
    )
    content_issues: list[ValidationIssue] = Field(
        default_factory=list,
        alias="contentIssues",
    )
    design_issues: list[ValidationIssue] = Field(
        default_factory=list,
        alias="designIssues",
    )
    presentation_issues: list[ValidationIssue] = Field(
        default_factory=list,
        alias="presentationIssues",
    )


class TemplateSelectionItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    generated_order: int = Field(alias="generatedOrder", ge=1)
    source_slide_index: int = Field(alias="sourceSlideIndex", ge=1)
    selection_reason: str = Field(default="", alias="selectionReason")


class GenerateDeckResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    deck: dict[str, Any]
    template_selection: list[TemplateSelectionItem] = Field(
        default_factory=list,
        alias="templateSelection",
    )
    warnings: list[str] = Field(default_factory=list)
    validation: ValidationResult


class SlideTextOverlapReview(BaseModel):
    unreadable: bool
    reason: str = ""


class AgentOutput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: AgentStatus
    summary: str
    artifacts: dict[str, Any] = Field(default_factory=dict)
    next_actions: list[str] = Field(default_factory=list, alias="nextActions")
    warnings: list[str] = Field(default_factory=list)


class DeckContentGenerationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Canvas:
    width: int = 1920
    height: int = 1080
    safe_x: int = 120
    safe_y: int = 88
    safe_width: int = 1680
    safe_height: int = 904


@dataclass(frozen=True)
class PresetConfig:
    variant: str
    layout: DeckLayout
    slots: tuple[LayoutSlot, ...]


@dataclass(frozen=True)
class LayoutCandidate:
    slot_preset: SlotPreset
    score: int


@dataclass(frozen=True)
class TextOverlapCandidate:
    slide_index: int
    slide_id: str
    first_element_index: int
    second_element_index: int
    first_element_id: str
    second_element_id: str
    overlap_ratio: float


DESIGN_LIBRARY_DIR = Path(__file__).with_name("design_library")


def load_json_registry(directory: Path) -> dict[str, dict[str, Any]]:
    if not directory.exists():
        return {}
    registry: dict[str, dict[str, Any]] = {}
    for path in sorted(directory.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        registry[str(payload["id"])] = payload
    return registry


def load_icon_map(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {str(key): str(value) for key, value in payload.items()}


CANVAS = Canvas()
TEXT_OVERLAP_WARNING_RATIO = 0.15
MAX_IMAGE_REVIEW_SLIDES = 3
STYLE_PACK_REGISTRY = load_json_registry(DESIGN_LIBRARY_DIR / "style-packs")
SLIDE_PRESET_REGISTRY = load_json_registry(DESIGN_LIBRARY_DIR / "slide-presets")
ICON_MAP = load_icon_map(DESIGN_LIBRARY_DIR / "icon-map.json")
SIMPLE_BASIC_STYLE_PACK_ID = "simple-basic"
PRESENTATION_DOCUMENT_STYLE_PACK_ID = "presentation-document"
SUBMISSION_DOCUMENT_STYLE_PACK_ID = "submission-document"
DOCUMENT_STYLE_PACK_IDS = (
    SIMPLE_BASIC_STYLE_PACK_ID,
    PRESENTATION_DOCUMENT_STYLE_PACK_ID,
    SUBMISSION_DOCUMENT_STYLE_PACK_ID,
)
SIMPLE_BASIC_STYLE_KEYWORDS = (
    "simple basic",
    "simple-basic",
    "심플 베이직",
    "심플",
    "베이직",
    "깔끔",
    "제출용",
    "보고용",
    "발표용",
)
PRESENTATION_MODE_KEYWORDS = ("발표용", "presentation", "presenter")
REPORT_MODE_KEYWORDS = ("제출용", "보고용", "report", "submission")
PRESENTATION_DOCUMENT_STYLE_KEYWORDS = (
    "presentation document",
    "presentation-document",
    "발표용 문서",
    "발표용 문서 스타일",
)
SUBMISSION_DOCUMENT_STYLE_KEYWORDS = (
    "submission document",
    "submission-document",
    "report document",
    "제출용 문서",
    "제출용 문서 스타일",
    "보고용 문서",
    "보고용 문서 스타일",
)
STYLE_PACK_LLM_PROMPTS: dict[str, str] = {
    SIMPLE_BASIC_STYLE_PACK_ID: """
# 심플 베이직 스타일

## 공통 원칙

[시각적 위계]
- 슬라이드당 하나의 핵심 메시지만 담을 것
- 제목 > 소제목 > 본문 순으로 크기/굵기 차이를 명확히 할 것
- 폰트는 최대 2종류만 사용할 것
- 여백을 충분히 확보하여 요소들이 숨쉴 공간을 줄 것

[그리드와 정렬]
- 모든 텍스트와 이미지는 일관된 그리드에 정렬할 것
- 슬라이드 가장자리 여백을 일정하게 유지할 것
- 요소 간 간격은 8의 배수 단위로 규칙적으로 적용할 것
- 같은 역할의 요소는 슬라이드마다 동일한 위치에 배치할 것

[콘텐츠 밀도]
- 텍스트는 최대한 간결하게 줄일 것
- 슬라이드 1장의 메시지는 한 문장으로 요약될 수 있어야 함

[일관성]
- 제목, 부제목은 매 페이지마다 동일한 위치와 크기의 서체 사용
- 1페이지는 서브 텍스트 1줄 이상 금지, 헤드라인과 키비주얼만으로 구성

## 스타일 프롬프트

[Context]
깔끔하고 베이직하지만 비어 보이지 않는 슬라이드입니다.
장식 없이도 완성도 있어 보이는 것이 목표입니다.

[Action]

— 배경 —
- 배경은 흰색(#FFFFFF) 또는 연한 회색(#F5F5F5) 단색
- 상단 또는 하단에 포인트 컬러 얇은 띠를 넣을 것
- 좌측 또는 우측 여백에 연한 수직선 하나로 콘텐츠 영역을 구분

— 레이아웃 —
- 슬라이드 가장자리 여백은 전체 너비의 8~10%
- 좌측 상단에 섹션 번호 또는 카테고리명을 포인트 컬러 소형 텍스트로 배치
- 제목은 그 아래 Bold, 크게 좌측 정렬
- 제목과 본문 사이에 포인트 컬러 짧은 가로선 배치
- 콘텐츠는 슬라이드 전체 면적의 75% 이상 채울 것
- 콘텐츠 블록 간 간격은 일정하게 유지

— 타이포그래피 —
- 제목은 Bold 또는 ExtraBold
- 본문은 Regular
- 핵심 키워드나 수치는 포인트 컬러로 강조
- 텍스트는 전체 좌측 정렬

— 컬러 —
- 포인트 컬러는 1~2개만 사용
- 포인트 컬러는 섹션 번호, 구분선, 핵심 강조에만 적용
- 그 외 텍스트는 검정(#1A1A1A) 또는 짙은 회색(#333333)

— 밀도 —
- 텍스트만 있는 슬라이드는 배경 컬러 블록 또는 연한 회색 박스로 콘텐츠를 감쌀 것
- 항목이 여러 개일 경우 번호 뱃지를 붙여 시각적 리듬을 만들 것
- 데이터나 수치가 있을 경우 표 또는 강조 박스로 구조화

[Result]
슬라이드가 단순하지만 비어 보이지 않아야 합니다.
포인트 컬러 띠, 구분선, 번호 뱃지처럼 작은 요소들이 공간을 채우면서 완성도를 높여야 합니다.
처음 보는 사람도 "잘 만든 자료"라는 인상을 받아야 하며, 허전해 보이는 곳이 없어야 합니다.
""".strip(),
    SUBMISSION_DOCUMENT_STYLE_PACK_ID: """
# 제출용 문서 스타일

## 공통 원칙

[시각적 위계]
- 슬라이드당 하나의 핵심 메시지만 담을 것
- 제목 > 소제목 > 본문 순으로 크기/굵기 차이를 명확히 할 것
- 폰트는 최대 2종류만 사용할 것
- 여백을 충분히 확보하여 요소들이 숨쉴 공간을 줄 것

[그리드와 정렬]
- 모든 텍스트와 이미지는 일관된 그리드에 정렬할 것
- 슬라이드 가장자리 여백을 일정하게 유지할 것
- 요소 간 간격은 8의 배수 단위로 규칙적으로 적용할 것
- 같은 역할의 요소는 슬라이드마다 동일한 위치에 배치할 것

[콘텐츠 밀도]
- 발표용보다 정보 밀도를 높일 것
- 텍스트는 충분한 맥락과 근거를 포함하되, 문단이 너무 길어지지 않게 정리할 것
- 표, 차트, 요약 박스를 활용해 읽기 쉽게 구조화할 것

[일관성]
- 제목, 부제목은 매 페이지마다 동일한 위치와 크기의 서체 사용
- 섹션 간 구분을 명확히 할 것

## 용도

[보고용]
이 PPT는 상대방이 혼자 읽는 자료입니다.

## 디자인 원칙

- 발표자 없이도 내용이 완전히 이해되어야 함
- 텍스트로 맥락과 근거를 충분히 설명
- 데이터/수치는 표나 차트로 구조화
- 논리 흐름이 한눈에 보이는 레이아웃 사용
- 정보 밀도를 높이되 가독성 유지
- 차트/표 적극 활용
- 섹션 간 구분 명확하게
""".strip(),
    PRESENTATION_DOCUMENT_STYLE_PACK_ID: """
# 발표용 문서 스타일

## 공통 원칙

[시각적 위계]
- 슬라이드당 하나의 핵심 메시지만 담을 것
- 제목 > 소제목 > 본문 순으로 크기/굵기 차이를 명확히 할 것
- 폰트는 최대 2종류만 사용할 것
- 여백을 충분히 확보하여 요소들이 숨쉴 공간을 줄 것

[그리드와 정렬]
- 모든 텍스트와 이미지는 일관된 그리드에 정렬할 것
- 슬라이드 가장자리 여백을 일정하게 유지할 것
- 요소 간 간격은 8의 배수 단위로 규칙적으로 적용할 것
- 같은 역할의 요소는 슬라이드마다 동일한 위치에 배치할 것

[콘텐츠 밀도]
- 텍스트는 최대한 간결하게 줄일 것
- 슬라이드 1장의 메시지는 한 문장으로 요약될 수 있어야 함
- 발표자가 말로 설명할 내용을 슬라이드에 과도하게 넣지 말 것

[일관성]
- 제목, 부제목은 매 페이지마다 동일한 위치와 크기의 서체 사용
- 1페이지는 서브 텍스트 1줄 이상 금지, 헤드라인과 키비주얼만으로 구성

## 용도

[발표용]
이 PPT는 발표자가 직접 말로 설명하는 자료입니다.

## 디자인 원칙

- 텍스트는 키워드/짧은 문장 위주로 최소화
- 비주얼(이미지, 아이콘, 도형)로 내용을 대신 표현
- 청중 시선을 끄는 강한 타이포그래피 사용
- 핵심 수치나 단어는 크게 강조
- 불릿 리스트 지양
- 비주얼 중심 구성
""".strip(),
}
SLIDE_TYPES: tuple[SlideType, ...] = (
    "title",
    "cover",
    "problem",
    "solution",
    "feature-grid",
    "process",
    "data",
    "comparison",
    "architecture",
    "quote",
    "chart",
    "summary",
)
SLIDE_TYPE_SEQUENCE: list[SlideType] = [
    "cover",
    "problem",
    "solution",
    "feature-grid",
    "process",
    "data",
    "comparison",
    "architecture",
    "quote",
    "chart",
    "summary",
]
LAYOUT_BY_SLIDE_TYPE: dict[SlideType, DeckLayout] = {
    "title": "title",
    "cover": "title",
    "problem": "title-content",
    "solution": "two-column",
    "feature-grid": "two-column",
    "process": "title-content",
    "data": "title-content",
    "comparison": "two-column",
    "architecture": "image-right",
    "quote": "quote",
    "chart": "chart-focus",
    "summary": "closing",
}
PRESET_BY_SLIDE_TYPE: dict[SlideType, SlotPreset] = {
    "title": "title_center",
    "cover": "title_center",
    "problem": "insight_with_evidence",
    "solution": "title_left_visual_right",
    "feature-grid": "metric_cards",
    "process": "insight_with_evidence",
    "data": "big_number_focus",
    "comparison": "before_after",
    "architecture": "title_left_visual_right",
    "quote": "quote_center",
    "chart": "insight_with_evidence",
    "summary": "insight_with_evidence",
}
LAYOUT_VARIANTS = {"title", "data", "comparison", "quote"}
PRESET_REGISTRY: dict[SlotPreset, PresetConfig] = {
    "title_center": PresetConfig(
        variant="title",
        layout="title",
        slots=(
            LayoutSlot(
                role="background",
                x=0,
                y=0,
                width=CANVAS.width,
                height=CANVAS.height,
                z_index=0,
            ),
            LayoutSlot(
                role="title",
                x=CANVAS.safe_x,
                y=260,
                width=CANVAS.safe_width,
                height=150,
                z_index=3,
            ),
            LayoutSlot(
                role="body",
                x=CANVAS.safe_x + 140,
                y=448,
                width=CANVAS.safe_width - 280,
                height=220,
                z_index=3,
            ),
            LayoutSlot(
                role="footer",
                x=CANVAS.safe_x,
                y=980,
                width=CANVAS.safe_width,
                height=36,
                z_index=5,
            ),
        ),
    ),
    "title_left_visual_right": PresetConfig(
        variant="title",
        layout="image-right",
        slots=(
            LayoutSlot(
                role="background",
                x=0,
                y=0,
                width=CANVAS.width,
                height=CANVAS.height,
                z_index=0,
            ),
            LayoutSlot(
                role="title",
                x=CANVAS.safe_x,
                y=150,
                width=760,
                height=150,
                z_index=3,
            ),
            LayoutSlot(
                role="body",
                x=CANVAS.safe_x,
                y=330,
                width=720,
                height=360,
                z_index=3,
            ),
            LayoutSlot(role="media", x=980, y=180, width=700, height=520, z_index=3),
            LayoutSlot(
                role="footer",
                x=CANVAS.safe_x,
                y=980,
                width=CANVAS.safe_width,
                height=36,
                z_index=5,
            ),
        ),
    ),
    "title_full_bleed_image": PresetConfig(
        variant="title",
        layout="title",
        slots=(
            LayoutSlot(
                role="background",
                x=0,
                y=0,
                width=CANVAS.width,
                height=CANVAS.height,
                z_index=0,
            ),
            LayoutSlot(role="media", x=0, y=0, width=CANVAS.width, height=CANVAS.height, z_index=1),
            LayoutSlot(
                role="title",
                x=CANVAS.safe_x,
                y=610,
                width=CANVAS.safe_width,
                height=140,
                z_index=4,
            ),
            LayoutSlot(
                role="body",
                x=CANVAS.safe_x,
                y=770,
                width=1080,
                height=150,
                z_index=4,
            ),
            LayoutSlot(
                role="footer",
                x=CANVAS.safe_x,
                y=980,
                width=CANVAS.safe_width,
                height=36,
                z_index=5,
            ),
        ),
    ),
    "big_number_focus": PresetConfig(
        variant="data",
        layout="title-content",
        slots=(
            LayoutSlot(
                role="background",
                x=0,
                y=0,
                width=CANVAS.width,
                height=CANVAS.height,
                z_index=0,
            ),
            LayoutSlot(
                role="title",
                x=CANVAS.safe_x,
                y=CANVAS.safe_y,
                width=CANVAS.safe_width,
                height=128,
                z_index=3,
            ),
            LayoutSlot(
                role="body",
                x=CANVAS.safe_x,
                y=288,
                width=900,
                height=320,
                z_index=3,
            ),
            LayoutSlot(role="highlight", x=1080, y=270, width=560, height=360, z_index=3),
            LayoutSlot(
                role="footer",
                x=CANVAS.safe_x,
                y=980,
                width=CANVAS.safe_width,
                height=36,
                z_index=5,
            ),
        ),
    ),
    "metric_cards": PresetConfig(
        variant="data",
        layout="two-column",
        slots=(
            LayoutSlot(
                role="background",
                x=0,
                y=0,
                width=CANVAS.width,
                height=CANVAS.height,
                z_index=0,
            ),
            LayoutSlot(
                role="title",
                x=CANVAS.safe_x,
                y=CANVAS.safe_y,
                width=CANVAS.safe_width,
                height=128,
                z_index=3,
            ),
            LayoutSlot(role="body", x=CANVAS.safe_x, y=270, width=760, height=430, z_index=3),
            LayoutSlot(role="highlight", x=960, y=270, width=660, height=430, z_index=3),
            LayoutSlot(
                role="footer",
                x=CANVAS.safe_x,
                y=980,
                width=CANVAS.safe_width,
                height=36,
                z_index=5,
            ),
        ),
    ),
    "insight_with_evidence": PresetConfig(
        variant="data",
        layout="title-content",
        slots=(
            LayoutSlot(
                role="background",
                x=0,
                y=0,
                width=CANVAS.width,
                height=CANVAS.height,
                z_index=0,
            ),
            LayoutSlot(
                role="title",
                x=CANVAS.safe_x,
                y=CANVAS.safe_y,
                width=CANVAS.safe_width,
                height=128,
                z_index=3,
            ),
            LayoutSlot(
                role="body",
                x=CANVAS.safe_x,
                y=268,
                width=CANVAS.safe_width,
                height=300,
                z_index=3,
            ),
            LayoutSlot(role="highlight", x=CANVAS.safe_x, y=650, width=980, height=160, z_index=3),
            LayoutSlot(
                role="footer",
                x=CANVAS.safe_x,
                y=980,
                width=CANVAS.safe_width,
                height=36,
                z_index=5,
            ),
        ),
    ),
    "before_after": PresetConfig(
        variant="comparison",
        layout="two-column",
        slots=(
            LayoutSlot(
                role="background",
                x=0,
                y=0,
                width=CANVAS.width,
                height=CANVAS.height,
                z_index=0,
            ),
            LayoutSlot(
                role="title",
                x=CANVAS.safe_x,
                y=CANVAS.safe_y,
                width=CANVAS.safe_width,
                height=128,
                z_index=3,
            ),
            LayoutSlot(role="body", x=CANVAS.safe_x, y=280, width=760, height=420, z_index=3),
            LayoutSlot(role="highlight", x=1040, y=280, width=640, height=420, z_index=3),
            LayoutSlot(
                role="footer",
                x=CANVAS.safe_x,
                y=980,
                width=CANVAS.safe_width,
                height=36,
                z_index=5,
            ),
        ),
    ),
    "us_vs_them": PresetConfig(
        variant="comparison",
        layout="two-column",
        slots=(
            LayoutSlot(role="background", x=0, y=0, width=CANVAS.width, height=CANVAS.height, z_index=0),
            LayoutSlot(role="title", x=CANVAS.safe_x, y=CANVAS.safe_y, width=CANVAS.safe_width, height=128, z_index=3),
            LayoutSlot(role="body", x=CANVAS.safe_x, y=280, width=760, height=420, z_index=3),
            LayoutSlot(role="highlight", x=1040, y=280, width=640, height=420, z_index=3),
            LayoutSlot(role="footer", x=CANVAS.safe_x, y=980, width=CANVAS.safe_width, height=36, z_index=5),
        ),
    ),
    "criteria_table": PresetConfig(
        variant="comparison",
        layout="title-content",
        slots=(
            LayoutSlot(role="background", x=0, y=0, width=CANVAS.width, height=CANVAS.height, z_index=0),
            LayoutSlot(role="title", x=CANVAS.safe_x, y=CANVAS.safe_y, width=CANVAS.safe_width, height=128, z_index=3),
            LayoutSlot(role="body", x=CANVAS.safe_x, y=260, width=CANVAS.safe_width, height=420, z_index=3),
            LayoutSlot(role="highlight", x=CANVAS.safe_x, y=720, width=CANVAS.safe_width, height=120, z_index=3),
            LayoutSlot(role="footer", x=CANVAS.safe_x, y=980, width=CANVAS.safe_width, height=36, z_index=5),
        ),
    ),
    "quote_center": PresetConfig(
        variant="quote",
        layout="quote",
        slots=(
            LayoutSlot(role="background", x=0, y=0, width=CANVAS.width, height=CANVAS.height, z_index=0),
            LayoutSlot(role="title", x=CANVAS.safe_x, y=160, width=CANVAS.safe_width, height=120, z_index=3),
            LayoutSlot(role="body", x=300, y=340, width=1320, height=320, z_index=3),
            LayoutSlot(role="footer", x=CANVAS.safe_x, y=980, width=CANVAS.safe_width, height=36, z_index=5),
        ),
    ),
    "quote_with_source": PresetConfig(
        variant="quote",
        layout="quote",
        slots=(
            LayoutSlot(role="background", x=0, y=0, width=CANVAS.width, height=CANVAS.height, z_index=0),
            LayoutSlot(role="title", x=CANVAS.safe_x, y=CANVAS.safe_y, width=CANVAS.safe_width, height=120, z_index=3),
            LayoutSlot(role="body", x=CANVAS.safe_x + 160, y=300, width=1260, height=320, z_index=3),
            LayoutSlot(role="highlight", x=CANVAS.safe_x + 160, y=670, width=820, height=110, z_index=3),
            LayoutSlot(role="footer", x=CANVAS.safe_x, y=980, width=CANVAS.safe_width, height=36, z_index=5),
        ),
    ),
    "quote_left_image_right": PresetConfig(
        variant="quote",
        layout="image-right",
        slots=(
            LayoutSlot(role="background", x=0, y=0, width=CANVAS.width, height=CANVAS.height, z_index=0),
            LayoutSlot(role="title", x=CANVAS.safe_x, y=CANVAS.safe_y, width=760, height=120, z_index=3),
            LayoutSlot(role="body", x=CANVAS.safe_x, y=300, width=720, height=340, z_index=3),
            LayoutSlot(role="media", x=980, y=180, width=700, height=520, z_index=3),
            LayoutSlot(role="footer", x=CANVAS.safe_x, y=980, width=CANVAS.safe_width, height=36, z_index=5),
        ),
    ),
}

PRESET_ORDER: dict[SlotPreset, int] = {
    slot_preset: index for index, slot_preset in enumerate(PRESET_REGISTRY)
}
PRESET_DENSITY: dict[SlotPreset, DensityTarget] = {
    "title_center": "low",
    "title_left_visual_right": "medium",
    "title_full_bleed_image": "low",
    "big_number_focus": "medium",
    "metric_cards": "high",
    "insight_with_evidence": "medium",
    "before_after": "medium",
    "us_vs_them": "high",
    "criteria_table": "high",
    "quote_center": "low",
    "quote_with_source": "medium",
    "quote_left_image_right": "medium",
}
DESIGN_PROFILE_SLOT_BONUS: dict[DesignProfile, set[SlotPreset]] = {
    "executive-report": {"insight_with_evidence", "criteria_table", "big_number_focus"},
    "startup-pitch": {"title_left_visual_right", "big_number_focus", "before_after"},
    "editorial": {"quote_center", "quote_with_source", "insight_with_evidence"},
    "technical": {"criteria_table", "insight_with_evidence", "title_left_visual_right"},
    "training": {"insight_with_evidence", "before_after", "criteria_table"},
}
STYLE_PACK_SLOT_PRESET_PREFERENCES: dict[str, dict[str, tuple[SlotPreset, ...]]] = {
    SIMPLE_BASIC_STYLE_PACK_ID: {
        "title": ("title_center", "insight_with_evidence"),
        "cover": ("title_center", "insight_with_evidence"),
        "problem": ("insight_with_evidence", "before_after"),
        "solution": ("insight_with_evidence", "before_after"),
        "feature-grid": ("metric_cards", "insight_with_evidence"),
        "process": ("insight_with_evidence", "before_after"),
        "data": ("big_number_focus", "insight_with_evidence"),
        "comparison": ("before_after", "criteria_table"),
        "architecture": ("insight_with_evidence", "criteria_table"),
        "quote": ("quote_with_source", "quote_center"),
        "summary": ("insight_with_evidence", "title_center"),
        "*": ("insight_with_evidence",),
    },
    PRESENTATION_DOCUMENT_STYLE_PACK_ID: {
        "title": ("title_center", "quote_center"),
        "cover": ("title_center", "quote_center"),
        "problem": ("title_center", "insight_with_evidence"),
        "solution": ("title_center", "insight_with_evidence"),
        "feature-grid": ("big_number_focus", "title_center", "insight_with_evidence"),
        "process": ("before_after", "title_center", "insight_with_evidence"),
        "data": ("big_number_focus", "title_center"),
        "comparison": ("before_after", "title_center"),
        "architecture": ("title_center", "insight_with_evidence"),
        "quote": ("quote_center", "quote_with_source"),
        "summary": ("quote_center", "title_center"),
        "*": ("title_center", "insight_with_evidence"),
    },
    SUBMISSION_DOCUMENT_STYLE_PACK_ID: {
        "title": ("criteria_table", "insight_with_evidence"),
        "cover": ("criteria_table", "insight_with_evidence"),
        "problem": ("criteria_table", "metric_cards"),
        "solution": ("criteria_table", "metric_cards"),
        "feature-grid": ("metric_cards", "criteria_table"),
        "process": ("criteria_table", "metric_cards"),
        "data": ("metric_cards", "criteria_table"),
        "comparison": ("criteria_table", "us_vs_them"),
        "architecture": ("criteria_table", "metric_cards"),
        "quote": ("quote_with_source", "criteria_table"),
        "summary": ("criteria_table", "metric_cards"),
        "*": ("criteria_table", "metric_cards", "insight_with_evidence"),
    },
}

STYLE_PROFILE_REGISTRY: dict[str, dict[str, Any]] = {
    "game-ink-neon": {
        "name": "game-ink-neon",
        "headingFontFamily": "Montserrat",
        "bodyFontFamily": "Inter",
        "background": "#07111f",
        "surface": "#101827",
        "text": "#f8fafc",
        "accent": "#00e5ff",
        "secondary": "#b6ff00",
        "muted": "#0b1020",
        "border": "#ff3df2",
        "titleSize": 68,
        "headingSize": 44,
        "bodySize": 28,
        "captionSize": 17,
    },
    "startup-clean": {
        "name": "startup-clean",
        "headingFontFamily": "Inter",
        "bodyFontFamily": "Inter",
        "background": "#ffffff",
        "surface": "#ffffff",
        "text": "#111827",
        "accent": "#2563eb",
        "secondary": "#10b981",
        "muted": "#f8fafc",
        "border": "#d8dee9",
        "titleSize": 60,
        "headingSize": 42,
        "bodySize": 26,
        "captionSize": 18,
    },
    "academic-report": {
        "name": "academic-report",
        "headingFontFamily": "IBM Plex Sans",
        "bodyFontFamily": "Inter",
        "background": "#f8fafc",
        "surface": "#ffffff",
        "text": "#111827",
        "accent": "#0f766e",
        "secondary": "#7c3aed",
        "muted": "#eef2f7",
        "border": "#cbd5e1",
        "titleSize": 62,
        "headingSize": 42,
        "bodySize": 26,
        "captionSize": 17,
    },
    "dark-cyber": {
        "name": "dark-cyber",
        "headingFontFamily": "Montserrat",
        "bodyFontFamily": "Inter",
        "background": "#0b1120",
        "surface": "#111827",
        "text": "#f8fafc",
        "accent": "#38bdf8",
        "secondary": "#a78bfa",
        "muted": "#020617",
        "border": "#334155",
        "titleSize": 66,
        "headingSize": 44,
        "bodySize": 27,
        "captionSize": 17,
    },
    "warm-editorial": {
        "name": "warm-editorial",
        "headingFontFamily": "IBM Plex Serif",
        "bodyFontFamily": "Inter",
        "background": "#fff7ed",
        "surface": "#ffffff",
        "text": "#1f2937",
        "accent": "#be123c",
        "secondary": "#0f766e",
        "muted": "#ffedd5",
        "border": "#fed7aa",
        "titleSize": 62,
        "headingSize": 42,
        "bodySize": 27,
        "captionSize": 17,
    },
    "kids-education": {
        "name": "kids-education",
        "headingFontFamily": "Nunito",
        "bodyFontFamily": "Nunito",
        "background": "#f0f9ff",
        "surface": "#ffffff",
        "text": "#172554",
        "accent": "#f97316",
        "secondary": "#22c55e",
        "muted": "#dcfce7",
        "border": "#bae6fd",
        "titleSize": 64,
        "headingSize": 42,
        "bodySize": 28,
        "captionSize": 18,
    },
    "modern-lilac": {
        "name": "modern-lilac",
        "headingFontFamily": "Montserrat",
        "bodyFontFamily": "Inter",
        "background": "#f8fafc",
        "surface": "#ffffff",
        "text": "#111827",
        "accent": "#7c3aed",
        "secondary": "#0f766e",
        "muted": "#f5f3ff",
        "border": "#ddd6fe",
        "titleSize": 66,
        "headingSize": 44,
        "bodySize": 27,
        "captionSize": 17,
    },
    "premium-dark": {
        "name": "premium-dark",
        "headingFontFamily": "Montserrat",
        "bodyFontFamily": "Inter",
        "background": "#0f172a",
        "surface": "#111827",
        "text": "#f8fafc",
        "accent": "#fbbf24",
        "secondary": "#38bdf8",
        "muted": "#1e293b",
        "border": "#475569",
        "titleSize": 66,
        "headingSize": 44,
        "bodySize": 27,
        "captionSize": 17,
    },
}

SEMANTIC_PALETTE_PROFILES: dict[str, dict[str, Any]] = {
    "monochrome": {
        "keywords": [
            "모노톤",
            "블랙앤화이트",
            "흑백",
            "monotone",
            "monochrome",
            "black and white",
        ],
        "background": "#ffffff",
        "surface": "#ffffff",
        "text": "#111827",
        "accent": "#111827",
        "secondary": "#6b7280",
        "muted": "#f3f4f6",
        "border": "#d1d5db",
    },
    "ocean-blue": {
        "keywords": [
            "바다",
            "오션",
            "해변",
            "파도",
            "해양",
            "ocean",
            "sea",
            "beach",
            "wave",
            "marine",
        ],
        "background": "#f7fbff",
        "surface": "#ffffff",
        "text": "#0f172a",
        "accent": "#2563eb",
        "secondary": "#0891b2",
        "muted": "#e0f2fe",
        "border": "#bae6fd",
    },
    "pastel": {
        "keywords": [
            "파스텔",
            "부드러운",
            "소프트",
            "pastel",
            "soft",
            "gentle",
        ],
        "background": "#fff7ed",
        "surface": "#ffffff",
        "text": "#1f2937",
        "accent": "#ec4899",
        "secondary": "#38bdf8",
        "muted": "#fce7f3",
        "border": "#fbcfe8",
    },
    "premium-dark": {
        "keywords": [
            "고급",
            "프리미엄",
            "럭셔리",
            "premium",
            "luxury",
            "high-end",
        ],
        "background": "#0f172a",
        "surface": "#111827",
        "text": "#f8fafc",
        "accent": "#fbbf24",
        "secondary": "#38bdf8",
        "muted": "#1e293b",
        "border": "#475569",
    },
}

EXPLICIT_COLOR_NAME_MAP = {
    "흰색": "#ffffff",
    "화이트": "#ffffff",
    "white": "#ffffff",
    "노란색": "#facc15",
    "노랑": "#facc15",
    "옐로우": "#facc15",
    "yellow": "#facc15",
    "검정": "#111827",
    "black": "#111827",
    "회색": "#6b7280",
    "gray": "#6b7280",
    "파랑": "#2563eb",
    "blue": "#2563eb",
    "빨강": "#dc2626",
    "red": "#dc2626",
    "초록": "#16a34a",
    "green": "#16a34a",
    "보라": "#7c3aed",
    "purple": "#7c3aed",
    "주황": "#f97316",
    "orange": "#f97316",
    "분홍": "#ec4899",
    "pink": "#ec4899",
    "남색": "#1e3a8a",
    "navy": "#1e3a8a",
}
EXPLICIT_COLOR_RE = re.compile(
    r"#[0-9a-fA-F]{6}|흰색|화이트|노란색|노랑|옐로우|검정|"
    r"회색|파랑|빨강|초록|보라|주황|분홍|남색|"
    r"(?<![a-z])(?:white|yellow|black|gray|blue|red|green|"
    r"purple|orange|pink|navy)(?![a-z])",
    re.IGNORECASE,
)
DESIGN_PROMPT_HINT_RE = re.compile(
    r"색감|디자인|스타일|느낌|테마|팔레트|픽셀|고전|"
    r"(?<![a-z])(?:design|style|theme|palette|color|colors|pixel|retro|"
    r"classic|visual|look|mood)(?![a-z])",
    re.IGNORECASE,
)
THEME_TOKEN_RE = re.compile(
    r"(?<![a-z])"
    r"(background|text|accent|primary|secondary|surface|muted|border)"
    r"\s*:\s*(#[0-9a-fA-F]{6})(?![0-9a-fA-F])",
    re.IGNORECASE,
)
THEME_TOKEN_ANY_RE = re.compile(
    r"(?<![a-z])(?:[a-z][a-z0-9_-]*)\s*:\s*\S+",
    re.IGNORECASE,
)
NEUTRAL_COLORS = {"#ffffff", "#111827", "#000000", "#6b7280"}

DECK_CONTENT_INSTRUCTIONS = """
You create Korean presentation slide content for ORBIT.
Return only JSON that matches the requested schema.

Rules:
- Ground the deck in the topic, user prompt, reference keywords, and reference excerpts.
- Design instructions describe visual style only.
- Do not write design instructions into slide title, message, or speakerNotes.
- Reflect design instructions through visualIntent.paletteHint, emphasisStyle,
  composition, decorationDensity, and mediaStyle.
- The selected preset style prompt is a design and document-purpose guide, not
  visible slide content. Do not quote or summarize it in slide text.
- For presentation mode, keep slide messages as keywords or short sentences and
  place concrete detail in speakerNotes.
- For report/submission mode, make body messages self-contained enough to read
  without a presenter, and prefer data/table/chart intent when the sources support it.
- When suggesting colors, use machine-readable theme tokens:
  background:#RRGGBB text:#RRGGBB accent:#RRGGBB secondary:#RRGGBB
  surface:#RRGGBB muted:#RRGGBB border:#RRGGBB
- For design moods such as 바다, 오션, 모노톤, or 블랙앤화이트, reflect
  them through theme tokens or visualIntent.paletteHint when possible.
- Write concrete slide titles, body messages, and speaker notes for the actual subject.
- speakerNotes must be the actual Korean presenter script to read aloud, not a guide
  about what the presenter should explain.
- Keep speakerNotes to 2-4 natural spoken sentences with concrete wording, examples,
  or transitions for the audience.
- Do not write speakerNotes like "이 슬라이드는 ... 설명합니다", "... 팁을 제공합니다",
  or "... 함께 언급합니다". Say the presentation lines directly.
- Choose slideType, layoutVariant, slotPreset, visualIntent, and mediaIntent.
- visualIntent must include paletteHint, emphasisStyle, composition,
  decorationDensity, mediaStyle, and metricCardCaption. Prefer concise values such as
  keyword-chips, split, poster, data, media, process, radial, bubble,
  low, medium, or high.
- For visualIntent.metricCardCaption, write only concrete text intended for a
  data/metric card. Use an empty string if there is no meaningful caption, and
  do not copy the slide message verbatim.
- Do not output coordinates, sizes, zIndex, or final Deck JSON.
- Do not write meta placeholders such as "목적과 기대 결과를 소개합니다" or
  "결정 사항, 실행 순서, 후속 검증 기준을 정리합니다" unless the source is actually about that.
- Do not invent unsupported facts. If excerpts are sparse, stay close to the topic and keywords.
- Keep messages concise enough for slide body text.
""".strip()

DECK_CONTENT_RESPONSE_FORMAT: dict[str, Any] = {
    "format": {
        "type": "json_schema",
        "name": "deck_content_plan",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "title": {"type": "string"},
                "slides": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "title": {"type": "string"},
                            "message": {"type": "string"},
                            "speakerNotes": {"type": "string"},
                            "keywords": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "slideType": {
                                "type": "string",
                                "enum": list(SLIDE_TYPES),
                            },
                            "layoutVariant": {
                                "type": "string",
                                "enum": sorted(LAYOUT_VARIANTS),
                            },
                            "slotPreset": {
                                "type": "string",
                                "enum": list(PRESET_REGISTRY.keys()),
                            },
                            "visualIntent": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "emphasis": {"type": "string"},
                                    "mood": {"type": "string"},
                                    "structure": {"type": "string"},
                                    "paletteHint": {"type": "string"},
                                    "emphasisStyle": {"type": "string"},
                                    "composition": {"type": "string"},
                                    "decorationDensity": {"type": "string"},
                                    "mediaStyle": {"type": "string"},
                                    "metricCardCaption": {"type": "string"},
                                },
                                "required": [
                                    "emphasis",
                                    "mood",
                                    "structure",
                                    "paletteHint",
                                    "emphasisStyle",
                                    "composition",
                                    "decorationDensity",
                                    "mediaStyle",
                                    "metricCardCaption",
                                ],
                            },
                            "mediaIntent": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "kind": {
                                        "type": "string",
                                        "enum": [
                                            "none",
                                            "provided",
                                            "generate",
                                            "placeholder",
                                        ],
                                    },
                                    "prompt": {"type": "string"},
                                    "alt": {"type": "string"},
                                    "caption": {"type": "string"},
                                    "rationale": {"type": "string"},
                                    "required": {"type": "boolean"},
                                    "placement": {"type": "string"},
                                    "src": {"type": "string"},
                                },
                                "required": [
                                    "kind",
                                    "prompt",
                                    "alt",
                                    "caption",
                                    "rationale",
                                    "required",
                                    "placement",
                                    "src",
                                ],
                            },
                        },
                        "required": [
                            "title",
                            "message",
                            "speakerNotes",
                            "keywords",
                            "slideType",
                            "layoutVariant",
                            "slotPreset",
                            "visualIntent",
                            "mediaIntent",
                        ],
                    },
                },
            },
            "required": ["title", "slides"],
        },
    }
}


TEXT_OVERLAP_REVIEW_INSTRUCTIONS = """
You review one slide preview for text-on-text overlap only.
Return JSON only.

Rules:
- unreadable=true only when overlapping text would be hard for a human to read.
- Ignore decorative shapes, image placeholders, charts, and footer text.
- Do not evaluate layout taste, wording, contrast, or grammar.
""".strip()

TEXT_OVERLAP_REVIEW_RESPONSE_FORMAT: dict[str, Any] = {
    "format": {
        "type": "json_schema",
        "name": "slide_text_overlap_review",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "unreadable": {"type": "boolean"},
                "reason": {"type": "string"},
            },
            "required": ["unreadable", "reason"],
        },
    }
}


class DeckGenerationOrchestrator:
    def __init__(
        self,
        request: GenerateDeckRequest,
        *,
        client: Any | None = None,
        model: str | None = None,
        api_key: str | None = None,
        reference_context: list[ReferenceContext] | None = None,
        image_review_mode: ImageReviewMode = "auto",
    ) -> None:
        self.request = request
        self.client = client
        self.model = model
        self.api_key = api_key
        self.reference_context = reference_context
        self.image_review_mode = image_review_mode
        self.agent_outputs: dict[str, AgentOutput] = {}

    def run(self) -> GenerateDeckResponse:
        raw_input = self.run_brief_agent()
        self.run_source_grounding_agent(raw_input)
        outline, slide_plans = self.run_narrative_agent(raw_input)
        slide_plans, theme = self.run_design_director_agent(raw_input, slide_plans)
        template_selection = template_selection_for_slide_plans(raw_input, slide_plans)
        slides = self.run_layout_agent(raw_input, slide_plans, theme, template_selection)
        deck = self.build_deck(raw_input, outline, theme, slides)
        self.run_chart_data_agent(deck)
        self.run_media_agent(deck)
        reviewer_validation = self.run_quality_reviewer_agent(deck)
        deck, validation = self.run_refiner_agent(deck, reviewer_validation)
        warnings = unique_warnings(
            [
                *generation_warnings(raw_input, len(slides), validation),
                *self.agent_warnings(),
            ]
        )
        return GenerateDeckResponse(
            deck=deck,
            templateSelection=template_selection,
            warnings=warnings,
            validation=validation,
        )

    def record(
        self,
        name: str,
        summary: str,
        *,
        artifacts: dict[str, Any] | None = None,
        warnings: list[str] | None = None,
        next_actions: list[str] | None = None,
    ) -> None:
        self.agent_outputs[name] = AgentOutput(
            status="succeeded",
            summary=summary,
            artifacts=artifacts or {},
            warnings=warnings or [],
            nextActions=next_actions or [],
        )

    def agent_warnings(self) -> list[str]:
        return [
            warning
            for output in self.agent_outputs.values()
            for warning in output.warnings
        ]

    def run_brief_agent(self) -> RawInput:
        raw_input = analyze_input(self.request, reference_context=self.reference_context)
        self.record(
            "BriefAgent",
            "Normalized deck generation request.",
            artifacts={"rawInput": raw_input},
        )
        return raw_input

    def run_source_grounding_agent(self, raw_input: RawInput) -> None:
        self.record(
            "SourceGroundingAgent",
            "Prepared reference context for content grounding.",
            artifacts={
                "references": raw_input.references,
                "referenceContext": raw_input.reference_context,
            },
        )

    def run_narrative_agent(
        self,
        raw_input: RawInput,
    ) -> tuple[DeckOutline, list[SlidePlan]]:
        outline, slide_plans = plan_deck_content(
            raw_input,
            client=self.client,
            model=self.model,
            api_key=self.api_key,
        )
        self.record(
            "NarrativeAgent",
            "Planned slide narrative.",
            artifacts={"outline": outline, "slidePlans": slide_plans},
        )
        return outline, slide_plans

    def run_design_director_agent(
        self,
        raw_input: RawInput,
        slide_plans: list[SlidePlan],
    ) -> tuple[list[SlidePlan], dict[str, Any]]:
        slide_plans = apply_design_options(raw_input, slide_plans)
        theme = imported_theme_from_blueprint(raw_input) or direct_design(
            raw_input,
            slide_plans,
        )
        self.record(
            "DesignDirectorAgent",
            "Selected theme and design direction.",
            artifacts={
                "theme": theme,
                "designBlueprint": raw_input.design_blueprint,
                "slidePlans": slide_plans,
            },
        )
        return slide_plans, theme

    def run_layout_agent(
        self,
        raw_input: RawInput,
        slide_plans: list[SlidePlan],
        theme: dict[str, Any],
        template_selection: list[TemplateSelectionItem],
    ) -> list[dict[str, Any]]:
        slides = [
            assemble_slide_from_imported_blueprint(
                raw_input,
                slide_plan,
                theme,
                template_selection[slide_plan.order - 1]
                if slide_plan.order <= len(template_selection)
                else None,
            )
            if has_imported_design_blueprint(raw_input)
            else assemble_slide(raw_input, slide_plan, plan_visuals(slide_plan), theme)
            for slide_plan in slide_plans
        ]
        self.record(
            "LayoutAgent",
            "Composed editable slide elements.",
            artifacts={"slides": slides, "designBlueprint": raw_input.design_blueprint},
        )
        return slides

    def run_chart_data_agent(self, deck: dict[str, Any]) -> None:
        empty_chart_count = sum(
            1
            for slide in deck["slides"]
            for element in slide["elements"]
            if element["type"] == "chart" and not element.get("props", {}).get("data")
        )
        warnings = (
            ["ChartDataAgent kept chart data empty because no source numbers were available."]
            if empty_chart_count
            else []
        )
        self.record(
            "ChartDataAgent",
            "Checked chart data provenance.",
            artifacts={"emptyChartCount": empty_chart_count},
            warnings=warnings,
        )

    def run_media_agent(self, deck: dict[str, Any]) -> None:
        image_count = sum(
            1
            for slide in deck["slides"]
            for element in slide["elements"]
            if element["type"] == "image"
        )
        self.record(
            "MediaAgent",
            "Checked media placeholders and provided images.",
            artifacts={"imageCount": image_count},
        )

    def run_quality_reviewer_agent(self, deck: dict[str, Any]) -> ValidationResult:
        validation = ValidationResult(
            passed=not (
                validate_layout(deck)
                or validate_content(deck)
                or validate_presentation(deck)
            ),
            layoutIssues=validate_layout(deck),
            contentIssues=validate_content(deck),
            designIssues=validate_design(deck),
            presentationIssues=validate_presentation(deck),
        )
        self.record(
            "QualityReviewerAgent",
            "Reviewed layout, content, design, and presentation quality.",
            artifacts={"validation": validation},
        )
        return validation

    def run_refiner_agent(
        self,
        deck: dict[str, Any],
        reviewer_validation: ValidationResult,
    ) -> tuple[dict[str, Any], ValidationResult]:
        refined_deck = refine_design_issues(deck, reviewer_validation.design_issues)
        refined_deck, validation = validate_and_patch(refined_deck)
        text_overlap_candidates = detect_text_overlap_candidates(refined_deck)
        overlap_issues = review_text_overlap_candidates(
            refined_deck,
            text_overlap_candidates,
            client=self.client,
            model=self.model,
            api_key=self.api_key,
            image_review_mode=self.image_review_mode,
        )
        validation.layout_issues.extend(overlap_issues)
        validation.passed = not (
            validation.layout_issues
            or validation.content_issues
            or validation.presentation_issues
        )
        self.record(
            "RefinerAgent",
            "Applied bounded rule-based refinements.",
            artifacts={"validation": validation},
        )
        return refined_deck, validation

    def build_deck(
        self,
        raw_input: RawInput,
        outline: DeckOutline,
        theme: dict[str, Any],
        slides: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "deckId": f"deck_ai_{safe_token(raw_input.project_id)}",
            "projectId": raw_input.project_id,
            "title": outline.title,
            "version": 1,
            "targetDurationMinutes": raw_input.target_duration_minutes,
            "metadata": {
                "language": "ko",
                "locale": "ko-KR",
                "sourceType": "ai",
                "generatedBy": "ai",
                "audience": raw_input.metadata.audience,
                "purpose": raw_input.metadata.purpose,
                "tone": raw_input.metadata.tone,
                "createdFrom": {
                    "topic": raw_input.topic,
                    "references": [
                        {"fileId": reference.file_id}
                        for reference in raw_input.references
                    ],
                    "designReferences": [
                        {"fileId": reference.file_id}
                        for reference in raw_input.design_references
                    ],
                },
            },
            "canvas": {
                "preset": "wide-16-9",
                "width": CANVAS.width,
                "height": CANVAS.height,
                "aspectRatio": "16:9",
            },
            "theme": theme,
            "slides": slides,
        }


def generate_deck(
    request: GenerateDeckRequest,
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
    reference_context: list[ReferenceContext] | None = None,
    image_review_mode: ImageReviewMode = "auto",
) -> GenerateDeckResponse:
    return DeckGenerationOrchestrator(
        request,
        client=client,
        model=model,
        api_key=api_key,
        reference_context=reference_context,
        image_review_mode=image_review_mode,
    ).run()


def generation_warnings(
    raw_input: RawInput,
    generated_slide_count: int,
    validation: ValidationResult,
) -> list[str]:
    warnings: list[str] = []
    if not raw_input.references:
        warnings.append("참고자료 없이 topic-only generation으로 생성했습니다.")
    if raw_input.min_slide_count <= generated_slide_count < raw_input.max_slide_count:
        warnings.append(
            f"AI가 참고자료/주제 밀도를 기준으로 {generated_slide_count}장이 적정하다고 판단했습니다."
        )
    for issue in validation.design_issues:
        if should_promote_design_issue_to_warning(issue) and issue.message not in warnings:
            warnings.append(issue.message)
    for warning in imported_blueprint_warnings(raw_input):
        if warning not in warnings:
            warnings.append(warning)

    return warnings


def unique_warnings(warnings: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for warning in warnings:
        if warning in seen:
            continue
        seen.add(warning)
        result.append(warning)
    return result


def imported_theme_from_blueprint(raw_input: RawInput) -> dict[str, Any] | None:
    if not has_imported_design_blueprint(raw_input):
        return None
    blueprint = raw_input.design_blueprint
    if not isinstance(blueprint, dict):
        return None
    theme = blueprint.get("theme")
    if not isinstance(theme, dict):
        return None
    required = {
        "name",
        "fontFamily",
        "backgroundColor",
        "textColor",
        "accentColor",
        "palette",
        "typography",
        "effects",
    }
    return deepcopy(theme) if required.issubset(theme.keys()) else None


def has_imported_design_blueprint(raw_input: RawInput) -> bool:
    return isinstance(raw_input.design_blueprint, dict)


def imported_blueprint_warnings(raw_input: RawInput) -> list[str]:
    blueprint = raw_input.design_blueprint
    if not isinstance(blueprint, dict):
        return []
    warnings = blueprint.get("warnings")
    if not isinstance(warnings, list):
        return []
    return [warning for warning in warnings if isinstance(warning, str)]


def should_promote_design_issue_to_warning(issue: ValidationIssue) -> bool:
    return issue.message.startswith("이미지 소스가 없어") or issue.message.startswith(
        "근거 데이터가 없어"
    )


def analyze_input(
    request: GenerateDeckRequest,
    *,
    reference_context: list[ReferenceContext] | None = None,
) -> RawInput:
    slide_count = choose_slide_count(
        request.target_duration_minutes,
        request.slide_count_range,
    )
    prompt, design_prompt = split_content_and_design_prompt(
        request.prompt,
        request.design_prompt,
    )
    resolved_reference_context = (
        reference_context if reference_context is not None else request.reference_context
    )
    return RawInput(
        project_id=request.project_id,
        topic=request.topic.strip(),
        prompt=prompt,
        design_prompt=design_prompt,
        target_duration_minutes=request.target_duration_minutes,
        slide_count=slide_count,
        min_slide_count=request.slide_count_range.min,
        max_slide_count=request.slide_count_range.max,
        template=request.template,
        metadata=request.metadata,
        design=request.design,
        references=request.references,
        design_references=request.design_references,
        reference_keywords=request.reference_keywords,
        reference_context=resolved_reference_context,
        template_blueprint=normalize_template_blueprint(request.template_blueprint),
        design_blueprint=normalize_imported_design_blueprint(request.design_blueprint),
    )


def normalize_template_blueprint(blueprint: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(blueprint, dict):
        return None
    slides = blueprint.get("slides")
    return deepcopy(blueprint) if isinstance(slides, list) else None


def normalize_imported_design_blueprint(blueprint: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(blueprint, dict):
        return None
    try:
        return ImportedDesignBlueprint.model_validate(blueprint).model_dump(by_alias=True)
    except Exception:
        return None


def split_content_and_design_prompt(prompt: str, design_prompt: str) -> tuple[str, str]:
    content = prompt.strip()
    design = design_prompt.strip()
    if design:
        return content, design

    chunks = [chunk.strip() for chunk in re.split(r"[\n,;]+", content) if chunk.strip()]
    if not chunks:
        return "", ""

    design_chunks = [
        chunk for chunk in chunks if DESIGN_PROMPT_HINT_RE.search(chunk)
    ]
    if not design_chunks:
        return content, ""

    content_chunks = [chunk for chunk in chunks if chunk not in design_chunks]
    if len(chunks) == 1 and content_chunks:
        return content, ""

    return ", ".join(content_chunks), ", ".join(design_chunks)


def choose_slide_count(target_minutes: int, slide_range: SlideCountRange) -> int:
    suggested = round(target_minutes)
    return min(slide_range.max, max(slide_range.min, suggested))


def plan_deck_content(
    raw_input: RawInput,
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> tuple[DeckOutline, list[SlidePlan]]:
    generated_plan = generate_content_plan_with_llm(
        raw_input,
        client=client,
        model=model,
        api_key=api_key,
    )
    if generated_plan is not None:
        slide_plans = slide_plans_from_generated_content(raw_input, generated_plan)
        if slide_plans:
            return (
                DeckOutline(
                    title=deck_title_for_topic(raw_input.topic, generated_plan.title),
                    slide_titles=[slide.title for slide in slide_plans],
                ),
                slide_plans,
            )
    if requires_llm_content(raw_input):
        raise DeckContentGenerationError(
            "LLM deck content generation is required for prompt or reference-based decks."
        )

    outline = plan_presentation(raw_input)
    return outline, plan_slides(raw_input, outline)


def requires_llm_content(raw_input: RawInput) -> bool:
    return bool(
        raw_input.prompt.strip()
        or raw_input.references
        or raw_input.reference_keywords
        or raw_input.reference_context
    )


def deck_title_for_topic(topic: str, title: str) -> str:
    deck_title = title.strip()
    if not deck_title:
        return topic
    if topic in deck_title:
        return deck_title
    return f"{topic}: {deck_title}"


def plan_presentation(raw_input: RawInput) -> DeckOutline:
    titles = [
        title_for_slide(raw_input, index, raw_input.slide_count)
        for index in range(1, raw_input.slide_count + 1)
    ]
    return DeckOutline(title=f"{raw_input.topic} 발표안", slide_titles=titles)


def title_for_slide(raw_input: RawInput, order: int, total: int) -> str:
    if order == 1:
        return raw_input.topic
    if order == total:
        return f"{raw_input.topic} 핵심 정리"

    focus_terms = reference_keywords_for(raw_input.reference_keywords)
    middle_titles = [f"{term}" for term in focus_terms] or [
        f"{raw_input.topic}의 핵심 특징",
        f"{raw_input.topic}의 배경과 맥락",
        f"{raw_input.topic}의 주요 포인트",
        f"{raw_input.topic}의 사례와 활용",
        f"{raw_input.topic}를 기억하는 방법",
    ]
    return middle_titles[(order - 2) % len(middle_titles)]


def plan_slides(raw_input: RawInput, outline: DeckOutline) -> list[SlidePlan]:
    keyword_pool = reference_keywords_for(raw_input.reference_keywords) or keywords_for(
        raw_input.topic,
        raw_input.prompt,
    )
    plans: list[SlidePlan] = []

    for index, title in enumerate(outline.slide_titles, start=1):
        slide_type = slide_type_for(index, raw_input.slide_count)
        message = message_for(raw_input, slide_type, title)
        plans.append(
            SlidePlan(
                order=index,
                slide_type=slide_type,
                title=title,
                message=message,
                speaker_notes=speaker_notes_for(raw_input, title, message, index),
                keywords=keyword_pool[:3],
                evidence=evidence_for(raw_input.references, title),
                layout_variant=PRESET_REGISTRY[
                    preset_for_slide_type(slide_type)
                ].variant,
                slot_preset=preset_for_slide_type(slide_type),
            )
        )

    return plans


def slide_type_for(order: int, total: int) -> SlideType:
    if order == 1:
        return "cover"
    if order == total:
        return "summary"
    return SLIDE_TYPE_SEQUENCE[(order - 1) % (len(SLIDE_TYPE_SEQUENCE) - 1)]


def message_for(raw_input: RawInput, slide_type: SlideType, title: str) -> str:
    focus = keyword_phrase(raw_input)
    if slide_type == "cover":
        return f"{raw_input.topic}를 {focus} 중심으로 소개합니다."
    if slide_type == "summary":
        return f"{raw_input.topic}에서 기억할 핵심은 {focus}입니다."
    if title in reference_keywords_for(raw_input.reference_keywords):
        return f"{title}가 {raw_input.topic}에서 어떤 의미를 갖는지 설명합니다."

    base = raw_input.prompt or f"{raw_input.topic}의 주요 내용을 구체적으로 정리합니다."
    return f"{title}: {base}"


def speaker_notes_for(raw_input: RawInput, title: str, message: str, order: int) -> str:
    focus = keyword_phrase(raw_input)
    if order == 1:
        return (
            f"안녕하세요. 오늘은 {raw_input.topic}를 {focus} 중심으로 살펴보겠습니다. "
            f"먼저 왜 이 주제가 중요한지 짚고, 바로 적용할 수 있는 포인트까지 연결해 보겠습니다."
        )
    if order == raw_input.slide_count:
        return (
            f"마지막으로 핵심만 다시 묶어보겠습니다. {message} "
            f"이 내용을 기준으로 발표 이후에 바로 실행할 한 가지를 정하면 좋겠습니다."
        )
    return (
        f"여기서 중요한 점은 {message} "
        f"{title}를 볼 때는 {focus}가 실제 상황에서 어떻게 달라지는지에 집중해 주세요."
    )


def keywords_for(topic: str, prompt: str) -> list[str]:
    words = [word.strip(" ,.;:()[]{}") for word in f"{topic} {prompt}".split()]
    unique = [word for index, word in enumerate(words) if word and word not in words[:index]]
    return (unique or [topic])[:5]


def keyword_phrase(raw_input: RawInput) -> str:
    keywords = reference_keywords_for(raw_input.reference_keywords) or keywords_for(
        raw_input.topic,
        raw_input.prompt,
    )
    return ", ".join(keywords[:3]) if keywords else raw_input.topic


def reference_keywords_for(
    reference_keywords: list[GenerateDeckReferenceKeyword],
) -> list[str]:
    keywords: list[str] = []
    seen: set[str] = set()
    for keyword in reference_keywords:
        text = keyword.text.strip()
        key = text.casefold()
        if not text or key in seen:
            continue

        seen.add(key)
        keywords.append(text)

    return keywords[:5]


def generate_content_plan_with_llm(
    raw_input: RawInput,
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> GeneratedDeckContentPlan | None:
    api_client: Any = client
    if api_client is None:
        if not api_key:
            if requires_llm_content(raw_input):
                raise DeckContentGenerationError(
                    "OPENAI_API_KEY is required for prompt or reference-based deck generation."
                )
            return None

        from openai import OpenAI

        api_client = OpenAI(api_key=api_key)

    try:
        response = api_client.responses.create(
            model=model or "gpt-4.1-mini",
            instructions=DECK_CONTENT_INSTRUCTIONS,
            input=deck_content_prompt(raw_input),
            text=DECK_CONTENT_RESPONSE_FORMAT,
        )
    except Exception as error:
        raise DeckContentGenerationError(
            f"LLM deck content generation failed: {error}"
        ) from error

    output_text = str(getattr(response, "output_text", "")).strip()
    if not output_text:
        raise DeckContentGenerationError("LLM returned empty deck content.")

    try:
        payload = json.loads(output_text)
        plan = GeneratedDeckContentPlan.model_validate(payload)
    except Exception as error:
        raise DeckContentGenerationError(
            f"LLM returned invalid deck content: {error}"
        ) from error

    if len(plan.slides) < raw_input.min_slide_count:
        raise DeckContentGenerationError(
            f"LLM returned fewer slides than the requested minimum ({raw_input.min_slide_count})."
        )

    return GeneratedDeckContentPlan(
        title=plan.title,
        slides=plan.slides[: raw_input.slide_count],
    )


def deck_content_prompt(raw_input: RawInput) -> str:
    keywords = reference_keywords_for(raw_input.reference_keywords)
    context = "\n\n".join(
        f"[{item.file_id}] {item.title}\n{item.content[:1200]}"
        for item in raw_input.reference_context[:6]
    )
    return "\n".join(
        [
            f"Topic: {raw_input.topic}",
            f"User prompt: {raw_input.prompt or '(none)'}",
            f"Design prompt: {raw_input.design_prompt or '(none)'}",
            f"Slide count: {raw_input.slide_count}",
            f"Audience: {raw_input.metadata.audience}",
            f"Purpose: {raw_input.metadata.purpose}",
            f"Tone: {raw_input.metadata.tone}",
            f"Document mode: {document_mode_for(raw_input)}",
            f"Design profile: {raw_input.design.profile or '(auto)'}",
            f"Visual rhythm: {raw_input.design.visual_rhythm}",
            f"Density target: {raw_input.design.density_target}",
            f"Media policy: {raw_input.design.media_policy}",
            f"Layout diversity: {raw_input.design.layout_diversity}",
            f"Style pack override: {raw_input.design.style_pack_id or '(auto)'}",
            f"Slide preset override: {raw_input.design.slide_preset_id or '(auto)'}",
            "Preset style prompt:",
            preset_style_prompt_for(raw_input) or "(none)",
            f"Reference keywords: {', '.join(keywords) if keywords else '(none)'}",
            "Reference excerpts:",
            context or "(none)",
        ]
    )


def slide_plans_from_generated_content(
    raw_input: RawInput,
    plan: GeneratedDeckContentPlan,
) -> list[SlidePlan]:
    keyword_pool = reference_keywords_for(raw_input.reference_keywords)
    slide_plans: list[SlidePlan] = []

    for index, slide in enumerate(plan.slides[: raw_input.slide_count], start=1):
        slide_keywords = merge_keywords(keyword_pool, slide.keywords)
        fallback_type = slide_type_for(index, raw_input.slide_count)
        slide_type = normalize_slide_type(slide.slide_type, fallback_type)
        if slide_type == "cover" and fallback_type != "cover":
            slide_type = fallback_type
        if (
            slide_type == "summary"
            and fallback_type != "summary"
            and raw_input.slide_count > 1
        ):
            slide_type = fallback_type
        fallback_preset = preset_for_slide_type(slide_type)
        slot_preset = normalize_slot_preset(
            slide.slot_preset,
            fallback_preset,
        )
        slide_plans.append(
            SlidePlan(
                order=index,
                slide_type=slide_type,
                title=slide.title,
                message=slide.message,
                speaker_notes=slide.speaker_notes,
                keywords=slide_keywords[:6],
                evidence=evidence_for(raw_input.references, slide.title),
                layout_variant=normalize_layout_variant(
                    slide.layout_variant,
                    fallback_preset,
                ),
                slot_preset=slot_preset,
                requested_slot_preset=slot_preset,
                visual_intent=slide.visual_intent,
                media_intent=slide.media_intent,
            )
        )

    return slide_plans


def merge_keywords(primary: list[str], secondary: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for keyword in [*primary, *secondary]:
        text = keyword.strip()
        key = text.casefold()
        if not text or key in seen:
            continue

        seen.add(key)
        merged.append(text)

    return merged


def normalize_slide_type(value: SlideType | None, fallback: SlideType) -> SlideType:
    if value in SLIDE_TYPES:
        return value
    return fallback


def normalize_slot_preset(
    value: SlotPreset | None,
    fallback: SlotPreset,
) -> SlotPreset:
    if value in PRESET_REGISTRY:
        return value
    return fallback


def normalize_layout_variant(value: str, slot_preset: SlotPreset) -> str:
    if value in LAYOUT_VARIANTS:
        return value
    return PRESET_REGISTRY[slot_preset].variant


def apply_design_options(
    raw_input: RawInput,
    slide_plans: list[SlidePlan],
) -> list[SlidePlan]:
    previous_preset: SlotPreset | None = None
    preset_usage: dict[SlotPreset, int] = {}
    for slide_plan in slide_plans:
        slide_plan.media_intent = media_intent_for_policy(
            slide_plan.media_intent,
            raw_input.design.media_policy,
        )
        selected_preset = choose_layout_preset(
            slide_plan,
            raw_input,
            previous_preset,
            preset_usage,
        )
        slide_plan.slot_preset = selected_preset
        slide_plan.layout_variant = PRESET_REGISTRY[selected_preset].variant
        preset_usage[selected_preset] = preset_usage.get(selected_preset, 0) + 1
        previous_preset = selected_preset

    return slide_plans


def choose_layout_preset(
    slide_plan: SlidePlan,
    raw_input: RawInput,
    previous_preset: SlotPreset | None,
    preset_usage: dict[SlotPreset, int],
) -> SlotPreset:
    fallback = preset_for_slide_type(slide_plan.slide_type)
    if slide_plan.slide_type == "chart":
        return fallback

    candidates = layout_candidates_for(
        slide_plan,
        raw_input,
        previous_preset,
        preset_usage,
        fallback,
    )
    return max(
        candidates,
        key=lambda candidate: (
            candidate.score,
            -PRESET_ORDER[candidate.slot_preset],
        ),
    ).slot_preset


def layout_candidates_for(
    slide_plan: SlidePlan,
    raw_input: RawInput,
    previous_preset: SlotPreset | None,
    preset_usage: dict[SlotPreset, int],
    fallback: SlotPreset,
) -> list[LayoutCandidate]:
    design = raw_input.design
    variant = normalize_layout_variant(slide_plan.layout_variant, fallback)
    wants_media = media_intent_needs_slot(slide_plan.media_intent)
    composition = normalize_composition(slide_plan.visual_intent.composition)
    candidate_presets: set[SlotPreset] = {fallback}
    requested_slot_preset = slide_plan.requested_slot_preset
    if requested_slot_preset is not None:
        candidate_presets.add(requested_slot_preset)

    candidate_presets.update(
        slot_preset
        for slot_preset, preset in PRESET_REGISTRY.items()
        if preset.variant == variant
    )
    candidate_presets.update(presets_for_composition(composition))
    if wants_media:
        candidate_presets.update(
            slot_preset
            for slot_preset, preset in PRESET_REGISTRY.items()
            if preset_has_media_slot(preset)
        )
    candidate_presets.update(style_pack_slot_presets(raw_input, slide_plan))

    candidates: list[LayoutCandidate] = []
    for slot_preset in PRESET_REGISTRY:
        if slot_preset not in candidate_presets:
            continue

        preset = PRESET_REGISTRY[slot_preset]
        has_media_slot = preset_has_media_slot(preset)
        if not wants_media and has_media_slot:
            continue

        score = 4 if slot_preset == fallback else 0
        if preset.variant == variant:
            score += 1
        if wants_media:
            score += 3 if has_media_slot else -2
        if PRESET_DENSITY[slot_preset] == design.density_target:
            score += 2
        score += design_profile_slot_score(design.profile, slot_preset)
        score += style_pack_slot_score(raw_input, slide_plan, slot_preset)
        score += composition_score(slot_preset, composition)
        if slot_preset == requested_slot_preset:
            score += 4 if uses_document_style_pack(raw_input) else 10
        score -= preset_usage.get(slot_preset, 0)
        if slide_plan.slide_type == "summary":
            score += 2 if preset.variant == "data" else 0
            score -= 4 if slot_preset == "quote_with_source" else 0
        if design.layout_diversity == "varied":
            if slot_preset == previous_preset:
                score -= 2
            score -= layout_stability_penalty(slot_preset, previous_preset)

        candidates.append(LayoutCandidate(slot_preset=slot_preset, score=score))

    return candidates


def style_pack_slot_presets(
    raw_input: RawInput,
    slide_plan: SlidePlan,
) -> set[SlotPreset]:
    preferences = style_pack_slot_preferences(raw_input, slide_plan)
    return set(preferences)


def style_pack_slot_score(
    raw_input: RawInput,
    slide_plan: SlidePlan,
    slot_preset: SlotPreset,
) -> int:
    preferences = style_pack_slot_preferences(raw_input, slide_plan)
    if slot_preset not in preferences:
        return 0
    return max(2, 14 - preferences.index(slot_preset) * 6)


def style_pack_slot_preferences(
    raw_input: RawInput,
    slide_plan: SlidePlan,
) -> tuple[SlotPreset, ...]:
    style_pack_id = effective_document_style_pack_id(raw_input)
    if not style_pack_id:
        return ()

    preference_map = STYLE_PACK_SLOT_PRESET_PREFERENCES.get(style_pack_id)
    if preference_map is None:
        return ()

    merged: list[SlotPreset] = []
    for preset in (
        *preference_map.get(slide_plan.slide_type, ()),
        *preference_map.get("*", ()),
    ):
        if preset not in merged:
            merged.append(preset)

    return tuple(merged)


def design_profile_slot_score(
    profile: DesignProfile | None,
    slot_preset: SlotPreset,
) -> int:
    if profile is None:
        return 0
    return 2 if slot_preset in DESIGN_PROFILE_SLOT_BONUS[profile] else 0


def normalize_composition(value: str) -> str:
    normalized = value.strip().casefold()
    if has_any(normalized, ["process", "step", "flow", "timeline", "sequence"]):
        return "process"
    if has_any(normalized, ["radial", "hub", "cycle"]):
        return "radial"
    if has_any(normalized, ["bubble", "cluster"]):
        return "bubble"
    if "split" in normalized or "two" in normalized:
        return "split"
    if "poster" in normalized or "cover" in normalized:
        return "poster"
    if "data" in normalized or "metric" in normalized:
        return "data"
    if "media" in normalized or "image" in normalized or "visual" in normalized:
        return "media"
    return ""


def presets_for_composition(composition: str) -> set[SlotPreset]:
    if composition == "split":
        return {
            "title_left_visual_right",
            "before_after",
            "us_vs_them",
            "quote_left_image_right",
        }
    if composition == "poster":
        return {"title_center", "title_full_bleed_image"}
    if composition == "data":
        return {"big_number_focus", "metric_cards", "insight_with_evidence"}
    if composition == "process":
        return {"before_after", "criteria_table", "insight_with_evidence"}
    if composition in {"radial", "bubble"}:
        return {"metric_cards", "insight_with_evidence"}
    if composition == "media":
        return {
            slot_preset
            for slot_preset, preset in PRESET_REGISTRY.items()
            if preset_has_media_slot(preset)
        }
    return set()


def composition_score(slot_preset: SlotPreset, composition: str) -> int:
    if not composition:
        return 0
    return 3 if slot_preset in presets_for_composition(composition) else -1


def layout_stability_penalty(
    slot_preset: SlotPreset,
    previous_preset: SlotPreset | None,
) -> int:
    if previous_preset is None:
        return 0

    preset = PRESET_REGISTRY[slot_preset]
    previous = PRESET_REGISTRY[previous_preset]
    penalty = 0
    title = slot_for_role(preset, "title")
    previous_title = slot_for_role(previous, "title")
    if title is not None and previous_title is not None and any(
        getattr(title, field) != getattr(previous_title, field)
        for field in ("x", "y", "width", "height")
    ):
        penalty += 8

    body = slot_for_role(preset, "body")
    previous_body = slot_for_role(previous, "body")
    if body is not None and previous_body is not None:
        if abs(body.y - previous_body.y) > 64:
            penalty += 5

    return penalty


def slot_for_role(preset: PresetConfig, role: str) -> LayoutSlot | None:
    return next((slot for slot in preset.slots if slot.role == role), None)


def media_intent_for_policy(
    media_intent: MediaIntent,
    media_policy: MediaPolicy,
) -> MediaIntent:
    if media_intent.kind == "none":
        return media_intent
    if media_intent.kind == "provided" and media_intent.src.strip():
        return media_intent
    if media_policy == "placeholder-ok":
        return media_intent
    return MediaIntent()


def media_intent_needs_slot(media_intent: MediaIntent) -> bool:
    if media_intent.kind == "none":
        return False
    if media_intent.kind == "provided":
        return bool(media_intent.src.strip()) or media_intent.required
    return True


def preset_has_media_slot(preset: PresetConfig) -> bool:
    return any(slot.role == "media" for slot in preset.slots)


def preset_for_slide_type(slide_type: SlideType) -> SlotPreset:
    return PRESET_BY_SLIDE_TYPE.get(slide_type, "insight_with_evidence")


def registry_item(
    registry: dict[str, dict[str, Any]],
    item_id: str | None,
) -> dict[str, Any] | None:
    if item_id is None:
        return None
    return registry.get(item_id.strip())


def select_slide_preset_id(
    raw_input: RawInput,
    slide_plan: SlidePlan,
) -> str | None:
    override = registry_item(SLIDE_PRESET_REGISTRY, raw_input.design.slide_preset_id)
    if override is not None:
        return str(override["id"])

    if uses_document_style_pack(raw_input):
        return None

    composition = normalize_composition(slide_plan.visual_intent.composition)
    step_count = len([keyword for keyword in slide_plan.keywords if keyword.strip()])
    text = " ".join(
        [
            raw_input.topic,
            raw_input.prompt,
            raw_input.design_prompt,
            slide_plan.title,
            slide_plan.message,
            composition,
        ]
    ).casefold()
    if (
        slide_plan.slide_type == "process"
        and step_count >= 6
        and "process-cards-horizontal-6" in SLIDE_PRESET_REGISTRY
    ):
        return "process-cards-horizontal-6"
    if (
        has_any(text, ["process card", "process cards", "teal process"])
        and "process-cards-horizontal-6" in SLIDE_PRESET_REGISTRY
    ):
        return "process-cards-horizontal-6"
    if (
        slide_plan.slide_type == "comparison"
        and "comparison-cards-2" in SLIDE_PRESET_REGISTRY
    ):
        return "comparison-cards-2"
    if slide_plan.slide_type == "data" and "metric-cards-3" in SLIDE_PRESET_REGISTRY:
        return "metric-cards-3"
    if composition == "process" and "timeline-steps-5" in SLIDE_PRESET_REGISTRY:
        return "timeline-steps-5"
    return None


def select_style_pack(
    raw_input: RawInput,
    slide_plans: list[SlidePlan],
) -> dict[str, Any] | None:
    override = registry_item(STYLE_PACK_REGISTRY, raw_input.design.style_pack_id)
    if override is not None:
        return override

    if wants_presentation_document_style(raw_input):
        return registry_item(STYLE_PACK_REGISTRY, PRESENTATION_DOCUMENT_STYLE_PACK_ID)

    if wants_submission_document_style(raw_input):
        return registry_item(STYLE_PACK_REGISTRY, SUBMISSION_DOCUMENT_STYLE_PACK_ID)

    if wants_simple_basic_style(raw_input):
        return registry_item(STYLE_PACK_REGISTRY, SIMPLE_BASIC_STYLE_PACK_ID)

    text = " ".join(
        [
            raw_input.topic,
            raw_input.prompt,
            raw_input.design_prompt,
            *[slide_plan.title for slide_plan in slide_plans],
            *[slide_plan.message for slide_plan in slide_plans],
        ]
    ).casefold()
    if has_any(text, ["teal process", "process card", "process cards"]):
        return registry_item(STYLE_PACK_REGISTRY, "teal-professional-process")
    if any(
        select_slide_preset_id(raw_input, slide_plan) == "process-cards-horizontal-6"
        for slide_plan in slide_plans
    ):
        return registry_item(STYLE_PACK_REGISTRY, "teal-professional-process")
    return None


def wants_simple_basic_style(raw_input: RawInput) -> bool:
    text = " ".join([raw_input.design_prompt, raw_input.prompt]).casefold()
    return has_any(text, list(SIMPLE_BASIC_STYLE_KEYWORDS))


def wants_presentation_document_style(raw_input: RawInput) -> bool:
    text = " ".join([raw_input.design_prompt, raw_input.prompt]).casefold()
    return has_any(text, list(PRESENTATION_DOCUMENT_STYLE_KEYWORDS))


def wants_submission_document_style(raw_input: RawInput) -> bool:
    text = " ".join([raw_input.design_prompt, raw_input.prompt]).casefold()
    return has_any(text, list(SUBMISSION_DOCUMENT_STYLE_KEYWORDS))


def selected_style_pack_id(raw_input: RawInput) -> str:
    return (raw_input.design.style_pack_id or "").strip().casefold()


def effective_document_style_pack_id(raw_input: RawInput) -> str:
    style_pack_id = selected_style_pack_id(raw_input)
    if style_pack_id in DOCUMENT_STYLE_PACK_IDS:
        return style_pack_id
    if wants_presentation_document_style(raw_input):
        return PRESENTATION_DOCUMENT_STYLE_PACK_ID
    if wants_submission_document_style(raw_input):
        return SUBMISSION_DOCUMENT_STYLE_PACK_ID
    if wants_simple_basic_style(raw_input):
        return SIMPLE_BASIC_STYLE_PACK_ID
    return ""


def preset_style_prompt_for(raw_input: RawInput) -> str:
    return STYLE_PACK_LLM_PROMPTS.get(effective_document_style_pack_id(raw_input), "")


def uses_document_style_pack(raw_input: RawInput) -> bool:
    return bool(effective_document_style_pack_id(raw_input))


def document_mode_for(raw_input: RawInput) -> str:
    style_pack_id = selected_style_pack_id(raw_input)
    if (
        style_pack_id == PRESENTATION_DOCUMENT_STYLE_PACK_ID
        or wants_presentation_document_style(raw_input)
    ):
        return "presentation"
    if (
        style_pack_id == SUBMISSION_DOCUMENT_STYLE_PACK_ID
        or wants_submission_document_style(raw_input)
    ):
        return "report/submission"

    text = " ".join([raw_input.design_prompt, raw_input.prompt]).casefold()
    if has_any(text, list(REPORT_MODE_KEYWORDS)) or raw_input.metadata.purpose == "report":
        return "report/submission"
    if has_any(text, list(PRESENTATION_MODE_KEYWORDS)):
        return "presentation"
    return "auto"


def apply_style_pack(
    theme: dict[str, Any],
    style_pack: dict[str, Any] | None,
) -> dict[str, Any]:
    if style_pack is None:
        return theme

    profile = style_pack.get("theme", {})
    theme["name"] = str(profile.get("name", style_pack["id"]))
    theme["fontFamily"] = str(profile.get("bodyFontFamily", theme["fontFamily"]))
    theme["backgroundColor"] = str(profile.get("background", theme["backgroundColor"]))
    theme["textColor"] = str(profile.get("text", theme["textColor"]))
    theme["accentColor"] = str(profile.get("accent", theme["accentColor"]))
    theme["palette"] = {
        "primary": str(profile.get("accent", theme["palette"]["primary"])),
        "secondary": str(profile.get("secondary", theme["palette"]["secondary"])),
        "surface": str(profile.get("surface", theme["palette"]["surface"])),
        "muted": str(profile.get("muted", theme["palette"]["muted"])),
        "border": str(profile.get("border", theme["palette"]["border"])),
    }
    theme["typography"] = {
        "headingFontFamily": str(
            profile.get(
                "headingFontFamily",
                theme["typography"]["headingFontFamily"],
            )
        ),
        "bodyFontFamily": str(
            profile.get("bodyFontFamily", theme["typography"]["bodyFontFamily"])
        ),
        "titleSize": int(profile.get("titleSize", theme["typography"]["titleSize"])),
        "headingSize": int(
            profile.get("headingSize", theme["typography"]["headingSize"])
        ),
        "bodySize": int(profile.get("bodySize", theme["typography"]["bodySize"])),
        "captionSize": int(
            profile.get("captionSize", theme["typography"]["captionSize"])
        ),
    }
    effects = dict(theme.get("effects", {}))
    effects.update(style_pack.get("effects", {}))
    theme["effects"] = effects
    return theme


def evidence_for(
    references: list[GenerateDeckReference],
    title: str,
) -> list[SourceEvidence]:
    return [
        SourceEvidence(fileId=reference.file_id, note=f"{title} 근거 후보", confidence=0.7)
        for reference in references[:2]
    ]


def direct_design(
    raw_input: RawInput,
    slide_plans: list[SlidePlan] | None = None,
) -> dict[str, Any]:
    profile = design_profile_for(raw_input, slide_plans)
    theme = {
        "name": f"{raw_input.template}-{profile['name']}-ai",
        "fontFamily": profile["bodyFontFamily"],
        "backgroundColor": profile["background"],
        "textColor": profile["text"],
        "accentColor": profile["accent"],
        "palette": {
            "primary": profile["accent"],
            "secondary": profile["secondary"],
            "surface": profile["surface"],
            "muted": profile["muted"],
            "border": profile["border"],
        },
        "typography": {
            "headingFontFamily": profile["headingFontFamily"],
            "bodyFontFamily": profile["bodyFontFamily"],
            "titleSize": profile["titleSize"],
            "headingSize": profile["headingSize"],
            "bodySize": profile["bodySize"],
            "captionSize": profile["captionSize"],
        },
        "effects": {"borderRadius": 8},
    }
    theme = apply_explicit_palette(theme, raw_input, slide_plans)
    return apply_style_pack(theme, select_style_pack(raw_input, slide_plans or []))


def apply_explicit_palette(
    theme: dict[str, Any],
    raw_input: RawInput,
    slide_plans: list[SlidePlan] | None = None,
) -> dict[str, Any]:
    tokens = keyed_theme_tokens(raw_input, slide_plans)
    if tokens:
        return apply_keyed_theme_tokens(theme, tokens)

    semantic_palette = semantic_palette_for_sources(raw_input, slide_plans)
    if semantic_palette is not None:
        return apply_semantic_palette(theme, semantic_palette)

    colors = explicit_palette_colors(raw_input, slide_plans)
    if not colors:
        return theme

    neutral = next((color for color in colors if is_neutral_color(color)), None)
    accent_colors = [color for color in colors if not is_neutral_color(color)]

    if neutral is not None:
        theme["backgroundColor"] = neutral
        theme["textColor"] = text_color_for_background(neutral)
        theme["palette"]["surface"] = neutral

    if accent_colors:
        accent = accent_colors[0]
        theme["accentColor"] = accent
        theme["palette"]["primary"] = accent
        theme["palette"]["secondary"] = (
            accent_colors[1] if len(accent_colors) > 1 else accent
        )
        if neutral == "#ffffff" and accent == "#facc15":
            theme["palette"]["secondary"] = accent
            theme["palette"]["muted"] = "#fef9c3"
            theme["palette"]["border"] = "#fde68a"

    return theme


def semantic_palette_for_sources(
    raw_input: RawInput,
    slide_plans: list[SlidePlan] | None = None,
) -> dict[str, Any] | None:
    sources = [
        *[
            slide_plan.visual_intent.palette_hint
            for slide_plan in slide_plans or []
        ],
        raw_input.design_prompt,
    ]
    for source in sources:
        normalized = strip_theme_tokens(source).casefold()
        for profile in SEMANTIC_PALETTE_PROFILES.values():
            if has_any(normalized, profile["keywords"]):
                return profile
    return None


def apply_semantic_palette(
    theme: dict[str, Any],
    profile: dict[str, Any],
) -> dict[str, Any]:
    theme["backgroundColor"] = profile["background"]
    theme["textColor"] = profile["text"]
    theme["accentColor"] = profile["accent"]
    theme["palette"]["primary"] = profile["accent"]
    theme["palette"]["secondary"] = profile["secondary"]
    theme["palette"]["surface"] = profile["surface"]
    theme["palette"]["muted"] = profile["muted"]
    theme["palette"]["border"] = profile["border"]
    return theme


def keyed_theme_tokens(
    raw_input: RawInput,
    slide_plans: list[SlidePlan] | None = None,
) -> dict[str, str]:
    tokens: dict[str, str] = {}
    for source in palette_sources(raw_input, slide_plans):
        for match in THEME_TOKEN_RE.finditer(source):
            key = match.group(1).lower()
            if key not in tokens:
                tokens[key] = match.group(2).lower()
    return tokens


def apply_keyed_theme_tokens(
    theme: dict[str, Any],
    tokens: dict[str, str],
) -> dict[str, Any]:
    background = tokens.get("background")
    if background:
        theme["backgroundColor"] = background

    if "text" in tokens:
        theme["textColor"] = tokens["text"]
    elif background:
        theme["textColor"] = text_color_for_background(background)

    accent = tokens.get("accent")
    if accent:
        theme["accentColor"] = accent
        theme["palette"]["primary"] = accent
        theme["palette"]["secondary"] = accent

    for key in ("primary", "secondary", "surface", "muted", "border"):
        if key in tokens:
            theme["palette"][key] = tokens[key]

    if background and contrast_ratio(background, theme["textColor"]) < 4.5:
        theme["textColor"] = text_color_for_background(background)

    return theme


def explicit_palette_colors(
    raw_input: RawInput,
    slide_plans: list[SlidePlan] | None = None,
) -> list[str]:
    colors: list[str] = []
    for source in palette_sources(raw_input, slide_plans):
        source = strip_theme_tokens(source)
        for match in EXPLICIT_COLOR_RE.finditer(source):
            token = match.group(0).casefold()
            if token.startswith("#"):
                color = token.lower()
            else:
                color = EXPLICIT_COLOR_NAME_MAP[token]
            if color not in colors:
                colors.append(color)
    return colors


def palette_sources(
    raw_input: RawInput,
    slide_plans: list[SlidePlan] | None = None,
) -> list[str]:
    return [
        *[
            slide_plan.visual_intent.palette_hint
            for slide_plan in slide_plans or []
        ],
        raw_input.design_prompt,
        raw_input.prompt,
    ]


def strip_theme_tokens(source: str) -> str:
    return THEME_TOKEN_ANY_RE.sub(" ", source)


def is_neutral_color(color: str) -> bool:
    return color in NEUTRAL_COLORS


def text_color_for_background(color: str) -> str:
    dark = "#111827"
    light = "#f8fafc"
    return (
        dark
        if contrast_ratio(color, dark) >= contrast_ratio(color, light)
        else light
    )


def contrast_ratio(color_a: str, color_b: str) -> float:
    lighter = max(relative_luminance(color_a), relative_luminance(color_b))
    darker = min(relative_luminance(color_a), relative_luminance(color_b))
    return (lighter + 0.05) / (darker + 0.05)


def relative_luminance(color: str) -> float:
    values = [
        int(color[index : index + 2], 16) / 255
        for index in (1, 3, 5)
    ]
    channels = [
        value / 12.92
        if value <= 0.03928
        else ((value + 0.055) / 1.055) ** 2.4
        for value in values
    ]
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def design_profile_for(
    raw_input: RawInput,
    slide_plans: list[SlidePlan] | None = None,
) -> dict[str, Any]:
    if raw_input.design.profile is not None:
        return theme_for_design_profile(raw_input.design.profile)

    rhythm_profile = design_profile_for_visual_rhythm(raw_input.design.visual_rhythm)
    if rhythm_profile is not None:
        return rhythm_profile

    palette_hints = [
        strip_theme_tokens(slide_plan.visual_intent.palette_hint)
        for slide_plan in slide_plans or []
    ]
    text = " ".join(
        [
            raw_input.topic,
            raw_input.prompt,
            strip_theme_tokens(raw_input.design_prompt),
            raw_input.metadata.audience,
            raw_input.metadata.purpose,
            raw_input.metadata.tone,
            *palette_hints,
        ]
    ).casefold()
    registry_profile = style_profile_for_text(text)
    if registry_profile is not None:
        return registry_profile

    if has_any(text, ["speech", "stt", "audio", "voice", "언어", "음성", "오디오", "방언"]):
        return {
            "name": "voice-tech",
            "headingFontFamily": "Noto Sans KR",
            "bodyFontFamily": "Noto Sans KR",
            "background": "#f7fbff",
            "surface": "#ffffff",
            "text": "#102033",
            "accent": "#1a73e8",
            "secondary": "#34a853",
            "muted": "#eef6ff",
            "border": "#c8daf4",
            "titleSize": 64,
            "headingSize": 42,
            "bodySize": 27,
            "captionSize": 17,
        }
    if raw_input.template == "lesson" or raw_input.metadata.purpose == "teach":
        return {
            "name": "lesson-green",
            "headingFontFamily": "Noto Sans KR",
            "bodyFontFamily": "Noto Sans KR",
            "background": "#fbfdf7",
            "surface": "#ffffff",
            "text": "#16251b",
            "accent": "#2f7d32",
            "secondary": "#e0a100",
            "muted": "#f0f7e8",
            "border": "#cfe2bd",
            "titleSize": 60,
            "headingSize": 40,
            "bodySize": 28,
            "captionSize": 18,
        }
    if raw_input.template == "pitch" or raw_input.metadata.purpose == "persuade":
        return {
            "name": "pitch-contrast",
            "headingFontFamily": "Montserrat",
            "bodyFontFamily": "Inter",
            "background": "#0f172a",
            "surface": "#172033",
            "text": "#f8fafc",
            "accent": "#22d3ee",
            "secondary": "#f59e0b",
            "muted": "#111827",
            "border": "#334155",
            "titleSize": 66,
            "headingSize": 44,
            "bodySize": 27,
            "captionSize": 17,
        }
    if raw_input.template == "report" or raw_input.metadata.audience == "executive":
        return {
            "name": "report-editorial",
            "headingFontFamily": "IBM Plex Sans",
            "bodyFontFamily": "Inter",
            "background": "#f8fafc",
            "surface": "#ffffff",
            "text": "#111827",
            "accent": "#0f766e",
            "secondary": "#7c3aed",
            "muted": "#eef2f7",
            "border": "#cbd5e1",
            "titleSize": 62,
            "headingSize": 42,
            "bodySize": 26,
            "captionSize": 17,
        }
    return STYLE_PROFILE_REGISTRY["startup-clean"]


def theme_for_design_profile(profile: DesignProfile) -> dict[str, Any]:
    if profile == "executive-report":
        theme = dict(STYLE_PROFILE_REGISTRY["academic-report"])
    elif profile == "startup-pitch":
        theme = design_profile_for_visual_rhythm("bold") or dict(
            STYLE_PROFILE_REGISTRY["startup-clean"]
        )
    elif profile == "editorial":
        theme = dict(STYLE_PROFILE_REGISTRY["warm-editorial"])
    elif profile == "technical":
        theme = design_profile_for_visual_rhythm("technical") or dict(
            STYLE_PROFILE_REGISTRY["dark-cyber"]
        )
    else:
        theme = {
            "name": "training",
            "headingFontFamily": "Noto Sans KR",
            "bodyFontFamily": "Noto Sans KR",
            "background": "#fbfdf7",
            "surface": "#ffffff",
            "text": "#16251b",
            "accent": "#2f7d32",
            "secondary": "#e0a100",
            "muted": "#f0f7e8",
            "border": "#cfe2bd",
            "titleSize": 60,
            "headingSize": 40,
            "bodySize": 28,
            "captionSize": 18,
        }
    theme["name"] = profile
    return theme


def style_profile_for_text(text: str) -> dict[str, Any] | None:
    if has_any(
        text,
        [
            "splatoon",
            "platoon",
            "raiders",
            "neon ink",
            "스플래툰",
            "레이더스",
            "잉크",
            "네온",
            "게임",
            "비비드",
            "밝은",
            "형광",
            "캐주얼",
        ],
    ) or (
        "game" in text and has_any(text, ["ink", "neon"])
    ):
        return STYLE_PROFILE_REGISTRY["game-ink-neon"]
    if has_any(text, ["cyber", "security", "dark system", "terminal"]):
        return STYLE_PROFILE_REGISTRY["dark-cyber"]
    if has_any(
        text,
        [
            "premium",
            "luxury",
            "high-end",
            "고급",
            "프리미엄",
            "럭셔리",
        ],
    ):
        return STYLE_PROFILE_REGISTRY["premium-dark"]
    if has_any(
        text,
        [
            "pretty",
            "beautiful",
            "modern",
            "polished",
            "stylish",
            "trendy",
            "예쁜",
            "예쁘게",
            "세련",
            "모던",
            "감각",
            "트렌디",
        ],
    ):
        return STYLE_PROFILE_REGISTRY["modern-lilac"]
    if has_any(
        text,
        [
            "startup",
            "saas",
            "product launch",
            "growth",
            "스타트업",
            "피치",
            "투자",
            "ir",
        ],
    ):
        return STYLE_PROFILE_REGISTRY["startup-clean"]
    if has_any(
        text,
        [
            "academic",
            "research",
            "paper",
            "report",
            "보고서",
            "리포트",
            "임원",
            "경영진",
        ],
    ):
        return STYLE_PROFILE_REGISTRY["academic-report"]
    if has_any(
        text,
        [
            "editorial",
            "magazine",
            "story",
            "warm",
            "에디토리얼",
            "매거진",
            "스토리",
            "감성",
        ],
    ):
        return STYLE_PROFILE_REGISTRY["warm-editorial"]
    if has_any(
        text,
        ["kids", "children", "elementary", "classroom", "어린이", "초등", "교실", "교육"],
    ):
        return STYLE_PROFILE_REGISTRY["kids-education"]
    return None


def design_profile_for_visual_rhythm(
    visual_rhythm: VisualRhythm,
) -> dict[str, Any] | None:
    if visual_rhythm == "technical":
        return {
            "name": "voice-tech",
            "headingFontFamily": "Noto Sans KR",
            "bodyFontFamily": "Noto Sans KR",
            "background": "#f7fbff",
            "surface": "#ffffff",
            "text": "#102033",
            "accent": "#1a73e8",
            "secondary": "#34a853",
            "muted": "#eef6ff",
            "border": "#c8daf4",
            "titleSize": 64,
            "headingSize": 42,
            "bodySize": 27,
            "captionSize": 17,
        }
    if visual_rhythm == "editorial":
        return {
            "name": "report-editorial",
            "headingFontFamily": "IBM Plex Sans",
            "bodyFontFamily": "Inter",
            "background": "#f8fafc",
            "surface": "#ffffff",
            "text": "#111827",
            "accent": "#0f766e",
            "secondary": "#7c3aed",
            "muted": "#eef2f7",
            "border": "#cbd5e1",
            "titleSize": 62,
            "headingSize": 42,
            "bodySize": 26,
            "captionSize": 17,
        }
    if visual_rhythm == "bold":
        return {
            "name": "pitch-contrast",
            "headingFontFamily": "Montserrat",
            "bodyFontFamily": "Inter",
            "background": "#0f172a",
            "surface": "#172033",
            "text": "#f8fafc",
            "accent": "#22d3ee",
            "secondary": "#f59e0b",
            "muted": "#111827",
            "border": "#334155",
            "titleSize": 66,
            "headingSize": 44,
            "bodySize": 27,
            "captionSize": 17,
        }
    if visual_rhythm == "clean":
        return {
            "name": "default-clean",
            "headingFontFamily": "Inter",
            "bodyFontFamily": "Inter",
            "background": "#ffffff",
            "surface": "#ffffff",
            "text": "#111827",
            "accent": "#2563eb",
            "secondary": "#f59e0b",
            "muted": "#f8fafc",
            "border": "#d8dee9",
            "titleSize": 60,
            "headingSize": 42,
            "bodySize": 26,
            "captionSize": 18,
        }
    return None


def has_any(text: str, candidates: list[str]) -> bool:
    return any(candidate in text for candidate in candidates)


def plan_visuals(slide_plan: SlidePlan) -> VisualPlan:
    slot_preset = normalize_slot_preset(
        slide_plan.slot_preset,
        preset_for_slide_type(slide_plan.slide_type),
    )
    preset = PRESET_REGISTRY[slot_preset]
    layout = "chart-focus" if slide_plan.slide_type == "chart" else preset.layout
    intents = [
        ElementIntent(role="background"),
        ElementIntent(role="title", text=slide_plan.title),
        ElementIntent(role="body", text=slide_plan.message),
    ]
    if slide_plan.order == 1:
        intents.append(ElementIntent(role="footer", text="ORBIT AI 덱"))
    if slide_plan.slide_type == "chart":
        intents.append(ElementIntent(role="chart", text=slide_plan.title))

    return VisualPlan(
        slide_type=slide_plan.slide_type,
        layout=layout,
        layout_variant=normalize_layout_variant(
            slide_plan.layout_variant,
            slot_preset,
        ),
        slot_preset=slot_preset,
        visual_intent=slide_plan.visual_intent,
        media_intent=slide_plan.media_intent,
        intents=intents,
    )


def compose_layout(visual_plan: VisualPlan) -> LayoutPlan:
    if visual_plan.slide_type == "chart":
        return LayoutPlan(
            slots=[
                LayoutSlot(
                    role="background",
                    x=0,
                    y=0,
                    width=CANVAS.width,
                    height=CANVAS.height,
                    z_index=0,
                ),
                LayoutSlot(
                    role="title",
                    x=CANVAS.safe_x,
                    y=CANVAS.safe_y,
                    width=CANVAS.safe_width,
                    height=128,
                    z_index=3,
                ),
                LayoutSlot(
                    role="body",
                    x=CANVAS.safe_x,
                    y=240,
                    width=540,
                    height=560,
                    z_index=3,
                ),
                LayoutSlot(role="chart", x=760, y=250, width=920, height=500, z_index=3),
                LayoutSlot(
                    role="footer",
                    x=CANVAS.safe_x,
                    y=980,
                    width=CANVAS.safe_width,
                    height=36,
                    z_index=5,
                ),
            ]
        )

    return LayoutPlan(slots=list(PRESET_REGISTRY[visual_plan.slot_preset].slots))


def assemble_slide(
    raw_input: RawInput,
    slide_plan: SlidePlan,
    visual_plan: VisualPlan,
    theme: dict[str, Any],
) -> dict[str, Any]:
    slide_preset_id = select_slide_preset_id(raw_input, slide_plan)
    if slide_preset_id == "process-cards-horizontal-6":
        return assemble_process_cards_slide(raw_input, slide_plan, theme)

    layout = compose_layout(visual_plan)
    slot_by_role = {slot.role: slot for slot in layout.slots}
    elements = [
        element_for_intent(slide_plan, intent, slot_by_role[intent.role], theme)
        for intent in visual_plan.intents
        if intent.role in slot_by_role
    ]
    elements.extend(media_elements(slide_plan, visual_plan, slot_by_role, theme))
    elements.extend(design_elements(slide_plan, visual_plan, theme))
    elements = cap_elements(elements)
    title_element = next(element for element in elements if element["role"] == "title")

    return {
        "slideId": f"slide_{slide_plan.order}",
        "order": slide_plan.order,
        "title": slide_plan.title,
        "thumbnailUrl": "",
        "style": {
            "layout": visual_plan.layout,
            "backgroundColor": theme["backgroundColor"],
            "textColor": theme["textColor"],
            "accentColor": theme["accentColor"],
        },
        "speakerNotes": slide_plan.speaker_notes,
        "elements": elements,
        "keywords": [
            {
                "keywordId": f"kw_{slide_plan.order}_{index}",
                "text": keyword,
                "synonyms": [],
                "abbreviations": [],
            }
            for index, keyword in enumerate(slide_plan.keywords, start=1)
        ],
        "animations": [
            {
                "animationId": f"anim_{slide_plan.order}_1",
                "elementId": title_element["elementId"],
                "type": "fade-in",
                "order": 1,
                "durationMs": 400,
                "delayMs": 0,
                "easing": "ease-out",
            }
        ],
        "aiNotes": {
            "emphasisPoints": [slide_plan.message],
            "sourceEvidence": [
                evidence.model_dump(by_alias=True) for evidence in slide_plan.evidence
            ],
        },
    }


def template_selection_for_slide_plans(
    raw_input: RawInput,
    slide_plans: list[SlidePlan],
) -> list[TemplateSelectionItem]:
    design_slides = imported_design_slides(raw_input)
    if not design_slides:
        return []
    template_slides = {
        positive_int(slide.get("sourceSlideIndex"), index + 1): slide
        for index, slide in enumerate(imported_template_slides(raw_input))
        if isinstance(slide, dict)
    }
    usage: dict[int, int] = {}
    profile_usage: dict[str, int] = {}
    selection: list[TemplateSelectionItem] = []

    for slide_plan in slide_plans:
        source_slide_index, profile_key, reason = select_imported_source_slide(
            raw_input,
            slide_plan,
            design_slides,
            template_slides,
            usage,
            profile_usage,
        )
        usage[source_slide_index] = usage.get(source_slide_index, 0) + 1
        profile_usage[profile_key] = profile_usage.get(profile_key, 0) + 1
        selection.append(
            TemplateSelectionItem(
                generatedOrder=slide_plan.order,
                sourceSlideIndex=source_slide_index,
                selectionReason=reason,
            )
        )
    return selection


def imported_design_slides(raw_input: RawInput) -> list[dict[str, Any]]:
    blueprint = raw_input.design_blueprint
    if not isinstance(blueprint, dict):
        return []
    slides = blueprint.get("slides")
    return [
        slide for slide in slides if isinstance(slide, dict)
    ] if isinstance(slides, list) else []


def imported_template_slides(raw_input: RawInput) -> list[dict[str, Any]]:
    blueprint = raw_input.template_blueprint
    if not isinstance(blueprint, dict):
        return []
    slides = blueprint.get("slides")
    return [
        slide for slide in slides if isinstance(slide, dict)
    ] if isinstance(slides, list) else []


def select_imported_source_slide(
    raw_input: RawInput,
    slide_plan: SlidePlan,
    design_slides: list[dict[str, Any]],
    template_slides: dict[int, dict[str, Any]],
    usage: dict[int, int],
    profile_usage: dict[str, int],
) -> tuple[int, str, str]:
    candidates: list[tuple[int, int, int, str, str]] = []
    for index, slide in enumerate(design_slides):
        source_index = positive_int(slide.get("sourceSlideIndex"), index + 1)
        template_slide = template_slides.get(source_index, {})
        profile = imported_slide_profile(slide, template_slide)
        profile_key = imported_slide_profile_key(profile)
        score, reason = imported_slide_match_score(raw_input, slide_plan, profile)
        source_penalty = usage.get(source_index, 0) * 20
        profile_penalty = profile_usage.get(profile_key, 0) * 6
        score -= source_penalty + profile_penalty
        if source_penalty:
            reason = f"{reason}, source reuse penalty {source_penalty}"
        if profile_penalty:
            reason = f"{reason}, profile reuse penalty {profile_penalty}"
        candidates.append(
            (score, -abs(source_index - slide_plan.order), -source_index, profile_key, reason)
        )

    score, _, negative_source_index, profile_key, reason = max(candidates)
    return -negative_source_index, profile_key, f"{reason}; score={score}"


def imported_slide_match_score(
    raw_input: RawInput,
    slide_plan: SlidePlan,
    profile: dict[str, Any],
) -> tuple[int, str]:
    score = 0
    reasons: list[str] = []
    body_slide = slide_plan.slide_type not in {"title", "cover", "summary"}

    if profile["slide_role"] == "toc":
        score -= 10
        reasons.append("toc layout reserved")

    if (
        body_slide
        and is_title_like_imported_profile(profile)
    ):
        score -= 8
        reasons.append("title layout reserved")
    if body_slide:
        if "body" in profile["roles"]:
            score += 8
            reasons.append("body slot")
        elif is_title_like_imported_profile(profile) or profile["layout"] == "metric":
            score -= 12
            reasons.append("no body slot")
        elif "caption" in profile["roles"]:
            score -= 6
            reasons.append("caption-only body capacity")
        elif profile["capacity"] == "low":
            score -= 4
            reasons.append("low body capacity")

    if slide_plan.slide_type in {"title", "cover"}:
        if profile["slide_role"] in {"cover", "title", "section"}:
            score += 10
            reasons.append("cover/title role")
        if profile["capacity"] == "low":
            score += 2
    elif slide_plan.slide_type == "summary":
        if profile["slide_role"] in {"closing", "summary", "section"}:
            score += 8
            reasons.append("closing role")
        if profile["layout"] in {"title", "body"}:
            score += 2
    elif slide_plan.slide_type in {"data", "chart"}:
        if "metric" in profile["roles"] or profile["slide_role"] in {"metric", "chart"}:
            score += 9
            reasons.append("metric/chart role")
        if profile["layout"] in {"metric", "chart"}:
            score += 4
    elif slide_plan.slide_type in {"comparison", "process", "feature-grid"}:
        if profile["layout"] in {"comparison", "two-column", "body"}:
            score += 6
            reasons.append("structured body layout")
        if profile["capacity"] in {"medium", "high"}:
            score += 3
    elif "body" in profile["roles"] or profile["capacity"] in {"medium", "high"}:
        score += 5
        reasons.append("body capacity")

    score += slot_preset_profile_score(slide_plan.slot_preset, profile)
    design_score, design_reason = design_hint_profile_score(raw_input, slide_plan, profile)
    if design_score:
        score += design_score
        reasons.append(design_reason)
    if not reasons:
        reasons.append("fallback semantic match")
    return score, ", ".join(reasons)


def is_title_like_imported_profile(profile: dict[str, Any]) -> bool:
    return (
        profile["slide_role"] in {"cover", "title", "section", "decorative"}
        or profile["layout"] in {"title", "decorative"}
    )


def design_hint_profile_score(
    raw_input: RawInput,
    slide_plan: SlidePlan,
    profile: dict[str, Any],
) -> tuple[int, str]:
    hints = design_layout_hints(raw_input, slide_plan)
    if not hints:
        return 0, ""

    profile_values = imported_profile_values(profile)
    if hints & profile_values:
        return 5, f"design hint match {','.join(sorted(hints & profile_values))}"
    return -5, f"design hint mismatch {','.join(sorted(hints))}"


def design_layout_hints(raw_input: RawInput, slide_plan: SlidePlan) -> set[str]:
    text = " ".join(
        [
            raw_input.design_prompt,
            raw_input.prompt,
            slide_plan.visual_intent.structure,
            slide_plan.visual_intent.composition,
            slide_plan.visual_intent.media_style,
            slide_plan.visual_intent.emphasis,
            slide_plan.visual_intent.mood,
        ]
    ).casefold()
    hints: set[str] = set()
    if has_any(text, ["체크리스트", "체크 리스트", "할 일", "주의사항", "항목"]):
        hints.update({"body", "toc", "checklist"})
    if has_any(text, ["단계", "프로세스", "타임라인", "로드맵", "흐름"]):
        hints.update({"process", "timeline", "body"})
    if has_any(text, ["비교", "전후", "장단점", "대조"]):
        hints.update({"comparison", "two-column"})
    if has_any(text, ["위험도", "매트릭스", "지표", "수치", "차트", "표"]):
        hints.update({"metric", "chart", "table"})
    if has_any(text, ["이미지", "무드보드", "브랜드", "감각적", "사진"]):
        hints.update({"image", "media"})
    return hints


def imported_profile_values(profile: dict[str, Any]) -> set[str]:
    roles = {str(role) for role in profile["roles"]}
    return roles | {
        str(profile["slide_role"]),
        str(profile["layout"]),
        str(profile["capacity"]),
    }


def imported_slide_profile_key(profile: dict[str, Any]) -> str:
    roles = ",".join(sorted(str(role) for role in profile["roles"]))
    return "|".join(
        [
            str(profile["slide_role"]),
            str(profile["layout"]),
            str(profile["capacity"]),
            roles,
        ]
    )


def imported_slide_profile(
    slide: dict[str, Any],
    template_slide: dict[str, Any],
) -> dict[str, Any]:
    elements = [
        element for element in slide.get("elements", []) if isinstance(element, dict)
    ]
    slots = [
        slot for slot in template_slide.get("slots", []) if isinstance(slot, dict)
    ]
    roles = {
        str(element.get("role", ""))
        for element in elements
        if str(element.get("role", ""))
    } | {
        str(slot.get("slotRole", ""))
        for slot in slots
        if str(slot.get("slotRole", ""))
    }
    slide_role = str(template_slide.get("slideRole") or "")
    raw_style = slide.get("style")
    style = cast(dict[str, Any], raw_style) if isinstance(raw_style, dict) else {}
    layout = str(template_slide.get("layoutType") or style.get("layout") or "")
    capacity = str(template_slide.get("contentCapacity") or "")
    role_count = sum(
        1
        for role in [
            *[str(element.get("role", "")) for element in elements],
            *[str(slot.get("slotRole", "")) for slot in slots],
        ]
        if role in {"title", "subtitle", "body", "caption", "label", "metric"}
    )
    if not slide_role and "label" in roles and "body" not in roles and role_count >= 3:
        slide_role = "toc"
    if not layout and slide_role == "toc":
        layout = "toc"
    if not capacity:
        content_count = len(
            roles & {"title", "subtitle", "body", "caption", "label", "metric"}
        )
        capacity = "low" if content_count <= 2 else "medium" if content_count <= 5 else "high"
    return {
        "roles": roles,
        "slide_role": slide_role or ("metric" if "metric" in roles else "body"),
        "layout": layout or "body",
        "capacity": capacity,
    }


def slot_preset_profile_score(
    slot_preset: SlotPreset | None,
    profile: dict[str, Any],
) -> int:
    if slot_preset in {"title_center", "title_full_bleed_image"}:
        return 4 if profile["layout"] == "title" else 0
    if slot_preset in {"metric_cards", "big_number_focus"}:
        return 4 if "metric" in profile["roles"] else 0
    if slot_preset in {"before_after", "us_vs_them", "criteria_table"}:
        return 4 if profile["layout"] in {"comparison", "two-column"} else 0
    if slot_preset in {"title_left_visual_right", "insight_with_evidence"}:
        return 3 if profile["capacity"] in {"medium", "high"} else 0
    return 0


def assemble_slide_from_imported_blueprint(
    raw_input: RawInput,
    slide_plan: SlidePlan,
    theme: dict[str, Any],
    template_selection: TemplateSelectionItem | None = None,
) -> dict[str, Any]:
    source_slide_index = (
        template_selection.source_slide_index if template_selection is not None else None
    )
    imported_slide = imported_slide_for_order(
        raw_input,
        slide_plan.order,
        source_slide_index,
    )
    if not imported_slide:
        return assemble_slide(raw_input, slide_plan, plan_visuals(slide_plan), theme)

    elements = imported_elements_for_slide(
        imported_slide,
        slide_plan,
        theme,
        imported_template_slide_for_order(
            raw_input,
            slide_plan.order,
            source_slide_index,
        ),
    )
    elements = cap_elements(
        elements,
        limit=element_limit_for_slide({"order": slide_plan.order, "elements": elements}),
    )
    raw_style = imported_slide.get("style")
    style: dict[str, Any] = raw_style if isinstance(raw_style, dict) else {}

    return {
        "slideId": f"slide_{slide_plan.order}",
        "order": slide_plan.order,
        "title": slide_plan.title,
        "thumbnailUrl": "",
        "style": {
            "layout": str(style.get("layout", "title-content")),
            "backgroundColor": str(style.get("backgroundColor", theme["backgroundColor"])),
            "textColor": str(style.get("textColor", theme["textColor"])),
            "accentColor": str(style.get("accentColor", theme["accentColor"])),
            "fontFamily": str(style.get("fontFamily", theme["fontFamily"])),
        },
        "speakerNotes": slide_plan.speaker_notes,
        "elements": elements,
        "keywords": [
            {
                "keywordId": f"kw_{slide_plan.order}_{index}",
                "text": keyword,
                "synonyms": [],
                "abbreviations": [],
            }
            for index, keyword in enumerate(slide_plan.keywords, start=1)
        ],
        "aiNotes": {
            "emphasisPoints": [slide_plan.message],
            "sourceEvidence": [
                evidence.model_dump(by_alias=True) for evidence in slide_plan.evidence
            ],
        },
    }


def imported_slide_for_order(
    raw_input: RawInput,
    order: int,
    source_slide_index: int | None = None,
) -> dict[str, Any] | None:
    if not has_imported_design_blueprint(raw_input):
        return None
    blueprint = raw_input.design_blueprint
    if not isinstance(blueprint, dict):
        return None
    slides = blueprint.get("slides")
    if not isinstance(slides, list) or not slides:
        return None
    if source_slide_index is not None:
        for slide in slides:
            if (
                isinstance(slide, dict)
                and positive_int(slide.get("sourceSlideIndex"), 0) == source_slide_index
            ):
                return slide
    slide = slides[(order - 1) % len(slides)]
    return slide if isinstance(slide, dict) else None


def imported_template_slide_for_order(
    raw_input: RawInput,
    order: int,
    source_slide_index: int | None = None,
) -> dict[str, Any] | None:
    blueprint = raw_input.template_blueprint
    if not isinstance(blueprint, dict):
        return None
    slides = blueprint.get("slides")
    if not isinstance(slides, list) or not slides:
        return None
    if source_slide_index is not None:
        for slide in slides:
            if (
                isinstance(slide, dict)
                and positive_int(slide.get("sourceSlideIndex"), 0) == source_slide_index
            ):
                return slide
    slide = slides[(order - 1) % len(slides)]
    return slide if isinstance(slide, dict) else None


def positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def imported_elements_for_slide(
    imported_slide: dict[str, Any],
    slide_plan: SlidePlan,
    theme: dict[str, Any],
    template_slide: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    raw_elements = imported_slide.get("elements")
    elements: list[dict[str, Any]] = []
    elements_by_source_id: dict[str, dict[str, Any]] = {}
    for index, element in enumerate(raw_elements if isinstance(raw_elements, list) else []):
        if not isinstance(element, dict):
            continue
        normalized = normalize_imported_element(element, slide_plan.order, index)
        elements.append(normalized)
        source_id = str(element.get("elementId", "")).strip()
        if source_id:
            elements_by_source_id[source_id] = normalized

    if template_slide is None:
        inject_imported_text(elements, slide_plan, theme)
    else:
        inject_template_slot_text(elements_by_source_id, template_slide, slide_plan)
    if not any(element.get("role") == "title" for element in elements):
        elements.append(
            text_element(
                slide_plan.order,
                "title_fallback",
                "title",
                slide_plan.title,
                CANVAS.safe_x,
                CANVAS.safe_y,
                CANVAS.safe_width,
                120,
                20,
                theme["textColor"],
                theme["typography"]["titleSize"],
                "bold",
                theme["typography"]["headingFontFamily"],
            )
        )
    if not any(element.get("role") == "body" for element in elements) and should_add_imported_body_fallback(
        template_slide,
    ):
        elements.append(
            text_element(
                slide_plan.order,
                "body_fallback",
                "body",
                slide_plan.message,
                CANVAS.safe_x,
                260,
                CANVAS.safe_width,
                260,
                21,
                theme["textColor"],
                theme["typography"]["bodySize"],
                "normal",
                theme["typography"]["bodyFontFamily"],
            )
        )
    return elements


def inject_template_slot_text(
    elements_by_source_id: dict[str, dict[str, Any]],
    template_slide: dict[str, Any],
    slide_plan: SlidePlan,
) -> None:
    raw_slots = template_slide.get("slots")
    slots = [
        slot
        for slot in raw_slots
        if is_replaceable_content_slot(slot)
    ] if isinstance(raw_slots, list) else []
    title_slot_id = first_template_slot_id(slots, {"title"})
    body_slot_id = template_body_slot_id(slots, title_slot_id)
    title_used = False
    body_used = False
    keyword_index = 0

    for slot in slots:
        element = elements_by_source_id.get(str(slot.get("elementId", "")))
        if not isinstance(element, dict) or element.get("type") != "text":
            continue
        props = element.get("props")
        if not isinstance(props, dict):
            continue

        slot_role = str(slot.get("slotRole", "body"))
        slot_id = str(slot.get("elementId", ""))
        if slot_id == title_slot_id and not title_used:
            element["role"] = "title"
            replace_text_props(props, slide_plan.title)
            title_used = True
        elif slot_id == body_slot_id and not body_used:
            element["role"] = "subtitle" if slot_role == "subtitle" else "body"
            replace_text_props(props, slide_plan.message)
            body_used = True
        elif slot_role == "title" and not title_used:
            element["role"] = "title"
            replace_text_props(props, slide_plan.title)
            title_used = True
        elif not body_used:
            element["role"] = deck_role_for_template_slot(slot_role)
            replace_text_props(
                props,
                template_auxiliary_slot_text(slide_plan, keyword_index),
            )
            keyword_index += 1
        else:
            element["role"] = deck_role_for_template_slot(slot_role)
            replace_text_props(
                props,
                template_auxiliary_slot_text(slide_plan, keyword_index),
            )
            keyword_index += 1


def should_add_imported_body_fallback(template_slide: dict[str, Any] | None) -> bool:
    if not isinstance(template_slide, dict):
        return True
    if is_toc_template_slide(template_slide):
        return False
    slots = template_slide.get("slots")
    if not isinstance(slots, list):
        return True
    return not any(
        is_replaceable_content_slot(slot)
        for slot in slots
    )


def first_template_slot_id(slots: list[dict[str, Any]], roles: set[str]) -> str:
    for slot in slots:
        if str(slot.get("slotRole", "")) in roles:
            return str(slot.get("elementId", ""))
    return ""


def template_body_slot_id(slots: list[dict[str, Any]], title_slot_id: str) -> str:
    body_slot_id = first_template_slot_id(slots, {"body", "subtitle", "caption"})
    if body_slot_id:
        return body_slot_id

    title_candidates = [
        slot
        for slot in slots
        if str(slot.get("slotRole", "")) == "title"
        and str(slot.get("elementId", "")) != title_slot_id
    ]
    if not title_candidates:
        return ""

    return str(max(title_candidates, key=template_slot_area).get("elementId", ""))


def template_slot_area(slot: dict[str, Any]) -> float:
    bounds = slot.get("bounds")
    if not isinstance(bounds, dict):
        return 0
    return max(0.0, float(bounds.get("width", 0))) * max(
        0.0,
        float(bounds.get("height", 0)),
    )


def is_toc_template_slide(template_slide: dict[str, Any] | None) -> bool:
    if not isinstance(template_slide, dict):
        return False
    if str(template_slide.get("slideRole", "")) == "toc":
        return True
    if str(template_slide.get("layoutType", "")) == "toc":
        return True

    slots = [slot for slot in template_slide.get("slots", []) if isinstance(slot, dict)]
    slot_roles = [str(slot.get("slotRole", "")) for slot in slots]
    content_roles = [
        role
        for role in slot_roles
        if role in {"title", "subtitle", "body", "caption", "label", "metric"}
    ]
    return "label" in slot_roles and "body" not in slot_roles and len(content_roles) >= 3


def deck_role_for_template_slot(slot_role: str) -> str:
    if slot_role in {"subtitle", "body", "caption"}:
        return slot_role
    if slot_role == "metric":
        return "highlight"
    return "caption"


def template_auxiliary_slot_text(
    slide_plan: SlidePlan,
    keyword_index: int,
) -> str:
    if keyword_index < len(slide_plan.keywords):
        return slide_plan.keywords[keyword_index]
    return ""


def replace_text_props(props: dict[str, Any], text: str) -> None:
    props["text"] = text
    props.pop("paragraphs", None)
    props.pop("runs", None)


def is_replaceable_content_slot(slot: Any) -> bool:
    if not isinstance(slot, dict):
        return False
    try:
        confidence = float(slot.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0
    return (
        slot.get("usage") == "content-slot"
        and slot.get("replaceMode") == "replace"
        and confidence >= 0.5
    )


def normalize_imported_element(
    element: dict[str, Any],
    order: int,
    index: int,
) -> dict[str, Any]:
    cloned = deepcopy(element)
    element_type = str(cloned.get("type", "rect"))
    cloned["elementId"] = f"el_{order}_imported_{index}_{element_type}"
    cloned["x"] = max(0, int(cloned.get("x", 0)))
    cloned["y"] = max(0, int(cloned.get("y", 0)))
    cloned["width"] = max(1, int(cloned.get("width", 1)))
    cloned["height"] = max(1, int(cloned.get("height", 1)))
    cloned["rotation"] = float(cloned.get("rotation", 0))
    cloned["opacity"] = max(0, min(1, float(cloned.get("opacity", 1))))
    cloned["zIndex"] = max(0, int(cloned.get("zIndex", index)))
    cloned["locked"] = bool(cloned.get("locked", False))
    cloned["visible"] = bool(cloned.get("visible", True))
    if not isinstance(cloned.get("props"), dict):
        cloned["props"] = {}
    return cloned


def inject_imported_text(
    elements: list[dict[str, Any]],
    slide_plan: SlidePlan,
    theme: dict[str, Any],
) -> None:
    text_elements = [
        element for element in elements if element.get("type") == "text"
    ]
    text_elements.sort(
        key=lambda element: (
            0 if element.get("role") == "title" else 1,
            int(element.get("y", 0)),
            -int(element.get("props", {}).get("fontSize", 0)),
        )
    )
    for index, element in enumerate(text_elements):
        props = element["props"]
        if index == 0:
            element["role"] = "title"
            props["text"] = slide_plan.title
        elif index == 1:
            element["role"] = "body"
            props["text"] = slide_plan.message
        else:
            element["role"] = "caption"
            props["text"] = (
                slide_plan.keywords[index - 2]
                if index - 2 < len(slide_plan.keywords)
                else ""
            )


def assemble_process_cards_slide(
    raw_input: RawInput,
    slide_plan: SlidePlan,
    theme: dict[str, Any],
) -> dict[str, Any]:
    style_pack = select_style_pack(raw_input, [slide_plan]) or {}
    slide_preset = (
        registry_item(
            SLIDE_PRESET_REGISTRY,
            "process-cards-horizontal-6",
        )
        or {}
    )
    elements = process_cards_elements(slide_plan, theme, style_pack)
    elements = cap_elements(
        elements,
        limit=int(slide_preset.get("maxElements", 64)),
    )
    return {
        "slideId": f"slide_{slide_plan.order}",
        "order": slide_plan.order,
        "title": slide_plan.title,
        "thumbnailUrl": "",
        "style": {
            "layout": str(slide_preset.get("layout", "title-content")),
            "backgroundColor": theme["backgroundColor"],
            "textColor": theme["textColor"],
            "accentColor": theme["accentColor"],
        },
        "speakerNotes": slide_plan.speaker_notes,
        "elements": elements,
        "keywords": [
            {
                "keywordId": f"kw_{slide_plan.order}_{index}",
                "text": keyword,
                "synonyms": [],
                "abbreviations": [],
            }
            for index, keyword in enumerate(slide_plan.keywords, start=1)
        ],
        "aiNotes": {
            "emphasisPoints": [slide_plan.message],
            "sourceEvidence": [
                evidence.model_dump(by_alias=True) for evidence in slide_plan.evidence
            ],
        },
    }


def process_cards_elements(
    slide_plan: SlidePlan,
    theme: dict[str, Any],
    style_pack: dict[str, Any],
) -> list[dict[str, Any]]:
    card_style = style_pack.get("card", {})
    callout_style = style_pack.get("callout", {})
    labels = diagram_labels(slide_plan, 6)
    bodies = process_card_bodies(slide_plan, labels)
    card_width = 242
    card_height = 458
    card_gap = 45
    card_y = 320
    card_x = 120
    badge_size = 44
    elements: list[dict[str, Any]] = [
        shape_element(
            slide_plan.order,
            "top_gradient_dark",
            "background",
            0,
            0,
            CANVAS.width,
            34,
            0,
            str(style_pack.get("topBand", {}).get("dark", theme["accentColor"])),
            "transparent",
        ),
        shape_element(
            slide_plan.order,
            "top_gradient_light",
            "background",
            0,
            34,
            CANVAS.width,
            116,
            0,
            str(style_pack.get("topBand", {}).get("light", theme["palette"]["muted"])),
            "transparent",
        ),
        shape_element(
            slide_plan.order,
            "section_label_card",
            "decoration",
            94,
            26,
            790,
            112,
            1,
            theme["palette"]["surface"],
            "transparent",
            int(card_style.get("borderRadius", 28)),
        ),
        text_element(
            slide_plan.order,
            "section_label",
            "caption",
            f"step {slide_plan.order}.",
            134,
            52,
            220,
            32,
            2,
            theme["accentColor"],
            theme["typography"]["captionSize"] + 4,
            "bold",
            theme["typography"]["headingFontFamily"],
        ),
        text_element(
            slide_plan.order,
            "section_heading",
            "caption",
            slide_plan.slide_type.replace("-", " ").title(),
            130,
            92,
            620,
            40,
            2,
            theme["textColor"],
            theme["typography"]["headingSize"] - 4,
            "bold",
            theme["typography"]["headingFontFamily"],
        ),
        text_element(
            slide_plan.order,
            "title",
            "title",
            slide_plan.title,
            610,
            170,
            720,
            72,
            3,
            theme["accentColor"],
            theme["typography"]["titleSize"] - 10,
            "bold",
            theme["typography"]["headingFontFamily"],
        ),
        text_element(
            slide_plan.order,
            "subtitle",
            "subtitle",
            slide_plan.message,
            226,
            258,
            1468,
            46,
            3,
            str(style_pack.get("subtitleColor", "#6b7280")),
            theme["typography"]["headingSize"] - 6,
            "normal",
            theme["typography"]["bodyFontFamily"],
        ),
    ]

    for index, label in enumerate(labels):
        x = card_x + index * (card_width + card_gap)
        badge_x = x + card_width // 2 - badge_size // 2
        icon_name = icon_name_for_keyword(label)
        elements.extend(
            [
                shape_element(
                    slide_plan.order,
                    f"process_card_{index + 1}",
                    "highlight",
                    x,
                    card_y,
                    card_width,
                    card_height,
                    3,
                    str(card_style.get("fill", theme["palette"]["surface"])),
                    str(card_style.get("stroke", theme["palette"]["border"])),
                    int(card_style.get("borderRadius", 8)),
                ),
                shape_element(
                    slide_plan.order,
                    f"process_badge_{index + 1}",
                    "decoration",
                    badge_x,
                    card_y + 10,
                    badge_size,
                    badge_size,
                    6,
                    theme["accentColor"],
                    "transparent",
                    element_type="ellipse",
                ),
                text_element(
                    slide_plan.order,
                    f"process_badge_{index + 1}_label",
                    "caption",
                    str(index + 1),
                    badge_x + 15,
                    card_y + 20,
                    18,
                    24,
                    7,
                    theme["palette"]["surface"],
                    theme["typography"]["captionSize"],
                    "bold",
                    theme["typography"]["headingFontFamily"],
                ),
                icon_element(
                    slide_plan.order,
                    f"process_card_{index + 1}_icon",
                    icon_name,
                    x + card_width // 2 - 30,
                    card_y + 86,
                    60,
                    60,
                    6,
                    theme["accentColor"],
                ),
                text_element(
                    slide_plan.order,
                    f"process_card_{index + 1}_title",
                    "highlight",
                    label,
                    x + 22,
                    card_y + 178,
                    card_width - 44,
                    58,
                    6,
                    theme["accentColor"],
                    theme["typography"]["bodySize"] + 1,
                    "bold",
                    theme["typography"]["headingFontFamily"],
                ),
                text_element(
                    slide_plan.order,
                    f"process_card_{index + 1}_body",
                    "body",
                    bodies[index],
                    x + 24,
                    card_y + 250,
                    card_width - 48,
                    150,
                    6,
                    str(style_pack.get("bodyColor", "#5f6368")),
                    theme["typography"]["captionSize"] + 7,
                    "normal",
                    theme["typography"]["bodyFontFamily"],
                ),
            ]
        )
        if index < len(labels) - 1:
            elements.append(
                shape_element(
                    slide_plan.order,
                    f"process_arrow_{index + 1}",
                    "decoration",
                    x + card_width + 8,
                    card_y + 116,
                    card_gap - 16,
                    34,
                    4,
                    theme["accentColor"],
                    "transparent",
                    element_type="arrow",
                )
            )

    callout_y = 860
    elements.extend(
        [
            shape_element(
                slide_plan.order,
                "process_callout",
                "highlight",
                64,
                callout_y,
                1818,
                112,
                4,
                str(callout_style.get("fill", theme["palette"]["surface"])),
                str(callout_style.get("stroke", theme["palette"]["border"])),
                int(callout_style.get("borderRadius", 8)),
            ),
            text_element(
                slide_plan.order,
                "process_callout_text",
                "highlight",
                slide_plan.visual_intent.emphasis or slide_plan.message,
                122,
                callout_y + 34,
                1690,
                48,
                5,
                str(callout_style.get("text", theme["accentColor"])),
                theme["typography"]["headingSize"],
                "bold",
                theme["typography"]["headingFontFamily"],
            ),
            text_element(
                slide_plan.order,
                "page_number",
                "footer",
                str(slide_plan.order),
                1838,
                1006,
                34,
                30,
                6,
                theme["accentColor"],
                theme["typography"]["captionSize"] + 4,
                "bold",
                theme["typography"]["headingFontFamily"],
            ),
        ]
    )
    card_shadow = style_pack.get("effects", {}).get("shadow")
    if isinstance(card_shadow, dict):
        for element in elements:
            if (
                element["elementId"].startswith(f"el_{slide_plan.order}_process_card_")
                and element["type"] == "rect"
            ):
                element["props"]["shadow"] = card_shadow
    return elements


def process_card_bodies(slide_plan: SlidePlan, labels: list[str]) -> list[str]:
    message_parts = [
        part.strip(" -")
        for part in re.split(r"[\n,;/]+", slide_plan.message)
        if part.strip(" -")
    ]
    bodies: list[str] = []
    for index, label in enumerate(labels):
        icon_name = icon_name_for_keyword(label)
        details = PROCESS_CARD_DETAIL_BY_ICON.get(icon_name, ())
        if index < len(message_parts):
            bodies.append(f"- {message_parts[index]}")
        elif details:
            bodies.append("\n".join(f"- {detail}" for detail in details))
        else:
            bodies.append(f"- {label}\n- editable step")
    return bodies


ICON_PATHS: dict[str, str] = {
    "download-tray": "M14 44 L50 44 L50 54 L14 54 Z M32 10 L32 36 M22 26 L32 36 L42 26",
    "network-nodes": "M18 20 A8 8 0 1 0 18 36 A8 8 0 1 0 18 20 M46 16 A8 8 0 1 0 46 32 A8 8 0 1 0 46 16 M46 38 A8 8 0 1 0 46 54 A8 8 0 1 0 46 38 M26 28 L38 24 M26 32 L38 44",
    "pen-monitor": "M12 16 L52 16 L52 42 L12 42 Z M24 54 L40 54 M32 42 L32 54 M38 34 L50 22",
    "layout-grid": "M12 12 L52 12 L52 52 L12 52 Z M12 28 L52 28 M28 28 L28 52",
    "blocks": "M12 38 L24 38 L24 50 L12 50 Z M26 26 L38 26 L38 38 L26 38 Z M40 14 L52 14 L52 26 L40 26 Z M40 38 L52 38 L52 50 L40 50 Z",
    "document-check": "M18 10 L46 10 L54 18 L54 54 L18 54 Z M46 10 L46 18 L54 18 M26 36 L32 42 L46 28",
}
PROCESS_CARD_DETAIL_BY_ICON: dict[str, tuple[str, ...]] = {
    "download-tray": ("prompt", "schema", "references"),
    "network-nodes": ("content", "script", "keywords"),
    "pen-monitor": ("design prompt", "theme", "tone"),
    "layout-grid": ("preset score", "layout", "safe area"),
    "blocks": ("text", "cards", "media"),
    "document-check": ("schema check", "repair", "save"),
}


def icon_name_for_keyword(keyword: str) -> str:
    normalized = keyword.casefold()
    for token, icon_name in ICON_MAP.items():
        if token.casefold() in normalized:
            return icon_name
    return "document-check"


def icon_element(
    order: int,
    name: str,
    icon_name: str,
    x: int,
    y: int,
    width: int,
    height: int,
    z_index: int,
    stroke: str,
) -> dict[str, Any]:
    return custom_shape_element(
        order,
        name,
        "decoration",
        x,
        y,
        width,
        height,
        z_index,
        ICON_PATHS.get(icon_name, ICON_PATHS["document-check"]),
        64,
        64,
        "transparent",
        stroke,
        closed=False,
    )


def design_elements(
    slide_plan: SlidePlan,
    visual_plan: VisualPlan,
    theme: dict[str, Any],
) -> list[dict[str, Any]]:
    density = normalize_decoration_density(
        visual_plan.visual_intent.decoration_density,
    )
    emphasis_style = normalize_emphasis_style(
        visual_plan.visual_intent.emphasis_style,
    )
    composition = normalize_composition(visual_plan.visual_intent.composition)
    if (
        not emphasis_style
        and slide_plan.order == 1
        and slide_plan.keywords
        and not is_diagram_composition(composition)
    ):
        emphasis_style = "keyword-chips"
    if theme.get("name") == SIMPLE_BASIC_STYLE_PACK_ID:
        return simple_basic_design_elements(
            slide_plan,
            visual_plan,
            theme,
            emphasis_style,
        )
    if theme.get("name") == PRESENTATION_DOCUMENT_STYLE_PACK_ID:
        return presentation_document_design_elements(
            slide_plan,
            visual_plan,
            theme,
            emphasis_style,
        )
    if theme.get("name") == SUBMISSION_DOCUMENT_STYLE_PACK_ID:
        return submission_document_design_elements(slide_plan, visual_plan, theme)

    elements = [
        shape_element(
            slide_plan.order,
            "accent_rail",
            "decoration",
            0,
            0,
            34,
            CANVAS.height,
            1,
            theme["accentColor"],
            "transparent",
        ),
    ]

    if density in ("medium", "high"):
        elements.append(
            shape_element(
                slide_plan.order,
                "section_label_chip",
                "decoration",
                CANVAS.safe_x - 18,
                40,
                260,
                44,
                1,
                theme["palette"]["surface"],
                theme["palette"]["border"],
                22,
            )
        )
    elements.append(
        text_element(
            slide_plan.order,
            "section_label",
            "caption",
            visual_plan.slide_type.replace("-", " ").upper(),
            CANVAS.safe_x,
            50,
            220,
            24,
            2,
            theme["accentColor"],
            theme["typography"]["captionSize"],
            "bold",
            theme["typography"]["headingFontFamily"],
        )
    )

    if density == "high":
        elements.extend(
            [
                shape_element(
                    slide_plan.order,
                    "top_stripe",
                    "decoration",
                    0,
                    0,
                    CANVAS.width,
                    18,
                    1,
                    theme["palette"]["secondary"],
                    "transparent",
                ),
                shape_element(
                    slide_plan.order,
                    "diagonal_block",
                    "decoration",
                    1460,
                    86,
                    360,
                    84,
                    1,
                    theme["palette"]["border"],
                    "transparent",
                    0,
                    16,
                ),
            ]
        )

    metric_card_caption = visual_plan.visual_intent.metric_card_caption.strip()
    if (
        metric_card_caption
        and visual_plan.slot_preset in {"metric_cards", "big_number_focus"}
    ):
        card_x = 1028
        card_y = 246
        card_width = 700
        card_height = 500
        card_z_index = 2
        elements.extend(
            [
                shape_element(
                    slide_plan.order,
                    "metric_card",
                    "decoration",
                    card_x,
                    card_y,
                    card_width,
                    card_height,
                    card_z_index,
                    theme["palette"]["surface"],
                    theme["palette"]["border"],
                    8,
                ),
                text_element(
                    slide_plan.order,
                    "metric_card_caption",
                    "caption",
                    metric_card_caption,
                    card_x + 44,
                    card_y + 44,
                    card_width - 88,
                    card_height - 88,
                    card_z_index + 1,
                    theme["textColor"],
                    theme["typography"]["bodySize"],
                    "bold",
                    theme["typography"]["headingFontFamily"],
                ),
            ]
        )
    if visual_plan.layout_variant == "comparison":
        elements.append(
            shape_element(
                slide_plan.order,
                "comparison_divider",
                "decoration",
                930,
                250,
                3,
                520,
                2,
                theme["accentColor"],
                "transparent",
            )
        )
    if visual_plan.layout_variant == "quote":
        elements.append(
            shape_element(
                slide_plan.order,
                "quote_block",
                "decoration",
                250,
                280,
                1420,
                440,
                2,
                theme["palette"]["surface"],
                theme["palette"]["border"],
                8,
            )
        )

    elements.extend(diagram_elements(slide_plan, composition, theme))

    if emphasis_style == "keyword-chips" and slide_plan.order == 1:
        elements.extend(keyword_chip_elements(slide_plan, theme))

    return elements


def simple_basic_design_elements(
    slide_plan: SlidePlan,
    visual_plan: VisualPlan,
    theme: dict[str, Any],
    emphasis_style: str,
) -> list[dict[str, Any]]:
    layout = compose_layout(visual_plan)
    slot_by_role = {slot.role: slot for slot in layout.slots}
    title_slot = slot_by_role.get("title")
    body_slot = slot_by_role.get("body")
    divider_x = title_slot.x if title_slot else CANVAS.safe_x
    divider_y = (
        min(
            body_slot.y - 42,
            title_slot.y + title_slot.height + 24,
        )
        if title_slot and body_slot
        else CANVAS.safe_y + 154
    )
    panel_slot = body_slot or slot_by_role.get("highlight")
    elements: list[dict[str, Any]] = [
        shape_element(
            slide_plan.order,
            "simple_basic_top_stripe",
            "decoration",
            0,
            0,
            CANVAS.width,
            6,
            1,
            theme["accentColor"],
            "transparent",
        ),
        shape_element(
            slide_plan.order,
            "simple_basic_side_rule",
            "decoration",
            CANVAS.safe_x - 28,
            CANVAS.safe_y,
            3,
            CANVAS.safe_height,
            1,
            theme["palette"]["border"],
            "transparent",
        ),
        text_element(
            slide_plan.order,
            "section_label",
            "caption",
            visual_plan.slide_type.replace("-", " ").upper(),
            CANVAS.safe_x,
            50,
            220,
            24,
            2,
            theme["palette"]["secondary"],
            theme["typography"]["captionSize"],
            "bold",
            theme["typography"]["headingFontFamily"],
        ),
        shape_element(
            slide_plan.order,
            "simple_basic_title_divider",
            "decoration",
            divider_x,
            max(0, divider_y),
            56,
            4,
            2,
            theme["accentColor"],
            "transparent",
        ),
    ]
    if panel_slot is not None and visual_plan.slot_preset != "title_full_bleed_image":
        elements.append(
            shape_element(
                slide_plan.order,
                "simple_basic_content_box",
                "decoration",
                max(0, panel_slot.x - 28),
                max(0, panel_slot.y - 24),
                min(CANVAS.width - panel_slot.x + 28, panel_slot.width + 56),
                min(CANVAS.height - panel_slot.y + 24, panel_slot.height + 48),
                2,
                theme["palette"]["muted"],
                theme["palette"]["border"],
                8,
            )
        )
    if slide_plan.keywords:
        elements.extend(simple_basic_badge_elements(slide_plan, theme, panel_slot))
    if emphasis_style == "keyword-chips" and slide_plan.order == 1:
        elements.extend(keyword_chip_elements(slide_plan, theme))
    elements.extend(
        diagram_elements(
            slide_plan,
            normalize_composition(visual_plan.visual_intent.composition),
            theme,
        )
    )
    return elements


def simple_basic_badge_elements(
    slide_plan: SlidePlan,
    theme: dict[str, Any],
    panel_slot: LayoutSlot | None,
) -> list[dict[str, Any]]:
    x = (panel_slot.x if panel_slot else CANVAS.safe_x) + 8
    y = (
        min(CANVAS.height - 166, panel_slot.y + panel_slot.height + 34)
        if panel_slot
        else 792
    )
    elements: list[dict[str, Any]] = []
    for index, keyword in enumerate(slide_plan.keywords[:3]):
        badge_x = x + index * 238
        elements.extend(
            [
                shape_element(
                    slide_plan.order,
                    f"simple_basic_badge_{index + 1}",
                    "decoration",
                    badge_x,
                    y,
                    44,
                    44,
                    4,
                    theme["accentColor"],
                    "transparent",
                    element_type="ellipse",
                ),
                text_element(
                    slide_plan.order,
                    f"simple_basic_badge_{index + 1}_number",
                    "caption",
                    f"{index + 1}",
                    badge_x + 14,
                    y + 10,
                    18,
                    20,
                    5,
                    "#ffffff",
                    theme["typography"]["captionSize"],
                    "bold",
                    theme["typography"]["headingFontFamily"],
                ),
                text_element(
                    slide_plan.order,
                    f"simple_basic_badge_{index + 1}_label",
                    "caption",
                    keyword,
                    badge_x + 58,
                    y + 9,
                    150,
                    26,
                    5,
                    theme["textColor"],
                    theme["typography"]["captionSize"],
                    "medium",
                    theme["typography"]["bodyFontFamily"],
                ),
            ]
        )
    return elements


def presentation_document_design_elements(
    slide_plan: SlidePlan,
    visual_plan: VisualPlan,
    theme: dict[str, Any],
    emphasis_style: str,
) -> list[dict[str, Any]]:
    layout = compose_layout(visual_plan)
    slot_by_role = {slot.role: slot for slot in layout.slots}
    title_slot = slot_by_role.get("title")
    body_slot = slot_by_role.get("body")
    title_x = title_slot.x if title_slot else CANVAS.safe_x
    title_y = title_slot.y if title_slot else CANVAS.safe_y
    body_y = body_slot.y if body_slot else 330
    elements: list[dict[str, Any]] = [
        shape_element(
            slide_plan.order,
            "presentation_top_band",
            "decoration",
            0,
            0,
            CANVAS.width,
            22,
            1,
            theme["accentColor"],
            "transparent",
        ),
        shape_element(
            slide_plan.order,
            "presentation_focus_panel",
            "decoration",
            1280,
            148,
            420,
            620,
            1,
            theme["palette"]["muted"],
            "transparent",
            8,
        ),
        shape_element(
            slide_plan.order,
            "presentation_title_mark",
            "decoration",
            max(0, title_x - 34),
            title_y + 16,
            14,
            92,
            2,
            theme["accentColor"],
            "transparent",
            7,
        ),
        text_element(
            slide_plan.order,
            "presentation_slide_number",
            "caption",
            f"{slide_plan.order:02d}",
            1430,
            800,
            240,
            110,
            2,
            theme["accentColor"],
            82,
            "bold",
            theme["typography"]["headingFontFamily"],
        ),
        shape_element(
            slide_plan.order,
            "presentation_message_rule",
            "decoration",
            title_x,
            max(0, min(body_y - 38, title_y + 156)),
            120,
            8,
            2,
            theme["palette"]["secondary"],
            "transparent",
            4,
        ),
    ]
    if slide_plan.keywords:
        elements.extend(
            presentation_keyword_dot_elements(slide_plan, theme, body_slot)
        )
    if emphasis_style == "keyword-chips" and slide_plan.order == 1:
        elements.extend(keyword_chip_elements(slide_plan, theme))
    return elements


def presentation_keyword_dot_elements(
    slide_plan: SlidePlan,
    theme: dict[str, Any],
    body_slot: LayoutSlot | None,
) -> list[dict[str, Any]]:
    x = body_slot.x if body_slot else CANVAS.safe_x
    y = min(
        CANVAS.height - 138,
        (body_slot.y + body_slot.height + 36) if body_slot else 790,
    )
    elements: list[dict[str, Any]] = []
    for index, keyword in enumerate(slide_plan.keywords[:3]):
        dot_x = x + index * 286
        elements.extend(
            [
                shape_element(
                    slide_plan.order,
                    f"presentation_keyword_dot_{index + 1}",
                    "decoration",
                    dot_x,
                    y,
                    18,
                    18,
                    4,
                    theme["accentColor"],
                    "transparent",
                    element_type="ellipse",
                ),
                text_element(
                    slide_plan.order,
                    f"presentation_keyword_label_{index + 1}",
                    "caption",
                    keyword,
                    dot_x + 32,
                    y - 5,
                    220,
                    28,
                    5,
                    theme["textColor"],
                    theme["typography"]["captionSize"] + 3,
                    "bold",
                    theme["typography"]["bodyFontFamily"],
                ),
            ]
        )
    return elements


def submission_document_design_elements(
    slide_plan: SlidePlan,
    visual_plan: VisualPlan,
    theme: dict[str, Any],
) -> list[dict[str, Any]]:
    layout = compose_layout(visual_plan)
    slot_by_role = {slot.role: slot for slot in layout.slots}
    title_slot = slot_by_role.get("title")
    body_slot = slot_by_role.get("body")
    panel_slot = body_slot or slot_by_role.get("highlight")
    title_x = title_slot.x if title_slot else CANVAS.safe_x
    title_y = title_slot.y if title_slot else CANVAS.safe_y
    panel_x = max(0, (panel_slot.x if panel_slot else CANVAS.safe_x) - 30)
    panel_y = max(128, (panel_slot.y if panel_slot else 248) - 24)
    panel_width = min(
        CANVAS.width - panel_x - 120,
        (panel_slot.width if panel_slot else CANVAS.safe_width) + 60,
    )
    panel_height = min(
        CANVAS.height - panel_y - 130,
        (panel_slot.height if panel_slot else 420) + 72,
    )
    elements: list[dict[str, Any]] = [
        shape_element(
            slide_plan.order,
            "submission_header_band",
            "decoration",
            0,
            0,
            CANVAS.width,
            72,
            1,
            theme["palette"]["surface"],
            theme["palette"]["border"],
        ),
        shape_element(
            slide_plan.order,
            "submission_header_rule",
            "decoration",
            0,
            72,
            CANVAS.width,
            5,
            2,
            theme["accentColor"],
            "transparent",
        ),
        text_element(
            slide_plan.order,
            "submission_section_label",
            "caption",
            f"{slide_plan.order:02d} / {visual_plan.slide_type.upper()}",
            CANVAS.safe_x,
            26,
            360,
            26,
            3,
            theme["palette"]["secondary"],
            theme["typography"]["captionSize"],
            "bold",
            theme["typography"]["headingFontFamily"],
        ),
        shape_element(
            slide_plan.order,
            "submission_title_rule",
            "decoration",
            title_x,
            max(88, title_y + 136),
            320,
            3,
            2,
            theme["palette"]["border"],
            "transparent",
        ),
        shape_element(
            slide_plan.order,
            "submission_content_panel",
            "decoration",
            panel_x,
            panel_y,
            panel_width,
            panel_height,
            1,
            theme["palette"]["surface"],
            theme["palette"]["border"],
            6,
        ),
    ]
    elements.extend(
        submission_grid_line_elements(
            slide_plan,
            theme,
            panel_x,
            panel_y,
            panel_width,
            panel_height,
        )
    )
    if slide_plan.keywords:
        elements.extend(submission_evidence_chip_elements(slide_plan, theme))
    return elements


def submission_grid_line_elements(
    slide_plan: SlidePlan,
    theme: dict[str, Any],
    panel_x: int,
    panel_y: int,
    panel_width: int,
    panel_height: int,
) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for index in range(1, 4):
        y = panel_y + index * panel_height // 4
        lines.append(
            shape_element(
                slide_plan.order,
                f"submission_grid_line_{index}",
                "decoration",
                panel_x + 28,
                y,
                max(0, panel_width - 56),
                2,
                2,
                theme["palette"]["border"],
                "transparent",
            )
        )
    return lines


def submission_evidence_chip_elements(
    slide_plan: SlidePlan,
    theme: dict[str, Any],
) -> list[dict[str, Any]]:
    elements: list[dict[str, Any]] = []
    for index, keyword in enumerate(slide_plan.keywords[:3]):
        chip_x = CANVAS.safe_x + index * 336
        elements.extend(
            [
                shape_element(
                    slide_plan.order,
                    f"submission_evidence_chip_{index + 1}",
                    "decoration",
                    chip_x,
                    910,
                    294,
                    52,
                    3,
                    theme["palette"]["muted"],
                    theme["palette"]["border"],
                    6,
                ),
                text_element(
                    slide_plan.order,
                    f"submission_evidence_label_{index + 1}",
                    "caption",
                    keyword,
                    chip_x + 22,
                    924,
                    250,
                    24,
                    4,
                    theme["textColor"],
                    theme["typography"]["captionSize"],
                    "bold",
                    theme["typography"]["bodyFontFamily"],
                ),
            ]
        )
    return elements


def is_diagram_composition(composition: str) -> bool:
    return composition in {"process", "radial", "bubble"}


def diagram_elements(
    slide_plan: SlidePlan,
    composition: str,
    theme: dict[str, Any],
) -> list[dict[str, Any]]:
    if composition == "process":
        return process_diagram_elements(slide_plan, theme)
    if composition == "radial":
        return radial_diagram_elements(slide_plan, theme)
    if composition == "bubble":
        return bubble_diagram_elements(slide_plan, theme)
    return []


def diagram_labels(slide_plan: SlidePlan, count: int) -> list[str]:
    labels = [keyword.strip() for keyword in slide_plan.keywords if keyword.strip()]
    while len(labels) < count:
        labels.append(f"STEP {len(labels) + 1}")
    return labels[:count]


def process_diagram_elements(
    slide_plan: SlidePlan,
    theme: dict[str, Any],
) -> list[dict[str, Any]]:
    labels = diagram_labels(slide_plan, 4)
    elements: list[dict[str, Any]] = []
    for index, label in enumerate(labels):
        x = 210 + index * 380
        y = 790
        elements.extend(
            [
                custom_shape_element(
                    slide_plan.order,
                    f"process_step_{index + 1}",
                    "highlight",
                    x,
                    y,
                    320,
                    76,
                    4,
                    "M 0 0 L 270 0 L 320 38 L 270 76 L 0 76 L 48 38 Z",
                    320,
                    76,
                    theme["palette"]["surface"],
                    theme["accentColor"],
                ),
                text_element(
                    slide_plan.order,
                    f"process_step_{index + 1}_label",
                    "highlight",
                    label,
                    x + 42,
                    y + 22,
                    220,
                    32,
                    5,
                    theme["textColor"],
                    theme["typography"]["captionSize"] + 4,
                    "bold",
                    theme["typography"]["headingFontFamily"],
                ),
            ]
        )
    return elements


def radial_diagram_elements(
    slide_plan: SlidePlan,
    theme: dict[str, Any],
) -> list[dict[str, Any]]:
    labels = diagram_labels(slide_plan, 4)
    elements = [
        shape_element(
            slide_plan.order,
            "radial_hub",
            "highlight",
            840,
            648,
            240,
            240,
            4,
            theme["palette"]["surface"],
            theme["accentColor"],
            element_type="ellipse",
        )
    ]
    positions = [(540, 628), (1140, 628), (660, 820), (1020, 820)]
    for index, (x, y) in enumerate(positions):
        elements.extend(
            [
                shape_element(
                    slide_plan.order,
                    f"radial_node_{index + 1}",
                    "highlight",
                    x,
                    y,
                    190,
                    112,
                    5,
                    theme["palette"]["muted"],
                    theme["accentColor"],
                    element_type="ellipse",
                ),
                text_element(
                    slide_plan.order,
                    f"radial_node_{index + 1}_label",
                    "highlight",
                    labels[index],
                    x + 28,
                    y + 39,
                    134,
                    34,
                    6,
                    theme["textColor"],
                    theme["typography"]["captionSize"] + 3,
                    "bold",
                    theme["typography"]["bodyFontFamily"],
                ),
            ]
        )
    return elements


def bubble_diagram_elements(
    slide_plan: SlidePlan,
    theme: dict[str, Any],
) -> list[dict[str, Any]]:
    labels = diagram_labels(slide_plan, 5)
    positions = [
        (470, 660, 220),
        (750, 604, 250),
        (1050, 664, 220),
        (680, 820, 210),
        (980, 820, 210),
    ]
    elements: list[dict[str, Any]] = []
    for index, (x, y, size) in enumerate(positions):
        elements.extend(
            [
                shape_element(
                    slide_plan.order,
                    f"bubble_{index + 1}",
                    "highlight",
                    x,
                    y,
                    size,
                    size,
                    4,
                    theme["palette"]["surface"],
                    theme["accentColor"],
                    element_type="ellipse",
                ),
                text_element(
                    slide_plan.order,
                    f"bubble_{index + 1}_label",
                    "highlight",
                    labels[index],
                    x + 36,
                    y + size // 2 - 18,
                    size - 72,
                    36,
                    5,
                    theme["textColor"],
                    theme["typography"]["captionSize"] + 3,
                    "bold",
                    theme["typography"]["bodyFontFamily"],
                ),
            ]
        )
    return elements


def normalize_decoration_density(value: str) -> str:
    normalized = value.strip().casefold()
    if normalized in {"none", "minimal", "low"}:
        return "low"
    if normalized in {"high", "rich", "dense", "decorative"}:
        return "high"
    return "medium"


def normalize_emphasis_style(value: str) -> str:
    normalized = value.strip().casefold()
    if has_any(
        normalized,
        ["chip", "keyword", "키워드", "강조", "칩", "하이라이트"],
    ):
        return "keyword-chips"
    return ""


def keyword_chip_elements(
    slide_plan: SlidePlan,
    theme: dict[str, Any],
) -> list[dict[str, Any]]:
    elements: list[dict[str, Any]] = []
    for index, keyword in enumerate(slide_plan.keywords[:3]):
        width = min(260, max(144, 42 + len(keyword) * 12))
        x = CANVAS.safe_x + index * 286
        y = 870
        elements.extend(
            [
                shape_element(
                    slide_plan.order,
                    f"keyword_chip_{index + 1}",
                    "decoration",
                    x,
                    y,
                    width,
                    52,
                    4,
                    theme["palette"]["surface"],
                    theme["accentColor"],
                    26,
                ),
                text_element(
                    slide_plan.order,
                    f"keyword_chip_{index + 1}_text",
                    "caption",
                    keyword,
                    x + 20,
                    y + 13,
                    width - 40,
                    26,
                    5,
                    theme["accentColor"],
                    theme["typography"]["captionSize"] + 2,
                    "bold",
                    theme["typography"]["bodyFontFamily"],
                ),
            ]
        )
    return elements


def media_elements(
    slide_plan: SlidePlan,
    visual_plan: VisualPlan,
    slot_by_role: dict[str, LayoutSlot],
    theme: dict[str, Any],
) -> list[dict[str, Any]]:
    media = visual_plan.media_intent
    if media.kind == "none":
        return []

    slot = slot_by_role.get("media") or slot_by_role.get("highlight")
    if slot is None:
        slot = LayoutSlot(role="media", x=1020, y=280, width=660, height=420, z_index=3)
    src = media.src.strip()
    if media.kind == "provided" and src:
        return [
            image_element(
                slide_plan.order,
                "media",
                "media",
                src,
                media.alt or media.caption or slide_plan.title,
                slot,
            )
        ]
    if media.kind == "provided" and not media.required:
        return []

    caption = media.caption or media.alt or "이미지 자리 표시자"
    rationale = media.rationale or media.prompt or "이미지 provider가 없어 자리 표시자를 사용했습니다."
    return [
        shape_element(
            slide_plan.order,
            "media_placeholder",
            "media",
            slot.x,
            slot.y,
            slot.width,
            slot.height,
            slot.z_index,
            theme["palette"]["muted"],
            theme["palette"]["border"],
            8,
        ),
        text_element(
            slide_plan.order,
            "media_placeholder_caption",
            "caption",
            f"{caption}\n{rationale}",
            slot.x + 44,
            slot.y + 44,
            max(120, slot.width - 88),
            max(80, slot.height - 88),
            slot.z_index + 1,
            theme["textColor"],
            theme["typography"]["captionSize"] + 4,
            "medium",
            theme["typography"]["bodyFontFamily"],
        ),
    ]


def element_for_intent(
    slide_plan: SlidePlan,
    intent: ElementIntent,
    slot: LayoutSlot,
    theme: dict[str, Any],
) -> dict[str, Any]:
    base = {
        "elementId": f"el_{slide_plan.order}_{intent.role}",
        "type": "text",
        "role": intent.role,
        "x": slot.x,
        "y": slot.y,
        "width": slot.width,
        "height": slot.height,
        "rotation": 0,
        "opacity": 1,
        "zIndex": slot.z_index,
        "locked": False,
        "visible": True,
    }
    if intent.role == "background":
        return {
            **base,
            "type": "rect",
            "locked": True,
            "props": {
                "fill": theme["palette"]["muted"],
                "stroke": "transparent",
                "strokeWidth": 0,
                "borderRadius": 0,
            },
        }
    if intent.role == "highlight":
        return {
            **base,
            "type": "rect",
            "props": {
                "fill": theme["palette"]["surface"],
                "stroke": theme["accentColor"],
                "strokeWidth": 3,
                "borderRadius": 8,
            },
        }
    if intent.role == "chart":
        return {
            **base,
            "type": "chart",
            "props": {
                "type": "bar",
                "title": intent.text,
                "data": [],
                "style": {
                    "colors": [theme["accentColor"], "#f59e0b"],
                    "showLegend": False,
                    "showGrid": True,
                },
            },
        }

    font_size = (
        theme["typography"]["titleSize"]
        if intent.role == "title"
        else theme["typography"]["bodySize"]
    )
    font_family = (
        theme["typography"]["headingFontFamily"]
        if intent.role == "title"
        else theme["typography"]["bodyFontFamily"]
    )
    if intent.role == "footer":
        font_size = theme["typography"]["captionSize"]
    return {
        **base,
        "props": {
            "text": intent.text,
            "fontFamily": font_family,
            "fontSize": font_size,
            "fontWeight": "bold" if intent.role == "title" else "normal",
            "color": theme["textColor"],
            "align": "left",
            "verticalAlign": "top",
            "lineHeight": 1.12 if intent.role == "title" else 1.22,
        },
    }


def shape_element(
    order: int,
    name: str,
    role: str,
    x: int,
    y: int,
    width: int,
    height: int,
    z_index: int,
    fill: str,
    stroke: str,
    border_radius: int = 0,
    rotation: int = 0,
    element_type: str = "rect",
) -> dict[str, Any]:
    return {
        "elementId": f"el_{order}_{name}",
        "type": element_type,
        "role": role,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "rotation": rotation,
        "opacity": 1,
        "zIndex": z_index,
        "locked": False,
        "visible": True,
        "props": {
            "fill": fill,
            "stroke": stroke,
            "strokeWidth": 0 if stroke == "transparent" else 2,
            "borderRadius": border_radius,
        },
    }


def custom_shape_element(
    order: int,
    name: str,
    role: str,
    x: int,
    y: int,
    width: int,
    height: int,
    z_index: int,
    path_data: str,
    view_box_width: int,
    view_box_height: int,
    fill: str,
    stroke: str,
    closed: bool = True,
) -> dict[str, Any]:
    return {
        "elementId": f"el_{order}_{name}",
        "type": "customShape",
        "role": role,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "rotation": 0,
        "opacity": 1,
        "zIndex": z_index,
        "locked": False,
        "visible": True,
        "props": {
            "pathData": path_data,
            "viewBoxWidth": view_box_width,
            "viewBoxHeight": view_box_height,
            "fill": fill,
            "stroke": stroke,
            "strokeWidth": 2,
            "closed": closed,
            "nodes": [],
        },
    }


def cap_elements(elements: list[dict[str, Any]], limit: int = 14) -> list[dict[str, Any]]:
    if len(elements) <= limit:
        return elements
    required = [element for element in elements if is_required_element(element)]
    priority = [
        element
        for element in elements
        if not is_required_element(element) and is_priority_element(element)
    ]
    optional = [
        element
        for element in elements
        if not is_required_element(element) and not is_priority_element(element)
    ]
    return [*required, *priority, *optional][:limit]


def is_required_element(element: dict[str, Any]) -> bool:
    return element.get("role") in {
        "background",
        "title",
        "subtitle",
        "body",
        "footer",
        "media",
        "chart",
    } or element.get("type") == "chart"


def is_priority_element(element: dict[str, Any]) -> bool:
    element_id = str(element.get("elementId", ""))
    return element.get("role") == "highlight" or any(
        token in element_id
        for token in (
            "keyword_chip",
            "process_step",
            "radial_",
            "bubble_",
            "metric_card",
            "simple_basic_",
            "top_stripe",
        )
    )


def image_element(
    order: int,
    name: str,
    role: str,
    src: str,
    alt: str,
    slot: LayoutSlot,
) -> dict[str, Any]:
    return {
        "elementId": f"el_{order}_{name}",
        "type": "image",
        "role": role,
        "x": slot.x,
        "y": slot.y,
        "width": slot.width,
        "height": slot.height,
        "rotation": 0,
        "opacity": 1,
        "zIndex": slot.z_index,
        "locked": False,
        "visible": True,
        "props": {
            "src": src,
            "alt": alt,
            "fit": "cover",
        },
    }


def text_element(
    order: int,
    name: str,
    role: str,
    text: str,
    x: int,
    y: int,
    width: int,
    height: int,
    z_index: int,
    color: str,
    font_size: int,
    font_weight: str,
    font_family: str = "Inter",
) -> dict[str, Any]:
    return {
        "elementId": f"el_{order}_{name}",
        "type": "text",
        "role": role,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "rotation": 0,
        "opacity": 1,
        "zIndex": z_index,
        "locked": False,
        "visible": True,
        "props": {
            "text": text,
            "fontFamily": font_family,
            "fontSize": font_size,
            "fontWeight": font_weight,
            "color": color,
            "align": "left",
            "verticalAlign": "top",
            "lineHeight": 1.15,
        },
    }


def validate_and_patch(deck: dict[str, Any]) -> tuple[dict[str, Any], ValidationResult]:
    layout_issues = validate_layout(deck)
    content_issues = validate_content(deck)
    design_issues = validate_design(deck)
    presentation_issues = validate_presentation(deck)
    issues = layout_issues + content_issues + presentation_issues
    if issues:
        deck = patch_deck(deck)
        layout_issues = validate_layout(deck)
        content_issues = validate_content(deck)
        design_issues = validate_design(deck)
        presentation_issues = validate_presentation(deck)

    return deck, ValidationResult(
        passed=not (
            layout_issues
            or content_issues
            or presentation_issues
        ),
        layoutIssues=layout_issues,
        contentIssues=content_issues,
        designIssues=design_issues,
        presentationIssues=presentation_issues,
    )


def validate_layout(deck: dict[str, Any]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for slide_index, slide in enumerate(deck["slides"]):
        elements = slide["elements"]
        if len(elements) > element_limit_for_slide(slide):
            issues.append(
                ValidationIssue(
                    scope="slide",
                    path=f"slides.{slide_index}.elements",
                    message="슬라이드 요소가 너무 많습니다.",
                )
            )
        for element_index, element in enumerate(elements):
            if element["width"] <= 0 or element["height"] <= 0:
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}",
                        message="요소의 너비와 높이는 0보다 커야 합니다.",
                    )
                )
            if element["x"] + element["width"] > CANVAS.width:
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}.x",
                        message="요소가 캔버스 너비를 벗어났습니다.",
                    )
                )
            if element["y"] + element["height"] > CANVAS.height:
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}.y",
                        message="요소가 캔버스 높이를 벗어났습니다.",
                    )
                )
    return issues


def element_limit_for_slide(slide: dict[str, Any]) -> int:
    process_prefix = f"el_{slide.get('order')}_process_card_"
    if is_imported_slide(slide):
        return 80
    if any(
        str(element.get("elementId", "")).startswith(process_prefix)
        for element in slide.get("elements", [])
    ):
        return 64
    return 14


def is_imported_slide(slide: dict[str, Any]) -> bool:
    order = slide.get("order")
    return any(
        is_imported_element(element, order)
        for element in slide.get("elements", [])
    )


def is_imported_element(element: dict[str, Any], order: Any | None = None) -> bool:
    element_id = str(element.get("elementId", ""))
    if order is not None:
        return element_id.startswith(f"el_{order}_imported_")
    return re.match(r"^el_\d+_imported_", element_id) is not None


def detect_text_overlap_candidates(deck: dict[str, Any]) -> list[TextOverlapCandidate]:
    candidates: list[TextOverlapCandidate] = []
    for slide_index, slide in enumerate(deck.get("slides", [])):
        text_elements = [
            (element_index, element)
            for element_index, element in enumerate(slide.get("elements", []))
            if is_readable_text_element(element)
        ]
        for left_index, (first_index, first) in enumerate(text_elements):
            for second_index, second in text_elements[left_index + 1 :]:
                ratio = text_overlap_ratio(first, second)
                if ratio < TEXT_OVERLAP_WARNING_RATIO:
                    continue

                candidates.append(
                    TextOverlapCandidate(
                        slide_index=slide_index,
                        slide_id=str(slide.get("slideId", "")),
                        first_element_index=first_index,
                        second_element_index=second_index,
                        first_element_id=str(first.get("elementId", "")),
                        second_element_id=str(second.get("elementId", "")),
                        overlap_ratio=ratio,
                    )
                )

    return candidates


def is_readable_text_element(element: dict[str, Any]) -> bool:
    if element.get("type") != "text":
        return False
    if element.get("visible") is False:
        return False
    if element.get("role") == "footer":
        return False

    props = element.get("props", {})
    return bool(str(props.get("text", "")).strip())


def text_overlap_ratio(first: dict[str, Any], second: dict[str, Any]) -> float:
    first_area = element_area(first)
    second_area = element_area(second)
    if first_area <= 0 or second_area <= 0:
        return 0

    left = max(float(first.get("x", 0)), float(second.get("x", 0)))
    top = max(float(first.get("y", 0)), float(second.get("y", 0)))
    right = min(
        float(first.get("x", 0)) + float(first.get("width", 0)),
        float(second.get("x", 0)) + float(second.get("width", 0)),
    )
    bottom = min(
        float(first.get("y", 0)) + float(first.get("height", 0)),
        float(second.get("y", 0)) + float(second.get("height", 0)),
    )
    overlap_width = max(0.0, right - left)
    overlap_height = max(0.0, bottom - top)
    return (overlap_width * overlap_height) / min(first_area, second_area)


def element_area(element: dict[str, Any]) -> float:
    return max(0.0, float(element.get("width", 0))) * max(
        0.0,
        float(element.get("height", 0)),
    )


def text_overlap_candidate_issues(
    candidates: list[TextOverlapCandidate],
) -> list[ValidationIssue]:
    best_by_slide: dict[int, TextOverlapCandidate] = {}
    for candidate in candidates:
        current = best_by_slide.get(candidate.slide_index)
        if current is None or candidate.overlap_ratio > current.overlap_ratio:
            best_by_slide[candidate.slide_index] = candidate

    return [
        ValidationIssue(
            scope="slide",
            path=f"slides.{candidate.slide_index}.elements",
            message=(
                "텍스트 요소가 겹쳐 읽기 어려울 수 있습니다: "
                f"{candidate.first_element_id}, {candidate.second_element_id}"
            ),
        )
        for candidate in best_by_slide.values()
    ]


def review_text_overlap_candidates(
    deck: dict[str, Any],
    candidates: list[TextOverlapCandidate],
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
    image_review_mode: ImageReviewMode = "auto",
) -> list[ValidationIssue]:
    if not candidates:
        return []

    fallback_issues = text_overlap_candidate_issues(candidates)
    if image_review_mode == "off" or (client is None and not api_key):
        return fallback_issues

    api_client = client
    if api_client is None:
        from openai import OpenAI

        api_client = OpenAI(api_key=api_key)

    groups = group_text_overlap_candidates(candidates)
    issues: list[ValidationIssue] = []
    for slide_index, slide_candidates in groups[:MAX_IMAGE_REVIEW_SLIDES]:
        try:
            slide = deck["slides"][slide_index]
            preview_png = render_slide_preview_png(deck, slide)
            review = review_slide_text_overlap(
                api_client,
                model=model,
                preview_png=preview_png,
                candidates=slide_candidates,
            )
        except Exception:
            return fallback_issues

        if review.unreadable:
            issues.append(text_overlap_review_issue(slide_candidates, review.reason))

    unreviewed_candidates = [
        candidate
        for _, slide_candidates in groups[MAX_IMAGE_REVIEW_SLIDES:]
        for candidate in slide_candidates
    ]
    issues.extend(text_overlap_candidate_issues(unreviewed_candidates))
    return issues


def group_text_overlap_candidates(
    candidates: list[TextOverlapCandidate],
) -> list[tuple[int, list[TextOverlapCandidate]]]:
    grouped: dict[int, list[TextOverlapCandidate]] = {}
    for candidate in candidates:
        grouped.setdefault(candidate.slide_index, []).append(candidate)
    return sorted(grouped.items())


def review_slide_text_overlap(
    client: Any,
    *,
    model: str | None,
    preview_png: bytes,
    candidates: list[TextOverlapCandidate],
) -> SlideTextOverlapReview:
    image_url = "data:image/png;base64," + base64.b64encode(preview_png).decode(
        "ascii"
    )
    response = client.responses.create(
        model=model or "gpt-4o-mini",
        instructions=TEXT_OVERLAP_REVIEW_INSTRUCTIONS,
        input=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": text_overlap_review_prompt(candidates),
                    },
                    {
                        "type": "input_image",
                        "image_url": image_url,
                    },
                ],
            }
        ],
        text=TEXT_OVERLAP_REVIEW_RESPONSE_FORMAT,
    )
    return SlideTextOverlapReview.model_validate_json(
        str(getattr(response, "output_text", "")).strip()
    )


def text_overlap_review_prompt(candidates: list[TextOverlapCandidate]) -> str:
    candidate_lines = [
        (
            f"- {candidate.first_element_id} vs {candidate.second_element_id}: "
            f"overlap_ratio={candidate.overlap_ratio:.2f}"
        )
        for candidate in candidates
    ]
    return "\n".join(
        [
            "Review whether these candidate text overlaps are actually unreadable.",
            "Candidates:",
            *candidate_lines,
        ]
    )


def text_overlap_review_issue(
    candidates: list[TextOverlapCandidate],
    reason: str,
) -> ValidationIssue:
    candidate = max(candidates, key=lambda item: item.overlap_ratio)
    message = "이미지 검증 결과 텍스트 겹침으로 읽기 어렵습니다."
    if reason.strip():
        message = f"{message} {reason.strip()[:160]}"
    return ValidationIssue(
        scope="slide",
        path=f"slides.{candidate.slide_index}.elements",
        message=message,
    )


def render_slide_preview_png(deck: dict[str, Any], slide: dict[str, Any]) -> bytes:
    from PIL import Image, ImageDraw

    canvas = deck.get("canvas", {})
    width = int(canvas.get("width") or CANVAS.width)
    height = int(canvas.get("height") or CANVAS.height)
    theme = deck.get("theme", {})
    slide_style = slide.get("style", {})
    background = preview_color(
        slide_style.get("backgroundColor") or theme.get("backgroundColor"),
        "#ffffff",
    ) or "#ffffff"
    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)

    for element in sorted(
        slide.get("elements", []),
        key=lambda item: int(item.get("zIndex", 0)),
    ):
        if element.get("visible") is False:
            continue

        render_preview_element(draw, element, theme)

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_preview_element(
    draw: Any,
    element: dict[str, Any],
    theme: dict[str, Any],
) -> None:
    left = float(element.get("x", 0))
    top = float(element.get("y", 0))
    right = left + float(element.get("width", 0))
    bottom = top + float(element.get("height", 0))
    props = element.get("props", {})
    element_type = element.get("type")

    if element_type in {"rect", "ellipse", "polygon", "star", "ring", "customShape"}:
        fill = preview_color(props.get("fill"), "transparent")
        outline = preview_color(props.get("stroke"), "transparent")
        stroke_width = max(1, int(props.get("strokeWidth") or 1))
        if element_type == "ellipse":
            draw.ellipse(
                [left, top, right, bottom],
                fill=fill,
                outline=outline,
                width=stroke_width,
            )
        else:
            draw.rectangle(
                [left, top, right, bottom],
                fill=fill,
                outline=outline,
                width=stroke_width,
            )
        return

    if element_type in {"image", "chart"}:
        draw.rectangle([left, top, right, bottom], fill="#e5e7eb", outline="#94a3b8")
        return

    if element_type != "text":
        return

    font_size = max(8, int(props.get("fontSize") or 24))
    text = str(props.get("text", ""))
    if not text.strip():
        return

    font = preview_font(font_size)
    color = preview_color(
        props.get("color") or theme.get("textColor"),
        "#111827",
    ) or "#111827"
    draw.multiline_text(
        (left, top),
        wrap_preview_text(text, font_size, max(1.0, right - left)),
        fill=color,
        font=font,
        spacing=max(2, int(font_size * 0.18)),
    )


def preview_font(font_size: int) -> Any:
    from PIL import ImageFont

    for font_name in ("malgun.ttf", "DejaVuSans.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(font_name, font_size)
        except OSError:
            continue
    return ImageFont.load_default()


def wrap_preview_text(text: str, font_size: int, width: float) -> str:
    max_chars = max(1, int(width / max(1.0, font_size * 0.55)))
    return "\n".join(textwrap.wrap(text, width=max_chars)[:8])


def preview_color(value: Any, fallback: str) -> str | None:
    from PIL import ImageColor

    color = value if isinstance(value, str) and value else fallback
    if color == "transparent":
        return None
    try:
        ImageColor.getrgb(color)
    except ValueError:
        color = fallback
    return None if color == "transparent" else color


def validate_content(deck: dict[str, Any]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    topic = deck["metadata"]["createdFrom"]["topic"]
    if topic not in deck["title"]:
        issues.append(
            ValidationIssue(
                scope="deck",
                path="title",
                message="덱 제목에는 생성 주제가 포함되어야 합니다.",
            )
        )
    for slide_index, slide in enumerate(deck["slides"]):
        if not slide["title"].strip():
            issues.append(
                ValidationIssue(
                    scope="slide",
                    path=f"slides.{slide_index}.title",
                    message="슬라이드 제목은 비어 있을 수 없습니다.",
                )
            )
        if not slide["speakerNotes"]:
            issues.append(
                ValidationIssue(
                    scope="slide",
                    path=f"slides.{slide_index}.speakerNotes",
                    message="발표자 노트가 필요합니다.",
                )
            )
    return issues


def validate_design(deck: dict[str, Any]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for slide_index, slide in enumerate(deck["slides"]):
        elements = slide["elements"]
        background_color = slide.get("style", {}).get(
            "backgroundColor",
            deck.get("theme", {}).get("backgroundColor", "#ffffff"),
        )
        for element_index, element in enumerate(elements):
            element_id = element["elementId"]
            if element_id.endswith("_media_placeholder"):
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}",
                        message="이미지 소스가 없어 자리 표시자를 생성했습니다.",
                    )
                )
            if (
                element["type"] == "chart"
                and slide.get("style", {}).get("layout") != "chart-focus"
            ):
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}",
                        message="차트 슬라이드가 아닌 곳에 차트 요소가 있습니다.",
                    )
                )
            if element["type"] == "chart" and not element.get("props", {}).get("data"):
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}.props.data",
                        message="근거 데이터가 없어 빈 차트 자리 표시자를 생성했습니다. 에디터에서 데이터를 입력하세요.",
                    )
                )
            if element["type"] == "image" and not str(
                element.get("props", {}).get("alt", "")
            ).strip():
                issues.append(
                    ValidationIssue(
                        scope="element",
                        path=f"slides.{slide_index}.elements.{element_index}.props.alt",
                        message="Image element is missing alt text.",
                    )
                )
            if element["type"] == "text":
                if is_text_overflowing(element):
                    issues.append(
                        ValidationIssue(
                            scope="element",
                            path=f"slides.{slide_index}.elements.{element_index}",
                            message="텍스트가 상자 높이를 넘을 수 있습니다.",
                        )
                    )
                if is_low_contrast_text(element, background_color):
                    issues.append(
                        ValidationIssue(
                            scope="element",
                            path=f"slides.{slide_index}.elements.{element_index}.props.color",
                            message="텍스트와 배경의 대비가 낮습니다.",
                        )
                    )
                if is_safe_area_text(element):
                    issues.append(
                        ValidationIssue(
                            scope="element",
                            path=f"slides.{slide_index}.elements.{element_index}",
                            message="텍스트가 안전 영역 밖에 배치되었습니다.",
                        )
                    )
        if len(elements) > element_limit_for_slide(slide):
            issues.append(
                ValidationIssue(
                    scope="slide",
                    path=f"slides.{slide_index}.elements",
                    message="슬라이드 요소 밀도가 높아 편집성과 가독성이 떨어질 수 있습니다.",
                )
            )
        for first, second in overlapping_design_pairs(elements):
            issues.append(
                ValidationIssue(
                    scope="slide",
                    path=f"slides.{slide_index}.elements",
                    message=f"{first}와 {second} 요소가 겹칠 수 있습니다.",
                )
            )
        backgrounds = [element for element in elements if element.get("role") == "background"]
        text_elements = [element for element in elements if element["type"] == "text"]
        if backgrounds and text_elements:
            max_background_z = max(element["zIndex"] for element in backgrounds)
            min_text_z = min(element["zIndex"] for element in text_elements)
            if max_background_z >= min_text_z:
                issues.append(
                    ValidationIssue(
                        scope="slide",
                        path=f"slides.{slide_index}.elements",
                        message="배경 요소가 텍스트보다 위에 있습니다.",
                    )
                )
    return issues


def is_text_overflowing(element: dict[str, Any]) -> bool:
    props = element.get("props", {})
    text = str(props.get("text", ""))
    if not text:
        return False

    font_size = float(props.get("fontSize", 24))
    line_height = float(props.get("lineHeight", 1.2))
    width = float(element.get("width", 1))
    height = float(element.get("height", 1))
    average_character_width = max(1.0, font_size * 0.56)
    characters_per_line = max(1, int(width / average_character_width))
    estimated_lines = sum(
        max(1, (len(line) + characters_per_line - 1) // characters_per_line)
        for line in text.splitlines() or [text]
    )
    return estimated_lines * font_size * line_height > height * 1.08


def is_low_contrast_text(element: dict[str, Any], background_color: str) -> bool:
    color = element.get("props", {}).get("color")
    if not is_hex_color(color) or not is_hex_color(background_color):
        return False
    return contrast_ratio(color, background_color) < 4.5


def is_hex_color(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value) is not None


def is_safe_area_text(element: dict[str, Any]) -> bool:
    if element.get("role") == "footer":
        return False
    x = float(element.get("x", 0))
    y = float(element.get("y", 0))
    width = float(element.get("width", 1))
    height = float(element.get("height", 1))
    return (
        x < CANVAS.safe_x
        or y < CANVAS.safe_y
        or x + width > CANVAS.safe_x + CANVAS.safe_width
        or y + height > CANVAS.safe_y + CANVAS.safe_height
    )


def overlapping_design_pairs(elements: list[dict[str, Any]]) -> list[tuple[str, str]]:
    visible = [
        element
        for element in elements
        if element.get("visible", True)
        and element.get("role") != "background"
        and element.get("type") in {"text", "image", "chart"}
    ]
    pairs: list[tuple[str, str]] = []
    for index, first in enumerate(visible):
        for second in visible[index + 1 :]:
            if overlap_ratio(first, second) > 0.18:
                pairs.append((first["elementId"], second["elementId"]))
    return pairs[:3]


def overlap_ratio(first: dict[str, Any], second: dict[str, Any]) -> float:
    first_x = float(first.get("x", 0))
    first_y = float(first.get("y", 0))
    first_width = float(first.get("width", 1))
    first_height = float(first.get("height", 1))
    second_x = float(second.get("x", 0))
    second_y = float(second.get("y", 0))
    second_width = float(second.get("width", 1))
    second_height = float(second.get("height", 1))
    left = max(first_x, second_x)
    top = max(first_y, second_y)
    right = min(first_x + first_width, second_x + second_width)
    bottom = min(first_y + first_height, second_y + second_height)
    if right <= left or bottom <= top:
        return 0.0

    intersection = (right - left) * (bottom - top)
    smaller_area = min(first_width * first_height, second_width * second_height)
    return intersection / max(1, smaller_area)


def validate_presentation(deck: dict[str, Any]) -> list[ValidationIssue]:
    if len(deck["slides"]) < 1:
        return [
            ValidationIssue(
                scope="deck",
                path="slides",
                message="덱에는 슬라이드가 최소 1장 필요합니다.",
            )
        ]
    return []


def patch_deck(deck: dict[str, Any]) -> dict[str, Any]:
    for slide in deck["slides"]:
        slide["elements"] = cap_elements(
            slide["elements"],
            limit=element_limit_for_slide(slide),
        )
        for element in slide["elements"]:
            element["x"] = max(0, min(element["x"], CANVAS.width - 1))
            element["y"] = max(0, min(element["y"], CANVAS.height - 1))
            element["width"] = max(1, min(element["width"], CANVAS.width - element["x"]))
            element["height"] = max(1, min(element["height"], CANVAS.height - element["y"]))
    return deck


def refine_design_issues(
    deck: dict[str, Any],
    design_issues: list[ValidationIssue],
) -> dict[str, Any]:
    if not design_issues:
        return deck

    element_paths = design_issue_element_paths(design_issues)
    if not element_paths:
        return deck

    refined = deepcopy(deck)
    for slide_index, element_index in element_paths:
        if slide_index >= len(refined["slides"]):
            continue
        slide = refined["slides"][slide_index]
        if element_index >= len(slide["elements"]):
            continue
        element = slide["elements"][element_index]
        if element["type"] != "text" or is_imported_element(element, slide.get("order")):
            continue
        background_color = slide.get("style", {}).get(
            "backgroundColor",
            refined.get("theme", {}).get("backgroundColor", "#ffffff"),
        )
        shrink_text_to_fit(element)
        if should_clamp_text_to_safe_area(element):
            clamp_text_to_safe_area(element)
        correct_text_contrast(element, background_color)
    return refined


def design_issue_element_paths(
    design_issues: list[ValidationIssue],
) -> set[tuple[int, int]]:
    paths: set[tuple[int, int]] = set()
    for issue in design_issues:
        match = re.search(r"slides\.(\d+)\.elements\.(\d+)", issue.path)
        if match:
            paths.add((int(match.group(1)), int(match.group(2))))
    return paths


def shrink_text_to_fit(element: dict[str, Any]) -> None:
    props = element.get("props", {})
    for _ in range(8):
        if not is_text_overflowing(element):
            return
        font_size = float(props.get("fontSize", 24))
        if font_size <= 12:
            return
        props["fontSize"] = max(12, round(font_size * 0.9))
        props["lineHeight"] = max(1.0, round(float(props.get("lineHeight", 1.2)) - 0.05, 2))


def clamp_text_to_safe_area(element: dict[str, Any]) -> None:
    element["width"] = min(element["width"], CANVAS.safe_width)
    element["height"] = min(element["height"], CANVAS.safe_height)
    element["x"] = min(
        max(element["x"], CANVAS.safe_x),
        CANVAS.safe_x + CANVAS.safe_width - element["width"],
    )
    element["y"] = min(
        max(element["y"], CANVAS.safe_y),
        CANVAS.safe_y + CANVAS.safe_height - element["height"],
    )


def should_clamp_text_to_safe_area(element: dict[str, Any]) -> bool:
    return element.get("role") not in {"caption", "footer"}


def correct_text_contrast(element: dict[str, Any], background_color: str) -> None:
    props = element.get("props", {})
    color = props.get("color")
    if not is_hex_color(color) or not is_hex_color(background_color):
        return
    if contrast_ratio(color, background_color) < 4.5:
        props["color"] = text_color_for_background(background_color)


def safe_token(value: str) -> str:
    token = "".join(character if character.isalnum() else "_" for character in value)
    return token.strip("_") or "deck"
