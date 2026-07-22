from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


CompositionId = Literal[
    "cover-classic-corporate",
    "cover-visual-impact",
    "cover-immersive-background",
    "cover-research-author",
    "cover-structured-report",
    "cover-modern-high-tech",
    "hero-split",
    "hero-full-bleed",
    "minimal-cover",
    "statement-poster",
    "editorial-split",
    "metric-poster",
    "kpi-strip-evidence",
    "image-evidence",
    "feature-comparison",
    "process-horizontal",
    "timeline",
    "diagram-hub",
    "cta-closing",
]
BackgroundMode = Literal["light", "dark", "image"]
AssetRole = Literal["evidence", "atmosphere", "decoration", "none"]

COMPOSITION_IDS = (
    "cover-classic-corporate",
    "cover-visual-impact",
    "cover-immersive-background",
    "cover-research-author",
    "cover-structured-report",
    "cover-modern-high-tech",
    "hero-split",
    "hero-full-bleed",
    "minimal-cover",
    "statement-poster",
    "editorial-split",
    "metric-poster",
    "kpi-strip-evidence",
    "image-evidence",
    "feature-comparison",
    "process-horizontal",
    "timeline",
    "diagram-hub",
    "cta-closing",
)

COVER_COMPOSITION_IDS: tuple[CompositionId, ...] = (
    "cover-classic-corporate",
    "cover-visual-impact",
    "cover-immersive-background",
    "cover-research-author",
    "cover-structured-report",
    "cover-modern-high-tech",
)

COMPOSITION_CONTACT_SHEET = """
cover-classic-corporate | general business/company/proposal cover | no image | centered corporate
cover-visual-impact | product/event/campaign cover | required representative image | text-left/image-right
cover-immersive-background | keynote/vision/brand cover | required background image | full-bleed overlay
cover-research-author | research/academic author cover | required verified presenter photo | portrait-left/author-right
cover-structured-report | quarterly/research/executive report cover | no image | structured split report
cover-modern-high-tech | AI/IT/startup/technical cover | no image | dark neon technology
hero-split | cover/launch | 1-3 items | evidence or atmosphere image | split-hero
hero-full-bleed | cover/section | 1-2 items | required image | full-bleed
minimal-cover | cover | 1-3 items | no image | minimal
statement-poster | claim/transition | 1-2 items | optional decoration | poster
editorial-split | explanation/experience | 2-4 items | optional image | split-editorial
metric-poster | data/release fact | 1-3 items | no image | poster
kpi-strip-evidence | evidence/data | 2-4 items | optional evidence image | evidence-strip
image-evidence | evidence/experience | 1-3 items | required evidence image | image-evidence
feature-comparison | comparison | 2-4 items | no image | comparison
process-horizontal | process | 3-6 items | no image | process
timeline | release/roadmap | 3-6 items | no image | timeline
diagram-hub | architecture/ecosystem | 3-6 items | no image | diagram
cta-closing | CTA/closing | 1-3 items | optional atmosphere image | closing
""".strip()

ART_DIRECTOR_INSTRUCTIONS = """
You are the visual art director for an editable 16:9 presentation.
Return only the requested JSON.
Choose one curated composition per slide; never invent coordinates or IDs.
For the first slide, choose only an ID listed in its eligibleCompositionIds.
Use cover-research-author only when coverContent.profileImageAssetId is present.
Never invent a person or use an unrelated asset as a headshot.
Give every slide one clear focal point and vary adjacent silhouettes.
Translate designDirection and each slide visualIntent into a subject-specific visual
concept, imageStyle, surfaceStyle, and composition sequence. Do not default to generic
clean minimal styling unless the user explicitly requests it.
Keep focal and secondary palette roles visibly distinct when constraints allow it.
Use evidence images only for factual proof, AI atmosphere only for mood, and native
shapes for processes, comparisons, timelines, and diagrams.
Prefer process-horizontal for journeys and processes, timeline for roadmaps and
schedules, diagram-hub for architectures, metric-poster or kpi-strip-evidence for
metrics and budgets, and feature-comparison for comparisons. Preserve official
evidence images when they are the factual proof instead of replacing them.
Use the requested media budget across the whole deck, not on every slide.
Respect forbidden styles and locked design values.
""".strip()


class ArtDirectorContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    topic: str
    presentation_profile: str = Field(alias="presentationProfile")
    brief: dict[str, str]
    design_direction: str = Field(default="", alias="designDirection")
    palette: dict[str, str]
    typography: dict[str, Any]
    saved_design_preferences: dict[str, Any] = Field(
        default_factory=dict,
        alias="savedDesignPreferences",
    )
    forbidden_styles: list[str] = Field(default_factory=list, alias="forbiddenStyles")
    media_policy: str = Field(alias="mediaPolicy")
    media_budget: int = Field(default=4, alias="mediaBudget", ge=0, le=5)


