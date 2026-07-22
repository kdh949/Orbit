from __future__ import annotations

import colorsys
import json
from pathlib import Path
import re
from typing import Any, Literal

from app.ai.composition_library import CompositionCompileError, normalize_design_program
from app.ai.design_program import (
    ArtDirectorContext,
    DeckDesignProgram,
    DesignProgramError,
    PaletteRoles,
    ProgramTypography,
    create_design_program,
)
from app.ai.deck_generation.content_planning import (
    compact_dense_speaker_notes,
    ensure_profile_closing_action,
    has_any,
)
from app.ai.deck_generation.design_pack_selector import (
    apply_design_pack_selection,
    select_system_design_pack,
)
from app.ai.deck_generation.models import (
    DeckContentGenerationError,
    DesignPlan,
    DesignProfile,
    FontOverride,
    ForbiddenStyle,
    MediaIntent,
    MediaPolicy,
    PaletteOverride,
    RawInput,
    SlidePlan,
    StylePromptContext,
    VisualRhythm,
)
from app.ai.deck_generation.source_grounding import (
    default_source_refs,
    initial_source_records,
)


DESIGN_LIBRARY_DIR = Path(__file__).resolve().parents[1] / "design_library"


def load_json_registry(directory: Path) -> dict[str, dict[str, Any]]:
    if not directory.exists():
        return {}
    registry: dict[str, dict[str, Any]] = {}
    for path in sorted(directory.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        registry[str(payload["id"])] = payload
    return registry


def load_text_registry(directory: Path) -> dict[str, str]:
    if not directory.exists():
        return {}
    registry: dict[str, str] = {}
    for path in sorted(directory.glob("*.md")):
        content = path.read_text(encoding="utf-8").strip()
        if content:
            registry[path.stem] = content
    return registry


STYLE_PACK_REGISTRY = load_json_registry(DESIGN_LIBRARY_DIR / "style-packs")


STYLE_PACK_PROMPT_REGISTRY = load_text_registry(DESIGN_LIBRARY_DIR / "style-prompts")


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


def art_director_context(
    raw_input: RawInput,
    theme: dict[str, Any],
) -> ArtDirectorContext:
    palette = theme.get("palette", {})
    return ArtDirectorContext(
        topic=raw_input.topic,
        presentationProfile=raw_input.presentation_profile,
        brief={
            "presentationContext": raw_input.brief.presentation_context,
            "audienceText": raw_input.brief.audience_text,
            "presentationType": raw_input.brief.presentation_type,
            "successCriteria": raw_input.brief.success_criteria,
            "durationMinutes": str(raw_input.target_duration_minutes),
        },
        designDirection=" ".join(raw_input.design_prompt.split())[:600],
        palette={
            "background": str(theme.get("backgroundColor", "#FFFFFF")),
            "surface": str(palette.get("surface", "#F3F4F6")),
            "text": str(theme.get("textColor", "#111827")),
            "primary": str(palette.get("primary", "#2563EB")),
            "secondary": str(palette.get("secondary", "#06B6D4")),
        },
        typography=dict(theme.get("typography", {})),
        savedDesignPreferences=(
            raw_input.design_program_context.saved_design_preferences
        ),
        forbiddenStyles=sorted(design_pack_forbidden_styles(raw_input)),
        mediaPolicy=raw_input.design.media_policy,
        mediaBudget=4,
    )


def program_v2_slide_summary(
    slide_plan: SlidePlan,
    raw_input: RawInput | None = None,
) -> dict[str, Any]:
    content_items = [
        item.model_dump(by_alias=True) for item in slide_plan.content_items
    ]
    if not content_items and slide_plan.order != 1 and slide_plan.slide_type != "cover":
        estimated_count = {
            "cover": 1,
            "title": 1,
            "problem": 2,
            "solution": 2,
            "feature-grid": 3,
            "process": 3,
            "architecture": 3,
            "data": 2,
            "chart": 2,
            "comparison": 2,
            "quote": 1,
            "summary": 1,
        }.get(slide_plan.slide_type, 1)
        content_items = [
            {
                "contentItemId": f"story_{slide_plan.order}_{index}",
                "text": (
                    slide_plan.message
                    if index == 1
                    else f"Supporting point {index} for {slide_plan.title}"
                ),
            }
            for index in range(1, estimated_count + 1)
        ]
    summary: dict[str, Any] = {
        "title": slide_plan.title,
        "message": slide_plan.message,
        "contentItems": content_items,
        "slideType": slide_plan.slide_type,
        "visualIntent": slide_plan.visual_intent.model_dump(by_alias=True),
        "mediaIntent": slide_plan.media_intent.model_dump(),
    }
    if slide_plan.order == 1 or slide_plan.slide_type == "cover":
        cover = slide_plan.cover_content
        summary["coverContent"] = (
            cover.model_dump(by_alias=True) if cover is not None else None
        )
        summary["eligibleCompositionIds"] = eligible_cover_compositions(
            raw_input,
            slide_plan,
        )
        summary["presentationProfile"] = (
            raw_input.presentation_profile if raw_input is not None else "general-inform"
        )
    if raw_input is not None:
        records = {
            source.source_id: source
            for source in (
                raw_input.source_records or initial_source_records(raw_input)
            )
        }
        source_refs = slide_plan.source_refs or default_source_refs(
            raw_input,
            slide_plan.order,
        )
        referenced_official_source = any(
            (source := records.get(source_id)) is not None
            and source.source_type == "web"
            and source.authority == "official"
            and bool(source.url)
            for source_id in source_refs
        )
        deck_official_source = any(
            source.source_type == "web"
            and source.authority == "official"
            and bool(source.url)
            for source in records.values()
        )
        verified_profile_asset = bool(
            slide_plan.order == 1
            and slide_plan.cover_content
            and slide_plan.cover_content.profile_image_asset_id
            in raw_input.official_asset_file_ids
        )
        summary["officialSourceAvailable"] = (
            referenced_official_source
            or verified_profile_asset
            or (
                raw_input.design.media_policy == "hybrid"
                and slide_plan.order == 1
                and deck_official_source
            )
        )
    return summary


def eligible_cover_compositions(
    raw_input: RawInput | None,
    slide_plan: SlidePlan,
) -> list[str]:
    cover = slide_plan.cover_content
    if raw_input is None:
        return ["cover-classic-corporate", "cover-modern-high-tech"]
    profile = raw_input.presentation_profile
    text = " ".join(
        [
            raw_input.topic,
            raw_input.prompt,
            raw_input.brief.presentation_context,
            raw_input.brief.presentation_type,
            cover.document_label if cover and cover.document_label else "",
        ]
    ).casefold()
    report_context = profile == "executive-report" or any(
        marker in text
        for marker in (
            "report",
            "quarter",
            "earnings",
            "research result",
            "보고서",
            "분기",
            "실적",
            "조사 결과",
            "분석 결과",
        )
    )
    media_available = raw_input.design.media_policy in {
        "ai-generated",
        "public-assets",
        "hybrid",
    } or (
        raw_input.design.media_policy == "provided-only"
        and bool(raw_input.official_asset_file_ids)
    )
    research_author_available = (
        cover is not None
        and cover.presenter_name
        and cover.profile_image_asset_id
        and raw_input.design.media_policy in {"provided-only", "hybrid"}
    )
    requested_cover_media = (
        media_available and slide_plan.media_intent.kind != "none"
    )
    product_context = profile == "product-launch" or any(
        marker in text
        for marker in ("product launch", "event", "campaign", "제품 출시", "이벤트", "캠페인")
    )
    keynote_context = any(
        marker in text
        for marker in ("keynote", "vision", "brand message", "키노트", "비전", "브랜드 메시지")
    )
    eligible: list[str] = []
    if research_author_available:
        eligible.append("cover-research-author")
    if requested_cover_media:
        eligible.extend(["cover-visual-impact", "cover-immersive-background"])
    if report_context:
        eligible.append("cover-structured-report")
    if profile == "technical":
        eligible.append("cover-modern-high-tech")
    if product_context and media_available:
        eligible.append("cover-visual-impact")
    if keynote_context and media_available:
        eligible.append("cover-immersive-background")
    eligible.extend(["cover-classic-corporate", "cover-modern-high-tech"])
    if media_available:
        eligible.extend(["cover-visual-impact", "cover-immersive-background"])
    return list(dict.fromkeys(eligible))


def apply_program_v2_design_tokens(
    program: DeckDesignProgram,
    theme: dict[str, Any],
) -> DeckDesignProgram:
    palette = theme.get("palette", {})
    typography = theme.get("typography", {})
    updated = program.model_copy(deep=True)
    focal = str(theme.get("accentColor", palette.get("primary", "#2563EB")))
    updated.palette_roles = PaletteRoles(
        dominant=str(theme.get("backgroundColor", "#FFFFFF")),
        surface=str(palette.get("surface", "#F3F4F6")),
        text=str(theme.get("textColor", "#111827")),
        focal=focal,
        secondary=program_v2_secondary_color(
            focal,
            str(palette.get("secondary", "#06B6D4")),
            program.palette_roles.secondary,
        ),
    )
    updated.typography = ProgramTypography(
        headingFont=str(
            typography.get("headingFontFamily", theme.get("fontFamily", "Inter"))
        ),
        bodyFont=str(
            typography.get("bodyFontFamily", theme.get("fontFamily", "Inter"))
        ),
        typeScale={
            "cover": max(72, int(typography.get("titleSize", 60))),
            "title": max(56, int(typography.get("headingSize", 40))),
            "body": max(32, int(typography.get("bodySize", 22))),
            "caption": max(24, int(typography.get("captionSize", 14))),
        },
    )
    return updated


def program_v2_secondary_color(
    focal: str,
    theme_secondary: str,
    art_director_secondary: str,
) -> str:
    for candidate in (theme_secondary, art_director_secondary):
        if color_role_distance(focal, candidate) >= 96:
            return candidate
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", focal):
        return "#F4D40A"
    red, green, blue = (int(focal[index : index + 2], 16) / 255 for index in (1, 3, 5))
    hue, saturation, value = colorsys.rgb_to_hsv(red, green, blue)
    derived = colorsys.hsv_to_rgb(
        (hue + 0.5) % 1,
        max(0.72, saturation),
        max(0.88, value),
    )
    return "#" + "".join(f"{round(channel * 255):02X}" for channel in derived)


def color_role_distance(left: str, right: str) -> int:
    if not all(re.fullmatch(r"#[0-9A-Fa-f]{6}", value) for value in (left, right)):
        return 0
    return sum(
        abs(int(left[index : index + 2], 16) - int(right[index : index + 2], 16))
        for index in (1, 3, 5)
    )


def apply_design_options(
    raw_input: RawInput,
    slide_plans: list[SlidePlan],
    *,
    preserve_approved_content: bool = False,
) -> list[SlidePlan]:
    for slide_plan in slide_plans:
        slide_plan.media_intent = media_intent_for_policy(
            slide_plan.media_intent,
            raw_input.design.media_policy,
        )
    if not preserve_approved_content:
        for slide_plan in slide_plans:
            compact_dense_speaker_notes(slide_plan)
        ensure_profile_closing_action(raw_input, slide_plans)
    apply_design_pack_media_plan(raw_input, slide_plans)

    return slide_plans


def apply_design_pack_media_plan(
    raw_input: RawInput,
    slide_plans: list[SlidePlan],
) -> None:
    media_policy = raw_input.design.media_policy
    if media_policy in {"avoid", "minimal"}:
        for slide_plan in slide_plans:
            slide_plan.media_intent = MediaIntent()
        return

    if media_policy == "public-assets":
        for slide_plan in slide_plans:
            if is_structured_media_intent(slide_plan):
                slide_plan.media_intent = MediaIntent()

    ranked = sorted(
        (
            (design_pack_media_score(slide_plan, len(slide_plans)), slide_plan)
            for slide_plan in slide_plans
            if media_intent_needs_slot(slide_plan.media_intent)
            and design_pack_media_score(slide_plan, len(slide_plans)) >= 0
        ),
        key=lambda item: (item[0], -item[1].order),
        reverse=True,
    )
    selected_orders = {slide_plan.order for _, slide_plan in ranked[:3]}
    for slide_plan in slide_plans:
        if slide_plan.order not in selected_orders:
            slide_plan.media_intent = MediaIntent()


STRUCTURED_MEDIA_TERMS = (
    "architecture",
    "comparison",
    "concept map",
    "diagram",
    "flow",
    "process",
    "system map",
    "timeline",
    "workflow",
    "개념도",
    "구조도",
    "단계",
    "비교",
    "순서",
    "타임라인",
    "흐름",
)


def is_structured_media_intent(slide_plan: SlidePlan) -> bool:
    if slide_plan.slide_type in {"architecture", "chart", "comparison", "process"}:
        return True
    context = " ".join(
        [
            slide_plan.visual_intent.structure,
            slide_plan.visual_intent.composition,
            slide_plan.visual_intent.media_style,
            slide_plan.media_intent.prompt,
            slide_plan.media_intent.alt,
            slide_plan.media_intent.rationale,
        ]
    ).casefold()
    return has_any(context, STRUCTURED_MEDIA_TERMS)


def design_pack_media_score(slide_plan: SlidePlan, total_slides: int) -> int:
    if slide_plan.order == 1 or slide_plan.slide_type in {"title", "cover"}:
        return 100
    if slide_plan.order == total_slides or slide_plan.slide_type in {
        "process",
        "comparison",
        "chart",
        "architecture",
    }:
        return -1

    context = " ".join(
        [
            slide_plan.slide_type,
            slide_plan.visual_intent.structure,
            slide_plan.visual_intent.composition,
            slide_plan.visual_intent.emphasis,
            slide_plan.visual_intent.media_style,
            slide_plan.media_intent.rationale,
            slide_plan.media_intent.prompt,
        ]
    ).casefold()
    if slide_plan.evidence or has_any(context, ["evidence", "proof", "signal"]):
        return 80
    if slide_plan.slide_type in {"problem", "solution", "data"} or has_any(
        context,
        ["concept", "hero", "photo", "illustration", "diagram"],
    ):
        return 60
    return 20


def media_intent_for_policy(
    media_intent: MediaIntent,
    media_policy: MediaPolicy,
) -> MediaIntent:
    if media_intent.kind == "none":
        return media_intent
    if media_policy in {"avoid", "minimal"}:
        return MediaIntent()
    if media_intent.kind == "provided" and media_intent.src.strip():
        return media_intent
    if media_policy == "provided-only":
        return MediaIntent()
    if media_policy == "placeholder-ok":
        return media_intent
    if media_policy in {"public-assets", "ai-generated"}:
        return media_intent
    return MediaIntent()


def media_intent_needs_slot(media_intent: MediaIntent) -> bool:
    if media_intent.kind == "none":
        return False
    if media_intent.kind == "provided":
        return bool(media_intent.src.strip()) or media_intent.required
    return True


def registry_item(
    registry: dict[str, dict[str, Any]],
    item_id: str | None,
) -> dict[str, Any] | None:
    if item_id is None:
        return None
    return registry.get(item_id.strip())


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
    style_prompt = selected_style_pack_prompt(raw_input)
    if style_prompt:
        return style_prompt
    return STYLE_PACK_LLM_PROMPTS.get(effective_document_style_pack_id(raw_input), "")


def selected_style_pack_prompt(raw_input: RawInput) -> str:
    style_pack_id = selected_style_pack_id(raw_input)
    if not style_pack_id:
        return ""
    return STYLE_PACK_PROMPT_REGISTRY.get(style_pack_id, "")


def uses_document_style_pack(raw_input: RawInput) -> bool:
    return bool(effective_document_style_pack_id(raw_input))


def document_mode_for(
    raw_input: RawInput,
) -> Literal["auto", "presentation", "report/submission"]:
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
    if (
        has_any(text, list(REPORT_MODE_KEYWORDS))
        or raw_input.metadata.purpose == "report"
    ):
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
    theme = apply_style_pack(theme, select_style_pack(raw_input, slide_plans or []))
    theme = apply_explicit_palette(theme, raw_input, slide_plans)
    return apply_palette_override(theme, raw_input.design.palette_override)


def apply_font_override(
    theme: dict[str, Any],
    font_override: FontOverride | None,
) -> dict[str, Any]:
    if font_override is None:
        return theme

    typography = dict(theme.get("typography", {}))
    typography["headingFontFamily"] = font_override.heading_font_family
    typography["bodyFontFamily"] = font_override.body_font_family
    typography["titleSize"] = min(
        int(typography.get("titleSize", font_override.recommended_title_size)),
        font_override.recommended_title_size,
    )
    typography["headingSize"] = min(
        int(typography.get("headingSize", font_override.recommended_title_size)),
        max(
            font_override.recommended_body_size + 8,
            font_override.recommended_title_size - 4,
        ),
    )
    typography["bodySize"] = min(
        int(typography.get("bodySize", font_override.recommended_body_size)),
        font_override.recommended_body_size,
    )
    typography["lineHeight"] = font_override.line_height
    typography["fontWidthFactor"] = font_override.width_factor
    typography["overflowRisk"] = font_override.overflow_risk
    theme["typography"] = typography
    theme["fontFamily"] = font_override.body_font_family
    theme["fontSafety"] = {
        "fontId": font_override.font_id,
        "widthFactor": font_override.width_factor,
        "overflowRisk": font_override.overflow_risk,
    }
    return theme


def apply_palette_override(
    theme: dict[str, Any],
    palette_override: PaletteOverride | None,
) -> dict[str, Any]:
    if palette_override is None:
        return theme

    values = palette_override.model_dump(by_alias=True, exclude_none=True)
    background = values.get("background")
    if background:
        theme["backgroundColor"] = background

    if values.get("text"):
        theme["textColor"] = values["text"]
    elif background:
        theme["textColor"] = text_color_for_background(background)

    accent = values.get("accentColor") or values.get("primary")
    if accent:
        theme["accentColor"] = accent

    palette = dict(theme.get("palette", {}))
    for key in ("primary", "secondary", "surface", "muted", "border"):
        if values.get(key):
            palette[key] = values[key]
    theme["palette"] = palette
    return theme


def apply_explicit_palette(
    theme: dict[str, Any],
    raw_input: RawInput,
    slide_plans: list[SlidePlan] | None = None,
) -> dict[str, Any]:
    tokens = keyed_theme_tokens(raw_input, slide_plans)
    if tokens:
        return apply_keyed_theme_tokens(theme, tokens)

    colors = explicit_palette_colors(raw_input, slide_plans)
    neutral = next((color for color in colors if is_neutral_color(color)), None)
    accent_colors = [color for color in colors if not is_neutral_color(color)]
    if accent_colors:
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
                theme["palette"]["muted"] = "#fef9c3"
                theme["palette"]["border"] = "#fde68a"

        return theme

    semantic_palette = semantic_palette_for_sources(raw_input, slide_plans)
    if semantic_palette is not None:
        theme = apply_semantic_palette(theme, semantic_palette)
    if neutral is not None:
        theme["backgroundColor"] = neutral
        theme["textColor"] = text_color_for_background(neutral)
        theme["palette"]["surface"] = neutral
    return theme


def semantic_palette_for_sources(
    raw_input: RawInput,
    slide_plans: list[SlidePlan] | None = None,
) -> dict[str, Any] | None:
    for source in palette_sources(raw_input, slide_plans):
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
        raw_input.design_prompt,
        raw_input.prompt,
        *[slide_plan.visual_intent.palette_hint for slide_plan in slide_plans or []],
    ]


