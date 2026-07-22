from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.ai.composition_library import (
    CompiledComposition,
    CompositionCompileError,
    compile_composition,
)
from app.ai.design_pack_layouts.editorial_insight import (
    compile_editorial_insight_layout,
)
from app.ai.design_pack_layouts.executive_review import (
    compile_executive_review_layout,
)
from app.ai.design_pack_layouts.kickoff_alignment import (
    compile_kickoff_alignment_layout,
)
from app.ai.design_pack_layouts.neutral import compile_neutral_layout
from app.ai.design_program import DeckDesignProgram, SlideCompositionDirection


KNOWN_SYSTEM_DESIGN_PACK_IDS = frozenset(
    {
        "neutral-light",
        "neutral-dark",
        "executive-review",
        "kickoff-alignment",
        "editorial-insight",
    }
)


@dataclass(frozen=True)
class DesignPackRolloutPolicy:
    enabled: bool
    enabled_pack_ids: frozenset[str]

    def applies_to(self, pack_id: str | None) -> bool:
        return bool(
            self.enabled
            and pack_id
            and pack_id in self.enabled_pack_ids
            and pack_id in KNOWN_SYSTEM_DESIGN_PACK_IDS
        )


def design_pack_rollout_policy(
    env: Mapping[str, str] | None = None,
) -> DesignPackRolloutPolicy:
    values = os.environ if env is None else env
    enabled = values.get(
        "AI_PPT_SYSTEM_DESIGN_PACKS_ENABLED", "false"
    ).strip().casefold()
    allowlist = frozenset(
        value.strip()
        for value in values.get(
            "AI_PPT_SYSTEM_DESIGN_PACK_ALLOWLIST",
            "",
        ).split(",")
        if value.strip() in KNOWN_SYSTEM_DESIGN_PACK_IDS
    )
    return DesignPackRolloutPolicy(
        enabled=enabled == "true",
        enabled_pack_ids=allowlist,
    )


def compile_with_design_pack_rollout(
    direction: SlideCompositionDirection,
    slide: dict[str, Any],
    program: DeckDesignProgram,
    *,
    policy: DesignPackRolloutPolicy | None = None,
) -> CompiledComposition:
    rollout = policy or design_pack_rollout_policy()
    if not rollout.applies_to(program.design_pack_id):
        return compile_composition(direction, slide, program)
    if program.layout_ids is None or len(program.layout_ids) != len(program.slides):
        return compile_composition(direction, slide, program)
    try:
        layout_id = program.layout_ids[direction.order - 1]
        if program.design_pack_id in {"neutral-light", "neutral-dark"}:
            return compile_neutral_layout(layout_id, direction, slide, program)
        if program.design_pack_id == "executive-review":
            return compile_executive_review_layout(
                layout_id, direction, slide, program
            )
        if program.design_pack_id == "kickoff-alignment":
            return compile_kickoff_alignment_layout(
                layout_id, direction, slide, program
            )
        if program.design_pack_id == "editorial-insight":
            return compile_editorial_insight_layout(
                layout_id, direction, slide, program
            )
    except (CompositionCompileError, IndexError, KeyError, TypeError, ValueError):
        pass
    return compile_composition(direction, slide, program)