class PaletteRoles(BaseModel):
    dominant: str
    surface: str
    text: str
    focal: str
    secondary: str


class ProgramTypography(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    heading_font: str = Field(alias="headingFont")
    body_font: str = Field(alias="bodyFont")
    type_scale: dict[str, int] = Field(alias="typeScale")
    fallback_font_family: str = Field(
        default="Arial",
        alias="fallbackFontFamily",
    )
    pptx_font_family: str | None = Field(default=None, alias="pptxFontFamily")
    font_width_factor: float = Field(
        default=1.0,
        alias="fontWidthFactor",
        ge=0.8,
        le=1.4,
    )
    line_height: float = Field(default=1.15, alias="lineHeight", ge=1, le=1.6)


class SlideCompositionDirection(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    order: int = Field(ge=1)
    composition_id: CompositionId = Field(alias="compositionId")
    variant: BackgroundMode
    background_mode: BackgroundMode = Field(alias="backgroundMode")
    focal_type: str = Field(alias="focalType", min_length=1)
    asset_role: AssetRole = Field(alias="assetRole")
    required_asset: bool = Field(alias="requiredAsset")


class DeckDesignProgram(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    version: Literal["program-v2"] = "program-v2"
    visual_concept: str = Field(alias="visualConcept", min_length=1)
    palette_roles: PaletteRoles = Field(alias="paletteRoles")
    typography: ProgramTypography
    background_sequence: list[BackgroundMode] = Field(
        alias="backgroundSequence",
        min_length=1,
    )
    image_style: str = Field(alias="imageStyle", min_length=1)
    surface_style: str = Field(alias="surfaceStyle", min_length=1)
    slides: list[SlideCompositionDirection] = Field(min_length=1)
    design_pack_id: str | None = Field(default=None, alias="designPackId", min_length=1)
    design_pack_version: int | None = Field(
        default=None,
        alias="designPackVersion",
        ge=1,
    )
    selection_mode: Literal["auto", "user"] | None = Field(
        default=None,
        alias="selectionMode",
    )
    selection_reason: str | None = Field(
        default=None,
        alias="selectionReason",
        min_length=1,
    )
    selection_fallback_used: bool | None = Field(
        default=None,
        alias="selectionFallbackUsed",
    )
    layout_ids: list[str] | None = Field(default=None, alias="layoutIds")
    layout_catalog_version: int | None = Field(
        default=None,
        alias="layoutCatalogVersion",
        ge=1,
    )

    @model_validator(mode="after")
    def keep_background_sequence_aligned(self) -> DeckDesignProgram:
        if len(self.background_sequence) != len(self.slides):
            raise ValueError("backgroundSequence must match the slide count")
        if self.background_sequence != [slide.background_mode for slide in self.slides]:
            raise ValueError("backgroundSequence must match slide backgroundMode values")
        if [slide.order for slide in self.slides] != list(
            range(1, len(self.slides) + 1)
        ):
            raise ValueError("slide composition orders must be contiguous from 1")
        return self


class DesignProgramError(RuntimeError):
    pass


def design_program_response_format(slide_count: int) -> dict[str, Any]:
    palette_properties = {
        name: {"type": "string", "pattern": "^#[0-9A-Fa-f]{6}$"}
        for name in ("dominant", "surface", "text", "focal", "secondary")
    }
    slide_properties = {
        "order": {"type": "integer", "minimum": 1, "maximum": slide_count},
        "compositionId": {"type": "string", "enum": list(COMPOSITION_IDS)},
        "variant": {"type": "string", "enum": ["light", "dark", "image"]},
        "backgroundMode": {
            "type": "string",
            "enum": ["light", "dark", "image"],
        },
        "focalType": {"type": "string"},
        "assetRole": {
            "type": "string",
            "enum": ["evidence", "atmosphere", "decoration", "none"],
        },
        "requiredAsset": {"type": "boolean"},
    }
    return {
        "format": {
            "type": "json_schema",
            "name": "deck_design_program",
            "strict": True,
            "schema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "version": {"type": "string", "enum": ["program-v2"]},
                    "visualConcept": {"type": "string"},
                    "paletteRoles": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": palette_properties,
                        "required": list(palette_properties),
                    },
                    "typography": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "headingFont": {"type": "string"},
                            "bodyFont": {"type": "string"},
                            "typeScale": {
                                "type": "object",
                                "additionalProperties": False,
                                "properties": {
                                    "cover": {"type": "integer", "minimum": 44},
                                    "title": {"type": "integer", "minimum": 32},
                                    "body": {"type": "integer", "minimum": 18},
                                    "caption": {"type": "integer", "minimum": 14},
                                },
                                "required": ["cover", "title", "body", "caption"],
                            },
                        },
                        "required": ["headingFont", "bodyFont", "typeScale"],
                    },
                    "backgroundSequence": {
                        "type": "array",
                        "minItems": slide_count,
                        "maxItems": slide_count,
                        "items": {
                            "type": "string",
                            "enum": ["light", "dark", "image"],
                        },
                    },
                    "imageStyle": {"type": "string"},
                    "surfaceStyle": {"type": "string"},
                    "slides": {
                        "type": "array",
                        "minItems": slide_count,
                        "maxItems": slide_count,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": slide_properties,
                            "required": list(slide_properties),
                        },
                    },
                },
                "required": [
                    "version",
                    "visualConcept",
                    "paletteRoles",
                    "typography",
                    "backgroundSequence",
                    "imageStyle",
                    "surfaceStyle",
                    "slides",
                ],
            },
        }
    }