def strip_theme_tokens(source: str) -> str:
    return THEME_TOKEN_ANY_RE.sub(" ", source)


def is_neutral_color(color: str) -> bool:
    return color in NEUTRAL_COLORS


def text_color_for_background(color: str) -> str:
    preferred = max(
        ("#111827", "#f8fafc"),
        key=lambda candidate: contrast_ratio(color, candidate),
    )
    if contrast_ratio(color, preferred) >= 4.5:
        return preferred
    return max(
        ("#000000", "#FFFFFF"),
        key=lambda candidate: contrast_ratio(color, candidate),
    )


def contrast_ratio(color_a: str, color_b: str) -> float:
    lighter = max(relative_luminance(color_a), relative_luminance(color_b))
    darker = min(relative_luminance(color_a), relative_luminance(color_b))
    return (lighter + 0.05) / (darker + 0.05)


def relative_luminance(color: str) -> float:
    values = [int(color[index : index + 2], 16) / 255 for index in (1, 3, 5)]
    channels = [
        value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4
        for value in values
    ]
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def design_pack_forbidden_styles(raw_input: RawInput) -> set[ForbiddenStyle]:
    styles: set[ForbiddenStyle] = set()
    if raw_input.design.constraints:
        styles.update(raw_input.design.constraints.forbidden_styles)
    if raw_input.design.color_intent:
        styles.update(raw_input.design.color_intent.forbidden_styles)
    return styles


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

    if has_any(
        text, ["speech", "stt", "audio", "voice", "언어", "음성", "오디오", "방언"]
    ):
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
    ) or ("game" in text and has_any(text, ["ink", "neon"])):
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
        [
            "kids",
            "children",
            "elementary",
            "classroom",
            "어린이",
            "초등",
            "교실",
            "교육",
        ],
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


