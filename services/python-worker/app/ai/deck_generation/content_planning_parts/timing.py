from __future__ import annotations

import re

from app.ai.deck_generation.models import GenerateDeckRequest, PresentationTimingPlan

SPEAKER_NOTES_CHARS_PER_MINUTE = 400

DESIGN_PROMPT_HINT_RE = re.compile(
    r"색감|디자인|스타일|느낌|테마|팔레트|픽셀|고전|"
    r"(?<![a-z])(?:design|style|theme|palette|color|colors|pixel|retro|"
    r"classic|visual|look|mood)(?![a-z])",
    re.IGNORECASE,
)

def presentation_timing_plan_for_request(
    request: GenerateDeckRequest,
    slide_count: int,
) -> PresentationTimingPlan:
    chars_per_minute = chars_per_minute_for_request(request)
    speaking_time_ratio = 0.8
    target_spoken_seconds = round(
        request.target_duration_minutes * 60 * speaking_time_ratio
    )
    target_total_chars = round(
        request.target_duration_minutes * speaking_time_ratio * chars_per_minute
    )
    safe_slide_count = max(1, slide_count)
    return PresentationTimingPlan(
        charsPerMinute=chars_per_minute,
        speakingTimeRatio=speaking_time_ratio,
        targetTotalChars=target_total_chars,
        targetSpokenSeconds=target_spoken_seconds,
        targetSlideCount=slide_count,
        targetSecondsPerSlide=max(
            15,
            round(request.target_duration_minutes * 60 / safe_slide_count),
        ),
        targetSpeakerNotesCharsPerSlide=max(
            1, round(target_total_chars / safe_slide_count)
        ),
    )


def chars_per_minute_for_request(_request: GenerateDeckRequest) -> int:
    return SPEAKER_NOTES_CHARS_PER_MINUTE


def split_content_and_design_prompt(prompt: str, design_prompt: str) -> tuple[str, str]:
    content = prompt.strip()
    design = design_prompt.strip()
    if design:
        return content, design

    chunks = [chunk.strip() for chunk in re.split(r"[\n,;]+", content) if chunk.strip()]
    if not chunks:
        return "", ""

    design_chunks = [chunk for chunk in chunks if DESIGN_PROMPT_HINT_RE.search(chunk)]
    if not design_chunks:
        return content, ""

    content_chunks = [chunk for chunk in chunks if chunk not in design_chunks]
    if len(chunks) == 1 and content_chunks:
        return content, ""

    return ", ".join(content_chunks), ", ".join(design_chunks)