def art_director_prompt(
    context: ArtDirectorContext,
    slides: list[dict[str, Any]],
) -> str:
    summaries = [
        {
            "order": index,
            "title": str(slide.get("title", ""))[:160],
            "message": str(slide.get("message", ""))[:320],
            "contentItems": [
                str(item.get("text", item))[:180]
                for item in slide.get("contentItems", [])[:6]
            ],
            "slideType": str(slide.get("slideType", "")),
            "coverContent": slide.get("coverContent"),
            "eligibleCompositionIds": slide.get("eligibleCompositionIds", []),
            "mediaIntent": {
                key: slide.get("mediaIntent", {}).get(key)
                for key in ("kind", "prompt", "alt", "required")
            },
            "visualIntent": {
                key: slide.get("visualIntent", {}).get(key)
                for key in (
                    "composition",
                    "paletteHint",
                    "emphasisStyle",
                    "mediaStyle",
                    "decorationDensity",
                )
            },
        }
        for index, slide in enumerate(slides, start=1)
    ]
    return "\n".join(
        [
            "Design context:",
            json.dumps(context.model_dump(by_alias=True), ensure_ascii=False),
            "Curated composition contact sheet:",
            COMPOSITION_CONTACT_SHEET,
            "Slide summaries:",
            json.dumps(summaries, ensure_ascii=False),
        ]
    )


def create_design_program(
    context: ArtDirectorContext,
    slides: list[dict[str, Any]],
    *,
    client: Any | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> DeckDesignProgram:
    api_client: Any = client
    if api_client is None:
        if not api_key:
            raise DesignProgramError("Art Director model is unavailable")
        from openai import OpenAI

        api_client = OpenAI(api_key=api_key)

    prompt = art_director_prompt(context, slides)
    for _ in range(2):
        try:
            response = api_client.responses.create(
                model=model or "gpt-4.1-mini",
                instructions=ART_DIRECTOR_INSTRUCTIONS,
                input=prompt,
                text=design_program_response_format(len(slides)),
            )
            payload = json.loads(str(getattr(response, "output_text", "")).strip())
            if not isinstance(payload, dict) or not isinstance(
                payload.get("slides"), list
            ):
                raise ValueError("Art Director returned an invalid response structure")
            payload["backgroundSequence"] = [
                slide["backgroundMode"] for slide in payload["slides"]
            ]
            program = DeckDesignProgram.model_validate(payload)
            if len(program.slides) != len(slides):
                raise ValueError("Art Director returned the wrong slide count")
            return apply_art_director_context(program, context)
        except Exception:
            prompt += "\nThe previous response violated the strict schema. Return a corrected plan."
    raise DesignProgramError(
        "Art Director could not create a valid design plan. "
        "Please retry deck generation."
    )


def apply_art_director_context(
    program: DeckDesignProgram,
    context: ArtDirectorContext,
) -> DeckDesignProgram:
    updated = program.model_copy(deep=True)
    direction = " ".join(context.design_direction.split())[:240]
    if direction:
        existing_style = " ".join(updated.image_style.split())
        updated.image_style = f"{existing_style}; {direction}"
    elif context.media_policy not in {"minimal", "avoid"} and updated.image_style.casefold() in {
        "none",
        "no image",
        "minimal",
    }:
        updated.image_style = (
            "Subject-specific editorial imagery with a dominant crop-safe focal subject"
        )
    return updated