def design_pack_wants_white_canvas(raw_input: RawInput) -> bool:
    constraints = raw_input.design.constraints
    color_intent = raw_input.design.color_intent
    return bool(
        constraints is not None
        and constraints.canvas_background == "white"
        or color_intent is not None
        and color_intent.background_preference == "white"
    )


def design_pack_locks_dark_canvas(raw_input: RawInput) -> bool:
    if design_pack_wants_white_canvas(raw_input):
        return False
    text = " ".join([raw_input.design_prompt, raw_input.prompt]).casefold()
    compact_korean = re.sub(r"\s+", "", text)
    korean_markers = (
        "검은색배경만",
        "검정색배경만",
        "어두운배경만",
        "배경은검은색만",
        "배경은검정색만",
        "배경을검은색으로만",
        "배경을검정색으로만",
    )
    english_markers = (
        "black background only",
        "black backgrounds only",
        "dark background only",
        "dark backgrounds only",
        "only black background",
        "only black backgrounds",
        "only dark background",
        "only dark backgrounds",
        "use only black background",
        "use only black backgrounds",
        "use only dark background",
        "use only dark backgrounds",
    )
    return any(marker in compact_korean for marker in korean_markers) or any(
        marker in text for marker in english_markers
    )


def resolve_style_prompt_context(raw_input: RawInput) -> StylePromptContext:
    selected_prompt = selected_style_pack_prompt(raw_input)
    return StylePromptContext(
        preset_style_prompt=(
            selected_prompt
            or STYLE_PACK_LLM_PROMPTS.get(
                effective_document_style_pack_id(raw_input),
                "",
            )
        ),
        document_mode=document_mode_for(raw_input),
        use_full_design_context=bool(selected_prompt),
    )


