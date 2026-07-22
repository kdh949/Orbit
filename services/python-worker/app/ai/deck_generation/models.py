from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.ai.design_program import DeckDesignProgram


Audience = Literal["general", "executive", "technical", "sales"]
Purpose = Literal["inform", "persuade", "teach", "report"]
Tone = Literal["professional", "friendly", "confident", "concise"]
Template = Literal["default", "pitch", "report", "lesson"]
VisualRhythm = Literal["auto", "clean", "editorial", "bold", "technical"]
DensityTarget = Literal["low", "medium", "high"]
MediaPolicy = Literal[
    "avoid",
    "balanced",
    "placeholder-ok",
    "provided-only",
    "public-assets",
    "ai-generated",
    "hybrid",
    "minimal",
]
LayoutDiversity = Literal["stable", "varied"]
ImageReviewMode = Literal["auto", "off"]
ReferencePolicy = Literal[
    "topic-only",
    "user-input-only",
    "references-first",
    "references-only",
    "research-first",
]
SourceType = Literal["topic", "uploaded", "web", "generated", "none"]
SourceAuthority = Literal["official", "independent", "unknown"]
ResearchQuality = Literal["not-run", "complete", "partial", "unavailable"]
ResearchIssueCode = Literal[
    "provider-unavailable",
    "provider-call-failed",
    "no-citations",
    "vetting-failed",
    "official-missing",
    "independent-missing",
    "fact-coverage",
]
RepairReasonCode = Literal[
    "SLIDE_COUNT_SHORT",
    "CONTENT_DUPLICATED",
    "CONTENT_CAPACITY",
    "UNSUPPORTED_NUMERIC_CLAIM",
    "SPEAKER_NOTES_SHORT",
    "SPEAKER_NOTES_LONG",
    "SPEAKER_NOTES_REPEATED",
]
CriticalFactKind = Literal[
    "identifier",
    "product-name",
    "amount",
    "date",
    "actor-relation",
    "metric",
    "condition",
    "required-phrase",
]
EvidenceObligationReason = Literal[
    "user-required",
    "decision-critical",
    "source-emphasized",
]
WarningCode = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]*$")]
ForbiddenStyle = Literal["gradient", "pastel"]
CanvasBackground = Literal["auto", "white"]
ColorMood = Literal[
    "auto",
    "calm",
    "trustworthy",
    "relaxed",
    "energetic",
    "premium",
    "creative",
]
ColorLevel = Literal["low", "medium", "high"]
ColorFormality = Literal["casual", "professional", "formal"]
PreferredHue = Literal[
    "auto",
    "blue",
    "teal",
    "green",
    "violet",
    "pink",
    "orange",
    "red",
    "yellow",
    "slate",
    "monochrome",
]
BackgroundPreference = Literal["auto", "white", "light", "dark"]
DesignProfile = Literal[
    "executive-report",
    "startup-pitch",
    "editorial",
    "technical",
    "training",
]
PresentationProfile = Literal[
    "proposal",
    "executive-report",
    "product-launch",
    "education",
    "technical",
    "research",
    "general-inform",
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
AgentStatus = Literal["succeeded", "failed"]
ThemeColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
NonEmptyString = Annotated[str, Field(min_length=1)]
PositiveInteger = Annotated[int, Field(gt=0)]


class GenerateDeckReference(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )

    file_id: str = Field(alias="fileId", min_length=1)


class GenerateDeckReferenceKeyword(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    text: str = Field(min_length=1)


class ReferenceContext(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )

    file_id: str = Field(alias="fileId", min_length=1)
    content: str = Field(min_length=1)
    title: str = ""
    source_id: str | None = Field(default=None, alias="sourceId", min_length=1)
    chunk_id: str | None = Field(default=None, alias="chunkId", min_length=1)


class SourceRecord(BaseModel):
    source_type: SourceType = Field(alias="sourceType")
    source_id: str = Field(alias="sourceId", min_length=1)
    content: str = Field(min_length=1)
    file_id: str | None = Field(default=None, alias="fileId")
    chunk_id: str | None = Field(default=None, alias="chunkId")
    url: str | None = None
    title: str = ""
    confidence: float = 0.5
    authority: SourceAuthority = "unknown"


class WebResearchResult(BaseModel):
    status: Literal["succeeded", "unavailable", "failed"]
    sources: list[SourceRecord] = Field(default_factory=list)
    message: str = ""
    attempts: int = 0
    relevant_source_count: int = 0
    official_source_count: int = 0
    independent_source_count: int = 0
    quality: ResearchQuality = "not-run"
    issue_codes: list[ResearchIssueCode] = Field(default_factory=list)
    fact_coverage_satisfied: bool = False
    timed_out: bool = False
    elapsed_ms: int = 0


class WebSourceAssessment(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    source_id: str = Field(alias="sourceId", min_length=1)
    relevant: bool
    authority: SourceAuthority


class WebSourceVettingResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    official_required: bool = Field(alias="officialRequired")
    required_fact_coverage_satisfied: bool = Field(
        alias="requiredFactCoverageSatisfied"
    )
    sources: list[WebSourceAssessment]


class WebSearchAliasPlan(BaseModel):
    aliases: list[str] = Field(default_factory=list, max_length=3)


class GenerateDeckMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audience: Audience = "general"
    purpose: Purpose = "inform"
    tone: Tone = "professional"


class GenerateDeckBrief(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )

    presentation_context: str = Field(default="", alias="presentationContext")
    audience_text: str = Field(default="", alias="audienceText")
    presentation_type: str = Field(default="", alias="presentationType")
    success_criteria: str = Field(default="", alias="successCriteria")
    duration_minutes: int | None = Field(default=None, alias="durationMinutes", ge=1, le=120)
    reference_policy: ReferencePolicy = Field(default="topic-only", alias="referencePolicy")


class PaletteOverride(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    primary: ThemeColor | None = None
    secondary: ThemeColor | None = None
    background: ThemeColor | None = None
    surface: ThemeColor | None = None
    muted: ThemeColor | None = None
    border: ThemeColor | None = None
    text: ThemeColor | None = None
    accent_color: ThemeColor | None = Field(default=None, alias="accentColor")


class FontOverride(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )

    font_id: str = Field(alias="fontId", min_length=1)
    name: str = Field(min_length=1)
    heading_font_family: str = Field(alias="headingFontFamily", min_length=1)
    body_font_family: str = Field(alias="bodyFontFamily", min_length=1)
    fallback_family: str = Field(default="Arial", alias="fallbackFamily", min_length=1)
    weights: list[PositiveInteger] = Field(default_factory=list)
    supports_korean: bool = Field(default=True, alias="supportsKorean")
    pptx_embeddable: bool = Field(default=True, alias="pptxEmbeddable")
    mood_tags: list[NonEmptyString] = Field(default_factory=list, alias="moodTags")
    license: str = ""
    source_url: str = Field(default="", alias="sourceUrl")
    recommended_title_size: int = Field(
        default=48,
        alias="recommendedTitleSize",
        ge=28,
        le=72,
    )
    recommended_body_size: int = Field(
        default=22,
        alias="recommendedBodySize",
        ge=14,
        le=36,
    )
    line_height: float = Field(default=1.15, alias="lineHeight", ge=1, le=1.6)
    width_factor: float = Field(default=1.0, alias="widthFactor", ge=0.8, le=1.4)
    overflow_risk: Literal["low", "medium", "high"] = Field(
        default="medium",
        alias="overflowRisk",
    )


class VisualPlanPolicy(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    media_policy: MediaPolicy = Field(default="balanced", alias="mediaPolicy")


class InternalDesignProgramContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    saved_design_preferences: dict[str, Any] = Field(
        default_factory=dict,
        alias="savedDesignPreferences",
    )


class SavedDesignPackSelection(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    id: str = Field(min_length=1)
    version: int = Field(ge=1)


class GenericBriefRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["generic"]


class BriefedBriefRef(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )

    mode: Literal["briefed"]
    brief_id: str = Field(alias="briefId", min_length=1, max_length=128)
    revision: int = Field(ge=1)


FrozenBriefRef = Annotated[
    GenericBriefRef | BriefedBriefRef,
    Field(discriminator="mode"),
]


class EvaluatorLensRef(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    lens_id: Literal["general-novice", "decision-maker", "strict-reviewer"] = Field(
        alias="lensId"
    )
    revision: Literal[1]


class GenerateDeckCoachingContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    brief_ref: FrozenBriefRef = Field(alias="briefRef")
    evaluator_lens_ref: EvaluatorLensRef = Field(alias="evaluatorLensRef")


class ColorIntent(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    mood: ColorMood = "auto"
    trust_level: ColorLevel = Field(default="medium", alias="trustLevel")
    energy_level: ColorLevel = Field(default="medium", alias="energyLevel")
    formality: ColorFormality = "professional"
    preferred_hue: PreferredHue = Field(default="auto", alias="preferredHue")
    background_preference: BackgroundPreference = Field(
        default="auto",
        alias="backgroundPreference",
    )
    forbidden_styles: list[ForbiddenStyle] = Field(
        default_factory=list,
        alias="forbiddenStyles",
    )


class DesignConstraints(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    canvas_background: CanvasBackground = Field(default="auto", alias="canvasBackground")
    forbidden_styles: list[ForbiddenStyle] = Field(
        default_factory=list,
        alias="forbiddenStyles",
    )


class DesignOptions(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )

    profile: DesignProfile | None = None
    style_pack_id: str | None = Field(
        default=None,
        alias="stylePackId",
        min_length=1,
    )
    visual_rhythm: VisualRhythm = Field(default="auto", alias="visualRhythm")
    density_target: DensityTarget = Field(default="medium", alias="densityTarget")
    media_policy: MediaPolicy = Field(default="balanced", alias="mediaPolicy")
    layout_diversity: LayoutDiversity = Field(
        default="stable",
        alias="layoutDiversity",
    )
    color_intent: ColorIntent | None = Field(default=None, alias="colorIntent")
    constraints: DesignConstraints | None = None
    palette_override: PaletteOverride | None = Field(
        default=None,
        alias="paletteOverride",
    )
    font_override: FontOverride | None = Field(default=None, alias="fontOverride")
    reference_policy: ReferencePolicy | None = Field(default=None, alias="referencePolicy")


class SlideCountRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: int = Field(default=5, ge=1, le=20)
    max: int = Field(default=8, ge=1, le=20)

    @model_validator(mode="after")
    def validate_order(self) -> SlideCountRange:
        if self.min > self.max:
            raise ValueError("min must be less than or equal to max")
        return self


class GenerateDeckRequest(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        str_strip_whitespace=True,
        extra="forbid",
    )

    project_id: str = Field(alias="projectId", min_length=1)
    topic: str = Field(min_length=1)
    prompt: str = ""
    design_prompt: str = Field(default="", alias="designPrompt")
    brief: GenerateDeckBrief = Field(default_factory=GenerateDeckBrief)
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
    saved_design_pack: SavedDesignPackSelection | None = Field(
        default=None,
        alias="savedDesignPack",
    )
    visual_plan_policy: VisualPlanPolicy | None = Field(
        default=None,
        alias="visualPlanPolicy",
    )
    reference_policy: ReferencePolicy | None = Field(default=None, alias="referencePolicy")
    reference_file_ids: list[NonEmptyString] = Field(
        default_factory=list,
        alias="referenceFileIds",
        max_length=10,
    )
    official_asset_file_ids: list[NonEmptyString] | None = Field(
        default=None,
        alias="officialAssetFileIds",
    )
    references: list[GenerateDeckReference] = Field(
        default_factory=list,
        max_length=10,
    )
    reference_keywords: list[GenerateDeckReferenceKeyword] = Field(
        default_factory=list,
        alias="referenceKeywords",
    )
    reference_context: list[ReferenceContext] = Field(
        default_factory=list,
        alias="referenceContext",
    )
    image_review_mode: ImageReviewMode | None = Field(
        default=None,
        alias="imageReviewMode",
    )
    design_program_context: InternalDesignProgramContext = Field(
        default_factory=InternalDesignProgramContext,
        alias="designProgramContext",
    )
    coaching_context: GenerateDeckCoachingContext | None = Field(
        default=None,
        alias="coachingContext",
    )


class PresentationTimingPlan(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    chars_per_minute: int = Field(alias="charsPerMinute")
    speaking_time_ratio: float = Field(default=0.8, alias="speakingTimeRatio")
    target_total_chars: int = Field(alias="targetTotalChars")
    target_spoken_seconds: int = Field(default=0, alias="targetSpokenSeconds")
    target_slide_count: int = Field(alias="targetSlideCount")
    target_seconds_per_slide: int = Field(alias="targetSecondsPerSlide")
    target_speaker_notes_chars_per_slide: int = Field(
        alias="targetSpeakerNotesCharsPerSlide",
    )


class CriticalFact(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fact_id: str = Field(alias="factId", min_length=1)
    kind: CriticalFactKind
    canonical_text: str = Field(alias="canonicalText", min_length=1)
    source_refs: list[str] = Field(default_factory=list, alias="sourceRefs")
    value: str = ""
    unit: str = ""
    qualifier: str = ""
    actors: list[str] = Field(default_factory=list)
    relation: str = ""
    joint: bool = False
    condition_type: str = Field(default="", alias="conditionType")
    operator: str = ""
    threshold: str = ""
    deadline: str = ""


class EvidenceObligation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    obligation_id: str = Field(alias="obligationId", min_length=1)
    kind: Literal["domain-claim"] = "domain-claim"
    canonical_text: str = Field(alias="canonicalText", min_length=1)
    evidence_text: str = Field(alias="evidenceText", min_length=1)
    source_refs: list[str] = Field(default_factory=list, alias="sourceRefs")
    reason: EvidenceObligationReason
    must_include: bool = Field(alias="mustInclude")


class PlacementConstraint(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    target_id: str = Field(alias="targetId", min_length=1)
    slide_role: Literal["cover", "body", "closing"] = Field(alias="slideRole")
    element_role: Literal["title", "subtitle", "message", "body"] = Field(
        alias="elementRole"
    )
    slide_order: int | None = Field(default=None, alias="slideOrder", ge=1)


class CommunicationContract(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    narrative_thesis: str = Field(default="", alias="narrativeThesis")
    audience_takeaway: str = Field(default="", alias="audienceTakeaway")
    required_facts: list[str] = Field(default_factory=list, alias="requiredFacts")
    placement_constraints: list[PlacementConstraint] = Field(
        default_factory=list,
        alias="placementConstraints",
    )
    forbidden_claims: list[str] = Field(default_factory=list, alias="forbiddenClaims")
    assumptions: list[str] = Field(default_factory=list)


class ContentFactIssue(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str
    message: str
    slide_order: int = Field(alias="slideOrder", ge=1)
    priority: int = Field(ge=1, le=4)
    must_include: bool = Field(default=False, alias="mustInclude")


class RawInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    project_id: str
    topic: str
    prompt: str
    design_prompt: str = ""
    brief: GenerateDeckBrief
    target_duration_minutes: int
    slide_count: int
    min_slide_count: int
    max_slide_count: int
    timing_plan: PresentationTimingPlan = Field(alias="timingPlan")
    template: Template
    metadata: GenerateDeckMetadata
    design: DesignOptions
    presentation_profile: PresentationProfile = "general-inform"
    visual_plan_policy: VisualPlanPolicy | None = None
    reference_policy: ReferencePolicy | None = None
    reference_file_ids: list[str] = Field(default_factory=list)
    official_asset_file_ids: list[str] = Field(default_factory=list)
    references: list[GenerateDeckReference]
    reference_keywords: list[GenerateDeckReferenceKeyword]
    reference_context: list[ReferenceContext]
    source_records: list[SourceRecord] = Field(default_factory=list)
    repair_attempted: bool = False
    repair_reason_codes: list[RepairReasonCode] = Field(default_factory=list)
    research_attempts: int = 0
    relevant_web_source_count: int = 0
    official_web_source_count: int = 0
    independent_web_source_count: int = 0
    research_quality: ResearchQuality = "not-run"
    research_issue_codes: list[ResearchIssueCode] = Field(default_factory=list)
    research_fact_coverage_satisfied: bool = False
    web_research_timed_out: bool = False
    web_research_elapsed_ms: int = 0
    warning_codes: list[WarningCode] = Field(
        default_factory=list,
        alias="warningCodes",
    )
    regeneration_instruction: str = Field(
        default="",
        alias="regenerationInstruction",
        max_length=240,
    )
    previous_slide_titles: list[str] = Field(
        default_factory=list,
        alias="previousSlideTitles",
    )
    design_program_context: InternalDesignProgramContext = Field(
        default_factory=InternalDesignProgramContext,
    )
    critical_facts: list[CriticalFact] = Field(
        default_factory=list,
        alias="criticalFacts",
    )
    evidence_obligations: list[EvidenceObligation] = Field(
        default_factory=list,
        alias="evidenceObligations",
    )
    communication_contract: CommunicationContract = Field(
        default_factory=CommunicationContract,
        alias="communicationContract",
    )
    fact_repair_eligible_slide_orders: list[int] = Field(
        default_factory=list,
        alias="factRepairEligibleSlideOrders",
    )
    fact_quality_issues: list[ContentFactIssue] = Field(
        default_factory=list,
        alias="factQualityIssues",
    )
    fact_validation_duration_ms: int = Field(
        default=0,
        alias="factValidationDurationMs",
        ge=0,
    )
    fact_repair_attempted: bool = Field(default=False, alias="factRepairAttempted")
    fact_repair_succeeded: bool = Field(default=False, alias="factRepairSucceeded")
    fact_repair_duration_ms: int = Field(
        default=0,
        alias="factRepairDurationMs",
        ge=0,
    )


class SourceGroundingResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    raw_input: RawInput = Field(alias="rawInput")
    source_records: list[SourceRecord] = Field(alias="sourceRecords")
    warnings: list[str] = Field(default_factory=list)
    web_source_count: int = Field(default=0, alias="webSourceCount", ge=0)


class StylePromptContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    preset_style_prompt: str = ""
    document_mode: Literal["auto", "presentation", "report/submission"] = "auto"
    use_full_design_context: bool = False


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


class GeneratedContentItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    content_item_id: str = Field(alias="contentItemId", min_length=1)
    text: str = Field(min_length=1)


class GeneratedSlideContent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1)
    message: str = Field(min_length=1)
    speaker_notes: str = Field(alias="speakerNotes", min_length=1)
    keywords: list[str] = Field(default_factory=list)
    slide_type: SlideType | None = Field(default=None, alias="slideType")
    visual_intent: VisualIntent = Field(
        default_factory=VisualIntent,
        alias="visualIntent",
    )
    media_intent: MediaIntent = Field(
        default_factory=MediaIntent,
        alias="mediaIntent",
    )
    content_items: list[GeneratedContentItem] = Field(
        default_factory=list,
        alias="contentItems",
    )
    source_refs: list[str] = Field(default_factory=list, alias="sourceRefs")


class GeneratedDeckContentPlan(BaseModel):
    title: str = Field(min_length=1)
    slides: list[GeneratedSlideContent] = Field(min_length=1)


class GeneratedStorySlide(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1)
    message: str = Field(min_length=1)
    slide_type: SlideType = Field(alias="slideType")
    source_refs: list[str] = Field(default_factory=list, alias="sourceRefs")
    obligation_refs: list[str] = Field(default_factory=list, alias="obligationRefs")


class CoverContent(BaseModel):
    model_config = ConfigDict(populate_by_name=True, str_strip_whitespace=True)

    title: str = Field(min_length=1)
    subtitle: str | None = None
    kicker: str | None = None
    presenter_name: str | None = Field(default=None, alias="presenterName")
    presenter_role: str | None = Field(default=None, alias="presenterRole")
    organization: str | None = None
    date_text: str | None = Field(default=None, alias="dateText")
    venue: str | None = None
    report_period: str | None = Field(default=None, alias="reportPeriod")
    document_label: str | None = Field(default=None, alias="documentLabel")
    media_query: str | None = Field(default=None, alias="mediaQuery")
    profile_image_asset_id: str | None = Field(
        default=None,
        alias="profileImageAssetId",
    )
    speaker_notes: str = Field(default="", alias="speakerNotes")


class GeneratedStoryBriefAnalysis(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    purpose: Purpose | None = None
    presentation_context: str = Field(default="", alias="presentationContext")
    presentation_type: str = Field(default="", alias="presentationType")
    duration_minutes: int | None = Field(
        default=None,
        alias="durationMinutes",
        ge=1,
        le=120,
    )
    slide_count: int | None = Field(default=None, alias="slideCount", ge=1, le=20)


class GeneratedStoryPlan(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1)
    brief_analysis: GeneratedStoryBriefAnalysis = Field(
        default_factory=GeneratedStoryBriefAnalysis,
        alias="briefAnalysis",
    )
    cover_content: CoverContent | None = Field(default=None, alias="coverContent")
    slides: list[GeneratedStorySlide] = Field(min_length=1)
    critical_facts: list[CriticalFact] = Field(
        default_factory=list,
        alias="criticalFacts",
    )
    evidence_obligations: list[EvidenceObligation] = Field(
        default_factory=list,
        alias="evidenceObligations",
    )
    communication_contract: CommunicationContract = Field(
        default_factory=CommunicationContract,
        alias="communicationContract",
    )


class GeneratedStoryRepairSlide(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    order: int = Field(ge=1)
    title: str = Field(min_length=1)
    message: str = Field(min_length=1)
    slide_type: SlideType = Field(alias="slideType")
    source_refs: list[str] = Field(default_factory=list, alias="sourceRefs")
    obligation_refs: list[str] = Field(default_factory=list, alias="obligationRefs")


class GeneratedStoryRepairPlan(BaseModel):
    slides: list[GeneratedStoryRepairSlide] = Field(min_length=1, max_length=3)


class SpeakerNotesRepairItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    order: int = Field(ge=1)
    speaker_notes: str = Field(alias="speakerNotes", min_length=1)


class SpeakerNotesRepairPlan(BaseModel):
    slides: list[SpeakerNotesRepairItem] = Field(min_length=1)


class SlidePlan(BaseModel):
    order: int
    slide_type: SlideType
    title: str
    message: str
    speaker_notes: str
    keywords: list[str]
    evidence: list[SourceEvidence]
    visual_intent: VisualIntent = Field(default_factory=VisualIntent)
    media_intent: MediaIntent = Field(default_factory=MediaIntent)
    target_seconds: int = 0
    target_spoken_seconds: int = 0
    target_speaker_notes_chars: int = 0
    content_items: list[GeneratedContentItem] = Field(default_factory=list)
    source_refs: list[str] = Field(default_factory=list)
    obligation_refs: list[str] = Field(default_factory=list, alias="obligationRefs")
    cover_content: CoverContent | None = Field(default=None, alias="coverContent")


class ContentPlan(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    outline: DeckOutline
    slide_plans: list[SlidePlan] = Field(alias="slidePlans")
    slide_count: int = Field(alias="slideCount", ge=1)
    timing_plan: PresentationTimingPlan = Field(alias="timingPlan")
    repair_attempted: bool = Field(alias="repairAttempted")
    repair_reason_codes: list[RepairReasonCode] = Field(alias="repairReasonCodes")


class DesignPlan(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    slide_plans: list[SlidePlan] = Field(alias="slidePlans")
    theme: dict[str, Any]
    design_program: DeckDesignProgram = Field(alias="designProgram")


class LayoutCompileResult(BaseModel):
    slides: list[dict[str, Any]]


class VisualRequirement(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    slide_id: str = Field(alias="slideId")
    visual_plan: dict[str, Any] = Field(alias="visualPlan")


class VisualRequirements(BaseModel):
    items: list[VisualRequirement]


class ValidationIssue(BaseModel):
    code: str = "UNSPECIFIED"
    scope: Literal["deck", "slide", "element"]
    severity: Literal["warning", "error"] = "warning"
    blocking: bool = False
    path: str = ""
    message: str

    @model_validator(mode="after")
    def normalize_contract_fields(self) -> ValidationIssue:
        if self.code == "UNSPECIFIED":
            if "sourceLedger" in self.path:
                self.code = "SOURCE_LEDGER_INVALID"
                self.blocking = True
            elif self.path == "title" or self.path.endswith(".title"):
                self.code = "CONTENT_REQUIRED"
                self.blocking = True
            elif "speakerNotes" in self.path or self.path == "slides":
                self.code = "SPEAKER_NOTES_QUALITY"
            elif ".elements" in self.path:
                self.code = "LAYOUT_OR_ELEMENT_QUALITY"
            else:
                self.code = "DECK_QUALITY"
        if self.blocking:
            self.severity = "error"
        return self


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

    @model_validator(mode="after")
    def keep_passed_consistent_with_issues(self) -> ValidationResult:
        self.passed = not any(
            (
                self.layout_issues,
                self.content_issues,
                self.design_issues,
                self.presentation_issues,
            )
        )
        return self


class PythonQualityInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    deck: dict[str, Any]
    raw_input: RawInput = Field(alias="rawInput")
    reviewer_validation: ValidationResult | None = Field(
        default=None,
        alias="reviewerValidation",
    )


class PythonQualityResult(BaseModel):
    deck: dict[str, Any]
    validation: ValidationResult


class TemplateSelectionItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    generated_order: int = Field(alias="generatedOrder", ge=1)
    source_slide_index: int = Field(alias="sourceSlideIndex", ge=1)
    selection_reason: str = Field(default="", alias="selectionReason")


class GenerateDeckDiagnostics(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    reference_policy: ReferencePolicy = Field(
        default="topic-only",
        alias="referencePolicy",
    )
    uploaded_source_count: int = Field(default=0, alias="uploadedSourceCount", ge=0)
    web_source_count: int = Field(default=0, alias="webSourceCount", ge=0)
    research_attempts: int = Field(default=0, alias="researchAttempts", ge=0)
    relevant_web_source_count: int = Field(
        default=0,
        alias="relevantWebSourceCount",
        ge=0,
    )
    official_web_source_count: int = Field(
        default=0,
        alias="officialWebSourceCount",
        ge=0,
    )
    independent_web_source_count: int = Field(
        default=0,
        alias="independentWebSourceCount",
        ge=0,
    )
    research_quality: ResearchQuality = Field(
        default="not-run",
        alias="researchQuality",
    )
    research_issue_codes: list[ResearchIssueCode] = Field(
        default_factory=list,
        alias="researchIssueCodes",
    )
    research_fact_coverage_satisfied: bool = Field(
        default=False,
        alias="researchFactCoverageSatisfied",
    )
    repair_attempted: bool = Field(default=False, alias="repairAttempted")
    repair_reasons: list[RepairReasonCode] = Field(
        default_factory=list,
        alias="repairReasons",
    )
    unique_core_layout_count: int = Field(
        default=0,
        alias="uniqueCoreLayoutCount",
        ge=0,
    )
    validation_issue_count: int = Field(
        default=0,
        alias="validationIssueCount",
        ge=0,
    )
    warning_codes: list[WarningCode] = Field(
        default_factory=list,
        alias="warningCodes",
    )
    visual_qa_status: Literal[
        "not-run", "passed", "advisory", "failed", "unavailable"
    ] = Field(default="not-run", alias="visualQaStatus")
    visual_review_attempts: int = Field(
        default=0,
        alias="visualReviewAttempts",
        ge=0,
    )
    visual_repair_attempts: int = Field(
        default=0,
        alias="visualRepairAttempts",
        ge=0,
    )
    visual_issue_codes: list[str] = Field(
        default_factory=list,
        alias="visualIssueCodes",
    )
    visual_issue_slide_orders: list[Annotated[int, Field(ge=1)]] = Field(
        default_factory=list,
        alias="visualIssueSlideOrders",
    )
    design_pack_id: str | None = Field(default=None, alias="designPackId")
    design_pack_version: int | None = Field(
        default=None, alias="designPackVersion", ge=1
    )
    design_pack_selection_mode: Literal["auto", "user"] | None = Field(
        default=None,
        alias="designPackSelectionMode",
    )
    design_pack_layout_ids: list[str] = Field(
        default_factory=list,
        alias="designPackLayoutIds",
    )
    design_pack_catalog_version: int | None = Field(
        default=None,
        alias="designPackCatalogVersion",
        ge=1,
    )
    design_pack_fallback_used: bool | None = Field(
        default=None,
        alias="designPackFallbackUsed",
    )


class GenerationDiagnosticsInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    raw_input: RawInput = Field(alias="rawInput")
    validation: ValidationResult
    generated_slide_count: int = Field(alias="generatedSlideCount", ge=0)
    unique_core_layout_count: int = Field(alias="uniqueCoreLayoutCount", ge=0)
    agent_warnings: list[str] = Field(alias="agentWarnings")
    design_program: DeckDesignProgram | None = Field(
        default=None,
        alias="designProgram",
    )


class GenerationDiagnosticsResult(BaseModel):
    warnings: list[str]
    diagnostics: GenerateDeckDiagnostics


class GenerateDeckResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    deck: dict[str, Any]
    template_selection: list[TemplateSelectionItem] = Field(
        default_factory=list,
        alias="templateSelection",
    )
    warnings: list[str] = Field(default_factory=list)
    validation: ValidationResult
    diagnostics: GenerateDeckDiagnostics = Field(default_factory=GenerateDeckDiagnostics)


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

CANVAS = Canvas()