def plan_design(
    raw_input: RawInput,
    slide_plans: list[SlidePlan],
    *,
    preserve_approved_content: bool = False,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> DesignPlan:
    slide_plans = apply_design_options(
        raw_input,
        slide_plans,
        preserve_approved_content=preserve_approved_content,
    )
    theme = direct_design(raw_input, slide_plans)
    theme = apply_font_override(theme, raw_input.design.font_override)
    try:
        slide_summaries = [
            program_v2_slide_summary(slide, raw_input) for slide in slide_plans
        ]
        program = create_design_program(
            art_director_context(raw_input, theme),
            slide_summaries,
            client=client,
            model=model,
            api_key=api_key,
        )
        program = apply_program_v2_design_tokens(program, theme)
        program = normalize_design_program(
            program,
            slide_summaries,
            force_light=design_pack_wants_white_canvas(raw_input),
            force_dark=design_pack_locks_dark_canvas(raw_input),
            media_policy=raw_input.design.media_policy,
            media_budget=4,
            preserve_slide_types=preserve_approved_content,
        )
        selection = select_system_design_pack(raw_input, slide_summaries)
        program = apply_design_pack_selection(program, selection)
    except (CompositionCompileError, DesignProgramError) as error:
        raise DeckContentGenerationError(str(error)) from error
    return DesignPlan(
        slidePlans=slide_plans,
        theme=theme,
        designProgram=program,
    )
