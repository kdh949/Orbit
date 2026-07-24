from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
import re
import time
from typing import Literal
import unicodedata

from app.ai.deck_generation.models import (
    ContentFactIssue,
    CriticalFact,
    EvidenceObligation,
    GeneratedStoryPlan,
    PlacementConstraint,
    RawInput,
    SlidePlan,
    ValidationIssue,
)
from app.ai.deck_generation.structural_policy import (
    body_slide_orders,
    resolve_constraint_order,
)


MONEY_MULTIPLIERS = {
    "억": Decimal("100000000"),
    "천만": Decimal("10000000"),
    "백만": Decimal("1000000"),
    "만": Decimal("10000"),
    "천": Decimal("1000"),
    "원": Decimal("1"),
}
MONEY_EXPRESSION = re.compile(
    r"(?:(?:\d[\d,]*(?:\.\d+)?)\s*(?:억|천만|백만|만|천)\s*)+(?:원)?|"
    r"(?:\d[\d,]*(?:\.\d+)?)\s*원"
)
MONEY_PART = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(억|천만|백만|만|천|원)")
NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
ACTOR = re.compile(
    r"([가-힣A-Za-z0-9]{1,16}\s*(?:책임자|담당자|관리자|승인자|대표|위원회))"
)
NEGATION_MARKERS = ("금지", "불가", "아님", "않", "제외", "없", "못")
EXCEPTION_MARKERS = ("예외", "단,", "다만", "제외")
MODAL_MARKERS = ("필수", "의무", "해야", "가능", "권장", "허용")
EXPLICIT_IDENTIFIER = re.compile(
    r"(?<![A-Z0-9_-])[A-Z][A-Z0-9_-]{3,}(?![A-Z0-9_-])"
)
QUOTED_PHRASE = re.compile(r"[\"'“‘]([^\"'”’]{2,80})[\"'”’]")
USER_REQUIRED_MARKERS = ("반드시 포함", "주의", "제외", "예외", "조건", "금지")


def normalized_text(value: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        unicodedata.normalize("NFKC", value).casefold(),
    ).strip()


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", normalized_text(value))


def money_values(value: str) -> set[Decimal]:
    amounts: set[Decimal] = set()
    for expression in MONEY_EXPRESSION.findall(value):
        total = Decimal(0)
        for number, unit in MONEY_PART.findall(expression):
            try:
                total += Decimal(number.replace(",", "")) * MONEY_MULTIPLIERS[unit]
            except InvalidOperation:
                total = Decimal(0)
                break
        if total:
            amounts.add(total)
    return amounts


def expected_amount(fact: CriticalFact) -> Decimal | None:
    canonical = money_values(fact.canonical_text)
    if canonical:
        return next(iter(canonical))
    if not fact.value:
        return None
    try:
        value = Decimal(fact.value.replace(",", ""))
    except InvalidOperation:
        return None
    normalized_unit = _compact(fact.unit).replace("원", "")
    return value * MONEY_MULTIPLIERS.get(normalized_unit or "원", Decimal(1))


def sanitize_evidence_obligations(
    raw_input: RawInput,
    obligations: list[EvidenceObligation],
) -> tuple[list[EvidenceObligation], list[ContentFactIssue]]:
    sources = {source.source_id: source for source in raw_input.source_records}
    valid: list[EvidenceObligation] = []
    issues: list[ContentFactIssue] = []
    for obligation in obligations:
        evidence = normalized_text(obligation.evidence_text)
        matching_sources = [
            sources[source_id]
            for source_id in obligation.source_refs
            if source_id in sources
            and evidence
            and evidence in normalized_text(sources[source_id].content)
        ]
        if matching_sources:
            valid.append(obligation)
            continue
        issues.append(
            ContentFactIssue(
                code="EVIDENCE_OBLIGATION_SOURCE_INVALID",
                message="핵심 주장에 연결된 근거 문구를 지정 출처에서 확인하지 못했습니다.",
                slideOrder=1,
                priority=_obligation_priority(obligation),
                mustInclude=obligation.must_include,
            )
        )
    return valid, issues


def apply_explicit_user_placements(
    raw_input: RawInput,
    plan: GeneratedStoryPlan,
) -> GeneratedStoryPlan:
    prompt = unicodedata.normalize(
        "NFKC",
        f"{raw_input.prompt}\n{raw_input.design_prompt}",
    )
    if "표지" not in prompt:
        return plan
    element_role: Literal["title", "subtitle", "message", "body"] | None = (
        "subtitle"
        if any(marker in prompt for marker in ("부제", "서브타이틀"))
        else "title"
        if "제목" in prompt
        else None
    )
    if element_role is None:
        return plan
    identifiers = EXPLICIT_IDENTIFIER.findall(prompt)
    identifier = identifiers[-1] if identifiers else ""
    quoted = next(iter(QUOTED_PHRASE.findall(prompt)), "")
    canonical = identifier or quoted.strip()
    if not canonical:
        return plan
    updated = plan.model_copy(deep=True)
    fact = next(
        (
            item
            for item in updated.critical_facts
            if _compact(item.canonical_text) == _compact(canonical)
        ),
        None,
    )
    if fact is None:
        used_fact_ids = {item.fact_id for item in updated.critical_facts}
        fact_index = len(used_fact_ids) + 1
        while f"fact_user_placement_{fact_index}" in used_fact_ids:
            fact_index += 1
        fact = CriticalFact(
            factId=f"fact_user_placement_{fact_index}",
            kind="identifier" if identifier else "required-phrase",
            canonicalText=canonical,
            sourceRefs=["topic:brief"],
        )
        updated.critical_facts.append(fact)
    updated.communication_contract.required_facts = list(
        dict.fromkeys([*updated.communication_contract.required_facts, fact.fact_id])
    )
    updated.communication_contract.placement_constraints = [
        constraint
        for constraint in updated.communication_contract.placement_constraints
        if not (
            constraint.slide_role == "cover" and constraint.element_role == element_role
        )
    ]
    updated.communication_contract.placement_constraints.append(
        PlacementConstraint(
            targetId=fact.fact_id,
            slideRole="cover",
            elementRole=element_role,
            slideOrder=1,
        )
    )
    return updated


def apply_user_required_obligations(
    raw_input: RawInput,
    plan: GeneratedStoryPlan,
) -> GeneratedStoryPlan:
    sentences = [
        sentence.strip(" -:\t")
        for sentence in re.split(r"[\n.!?]+", raw_input.prompt)
        if sentence.strip()
        and any(marker in sentence for marker in USER_REQUIRED_MARKERS)
    ]
    if not sentences:
        return plan
    updated = plan.model_copy(deep=True)
    existing_evidence = {
        normalized_text(obligation.evidence_text)
        for obligation in updated.evidence_obligations
    }
    used_obligation_ids = {
        obligation.obligation_id for obligation in updated.evidence_obligations
    }
    for sentence in sentences:
        cleaned = re.sub(
            r"^(?:반드시\s*포함|주의|제외|예외|조건|금지)\s*[:：-]?\s*",
            "",
            sentence,
        ).strip()
        cleaned = re.sub(
            r"반드시\s*포함(?:해|할|해야|해주세요|해줘)?",
            "",
            cleaned,
        ).strip(" ,:을를")
        identifiers = EXPLICIT_IDENTIFIER.findall(sentence)
        identifier = identifiers[-1] if identifiers else ""
        quoted = next(iter(QUOTED_PHRASE.findall(sentence)), "")
        canonical = identifier or quoted.strip() or cleaned or sentence
        if "금지" in sentence or "제외" in sentence:
            if canonical:
                updated.communication_contract.forbidden_claims = list(
                    dict.fromkeys(
                        [*updated.communication_contract.forbidden_claims, canonical]
                    )
                )
            continue
        if normalized_text(sentence) in existing_evidence:
            continue
        obligation_index = len(used_obligation_ids) + 1
        while f"obligation_user_{obligation_index}" in used_obligation_ids:
            obligation_index += 1
        obligation_id = f"obligation_user_{obligation_index}"
        updated.evidence_obligations.append(
            EvidenceObligation(
                obligationId=obligation_id,
                canonicalText=canonical,
                evidenceText=sentence,
                sourceRefs=["topic:brief"],
                reason="user-required",
                mustInclude=True,
            )
        )
        used_obligation_ids.add(obligation_id)
        existing_evidence.add(normalized_text(sentence))
    return updated


def validate_story_plan(
    raw_input: RawInput,
    plan: GeneratedStoryPlan,
    *,
    seed_issues: list[ContentFactIssue] | None = None,
) -> list[ContentFactIssue]:
    issues = list(seed_issues or [])
    slide_text = {
        order: f"{slide.title}\n{slide.message}"
        for order, slide in enumerate(plan.slides, start=1)
    }
    slide_refs = {
        order: set(slide.source_refs)
        for order, slide in enumerate(plan.slides, start=1)
    }
    slide_types = {
        order: slide.slide_type
        for order, slide in enumerate(plan.slides, start=1)
    }
    placements = {
        constraint.target_id: constraint
        for constraint in plan.communication_contract.placement_constraints
    }

    for fact in plan.critical_facts:
        order = _fact_target_order(
            fact,
            fact.source_refs,
            slide_text,
            slide_refs,
            placements,
            slide_types,
        )
        if not _fact_matches(fact, slide_text.get(order, "")):
            issues.append(
                ContentFactIssue(
                    code=_fact_issue_code(fact),
                    message=_fact_issue_message(fact),
                    slideOrder=order,
                    priority=2,
                    mustInclude=True,
                )
            )

    obligation_by_id = {
        obligation.obligation_id: obligation for obligation in plan.evidence_obligations
    }
    for obligation in plan.evidence_obligations:
        assigned = [
            order
            for order, slide in enumerate(plan.slides, start=1)
            if obligation.obligation_id in slide.obligation_refs
        ]
        order = (
            assigned[0]
            if assigned
            else _target_order(
                obligation.obligation_id,
                obligation.canonical_text,
                obligation.source_refs,
                slide_text,
                slide_refs,
                placements,
                slide_types,
            )
        )
        if not assigned:
            issues.append(
                ContentFactIssue(
                    code="EVIDENCE_OBLIGATION_MISSING",
                    message="핵심 근거를 담당할 슬라이드가 지정되지 않았습니다.",
                    slideOrder=order,
                    priority=_obligation_priority(obligation),
                    mustInclude=obligation.must_include,
                )
            )
        elif obligation.must_include and not _claim_matches(
            obligation.canonical_text,
            slide_text[order],
        ):
            issues.append(
                ContentFactIssue(
                    code="EVIDENCE_OBLIGATION_DISTORTED",
                    message="핵심 근거의 수치·주체·조건 또는 의미가 충분히 보존되지 않았습니다.",
                    slideOrder=order,
                    priority=_obligation_priority(obligation),
                    mustInclude=obligation.must_include,
                )
            )

    for forbidden in plan.communication_contract.forbidden_claims:
        needle = _compact(forbidden)
        if not needle:
            continue
        for order, text in slide_text.items():
            if needle in _compact(text):
                issues.append(
                    ContentFactIssue(
                        code="FACT_FORBIDDEN_CLAIM",
                        message="사용자가 금지한 주장이 슬라이드에 포함되었습니다.",
                        slideOrder=order,
                        priority=1,
                        mustInclude=True,
                    )
                )

    for target_id, constraint in placements.items():
        target = next(
            (fact for fact in plan.critical_facts if fact.fact_id == target_id),
            obligation_by_id.get(target_id),
        )
        if target is None:
            continue
        order = resolve_constraint_order(
            constraint.slide_role,
            constraint.slide_order,
            slide_types,
        )
        slide = plan.slides[order - 1]
        element_text = (
            slide.title if constraint.element_role == "title" else slide.message
        )
        canonical = target.canonical_text
        if not _claim_matches(canonical, element_text):
            issues.append(
                ContentFactIssue(
                    code="FACT_PLACEMENT_MISMATCH",
                    message="필수 사실 또는 문구가 요청된 슬라이드 위치에 배치되지 않았습니다.",
                    slideOrder=order,
                    priority=1,
                    mustInclude=True,
                )
            )
    return _unique_issues(issues)


def select_repair_slide_orders(issues: list[ContentFactIssue]) -> list[int]:
    grouped: dict[int, list[ContentFactIssue]] = defaultdict(list)
    for issue in issues:
        if issue.code == "EVIDENCE_OBLIGATION_SOURCE_INVALID":
            continue
        grouped[issue.slide_order].append(issue)
    ranked = sorted(
        grouped,
        key=lambda order: (
            min(issue.priority for issue in grouped[order]),
            -len(grouped[order]),
            -int(any(issue.must_include for issue in grouped[order])),
            order,
        ),
    )
    return ranked[:3]


def validate_slide_detail(
    raw_input: RawInput,
    target: SlidePlan,
    all_slides: list[SlidePlan],
) -> tuple[list[ContentFactIssue], int]:
    started = time.perf_counter()
    visible = "\n".join(
        [target.title, target.message, *[item.text for item in target.content_items]]
    )
    all_text = f"{visible}\n{target.speaker_notes}"
    story_text = {
        slide.order: f"{slide.title}\n{slide.message}" for slide in all_slides
    }
    story_refs = {slide.order: set(slide.source_refs) for slide in all_slides}
    slide_types = {slide.order: slide.slide_type for slide in all_slides}
    placements = {
        constraint.target_id: constraint
        for constraint in raw_input.communication_contract.placement_constraints
    }
    issues: list[ContentFactIssue] = []
    for fact in raw_input.critical_facts:
        order = _fact_target_order(
            fact,
            fact.source_refs,
            story_text,
            story_refs,
            placements,
            slide_types,
        )
        if order == target.order and not _fact_matches(fact, all_text):
            issues.append(
                ContentFactIssue(
                    code=_fact_issue_code(fact),
                    message=_fact_issue_message(fact),
                    slideOrder=order,
                    priority=2,
                    mustInclude=True,
                )
            )
    obligations = {item.obligation_id: item for item in raw_input.evidence_obligations}
    for obligation_id in target.obligation_refs:
        obligation = obligations.get(obligation_id)
        if obligation is None:
            continue
        haystack = visible if obligation.must_include else all_text
        if not _claim_matches(obligation.canonical_text, haystack):
            issues.append(
                ContentFactIssue(
                    code="EVIDENCE_OBLIGATION_DISTORTED",
                    message="핵심 근거의 수치·주체·조건 또는 의미가 충분히 보존되지 않았습니다.",
                    slideOrder=target.order,
                    priority=_obligation_priority(obligation),
                    mustInclude=obligation.must_include,
                )
            )
    for forbidden in raw_input.communication_contract.forbidden_claims:
        if _compact(forbidden) and _compact(forbidden) in _compact(all_text):
            issues.append(
                ContentFactIssue(
                    code="FACT_FORBIDDEN_CLAIM",
                    message="사용자가 금지한 주장이 슬라이드에 포함되었습니다.",
                    slideOrder=target.order,
                    priority=1,
                    mustInclude=True,
                )
            )
    for constraint in raw_input.communication_contract.placement_constraints:
        order = resolve_constraint_order(
            constraint.slide_role,
            constraint.slide_order,
            slide_types,
        )
        if order != target.order:
            continue
        placement_fact = next(
            (
                item
                for item in raw_input.critical_facts
                if item.fact_id == constraint.target_id
            ),
            None,
        )
        obligation = obligations.get(constraint.target_id)
        canonical = (
            placement_fact.canonical_text
            if placement_fact
            else obligation.canonical_text
            if obligation
            else ""
        )
        element_text = {
            "title": target.title,
            "subtitle": target.message,
            "message": target.message,
            "body": "\n".join(item.text for item in target.content_items),
        }[constraint.element_role]
        if canonical and not _claim_matches(canonical, element_text):
            issues.append(
                ContentFactIssue(
                    code="FACT_PLACEMENT_MISMATCH",
                    message="필수 사실 또는 문구가 요청된 슬라이드 위치에 배치되지 않았습니다.",
                    slideOrder=target.order,
                    priority=1,
                    mustInclude=True,
                )
            )
    issues.extend(
        issue
        for issue in raw_input.fact_quality_issues
        if issue.slide_order == target.order
        and issue.code
        in {
            "EVIDENCE_OBLIGATION_MISSING",
            "EVIDENCE_OBLIGATION_SOURCE_INVALID",
        }
    )
    return _unique_issues(issues), round((time.perf_counter() - started) * 1000)


def as_validation_issues(
    issues: list[ContentFactIssue],
    *,
    local_slide_index: int = 0,
) -> list[ValidationIssue]:
    return [
        ValidationIssue(
            code=issue.code,
            scope="slide",
            severity="warning",
            blocking=False,
            path=f"slides.{local_slide_index}.content",
            message=issue.message,
        )
        for issue in _unique_issues(issues)
    ]


def _target_order(
    target_id: str,
    canonical_text: str,
    source_refs: list[str],
    slide_text: dict[int, str],
    slide_refs: dict[int, set[str]],
    placements: dict[str, PlacementConstraint],
    slide_types: Mapping[int, str],
) -> int:
    constraint = placements.get(target_id)
    if constraint is not None:
        return resolve_constraint_order(
            getattr(constraint, "slide_role"),
            getattr(constraint, "slide_order"),
            slide_types,
        )
    candidate_orders = body_slide_orders(slide_types)
    matching_order = next(
        (
            order
            for order, text in slide_text.items()
            if order in candidate_orders and _claim_matches(canonical_text, text)
        ),
        None,
    )
    if matching_order is not None:
        return matching_order
    refs = set(source_refs)
    return next(
        (
            order
            for order, current in slide_refs.items()
            if order in candidate_orders and refs & current
        ),
        candidate_orders[0] if candidate_orders else 1,
    )


def _fact_target_order(
    fact: CriticalFact,
    source_refs: list[str],
    slide_text: dict[int, str],
    slide_refs: dict[int, set[str]],
    placements: dict[str, PlacementConstraint],
    slide_types: Mapping[int, str],
) -> int:
    constraint = placements.get(fact.fact_id)
    if constraint is not None:
        return resolve_constraint_order(
            getattr(constraint, "slide_role"),
            getattr(constraint, "slide_order"),
            slide_types,
        )
    candidate_orders = body_slide_orders(slide_types)
    matched = next(
        (
            order
            for order, text in slide_text.items()
            if order in candidate_orders and _fact_matches(fact, text)
        ),
        None,
    )
    if matched is not None:
        return matched
    related = next(
        (
            order
            for order, text in slide_text.items()
            if order in candidate_orders and _fact_related(fact, text)
        ),
        None,
    )
    if related is not None:
        return related
    refs = set(source_refs)
    return next(
        (
            order
            for order, current in slide_refs.items()
            if order in candidate_orders and refs & current
        ),
        candidate_orders[0] if candidate_orders else 1,
    )


def _fact_related(fact: CriticalFact, text: str) -> bool:
    compact = _compact(text)
    if fact.kind in {"amount", "metric"}:
        expected_numbers = set(NUMBER.findall(fact.value or fact.canonical_text))
        return (
            bool(money_values(text))
            or bool(expected_numbers & set(NUMBER.findall(text)))
        ) and (not fact.unit or _compact(fact.unit).replace("원", "") in compact)
    if fact.kind == "actor-relation":
        return any(_compact(actor) in compact for actor in fact.actors)
    tokens = re.findall(r"[가-힣A-Za-z0-9_]{2,}", normalized_text(fact.canonical_text))
    return bool(tokens) and any(_compact(token) in compact for token in tokens)


def _fact_matches(fact: CriticalFact, text: str) -> bool:
    if fact.kind in {"amount", "metric"}:
        amount = expected_amount(fact)
        if amount is not None:
            return amount in money_values(text) and (
                not fact.qualifier or _compact(fact.qualifier) in _compact(text)
            )
        expected_numbers = set(NUMBER.findall(fact.value or fact.canonical_text))
        actual_numbers = set(NUMBER.findall(text))
        return (
            expected_numbers <= actual_numbers
            and (not fact.unit or _compact(fact.unit) in _compact(text))
            and (not fact.qualifier or _compact(fact.qualifier) in _compact(text))
        )
    if fact.kind == "actor-relation":
        relation_segments = [
            segment
            for segment in re.split(r"[\n.!?]+", text)
            if not fact.relation or _compact(fact.relation) in _compact(segment)
        ]
        relation_text = " ".join(relation_segments) or text
        compact = _compact(relation_text)
        expected_actors = {_compact(actor) for actor in fact.actors if actor.strip()}
        actual_actors = {_compact(actor) for actor in ACTOR.findall(relation_text)}
        if not expected_actors <= compact_actor_set(compact, expected_actors):
            return False
        if actual_actors - expected_actors:
            return False
        if fact.relation and _compact(fact.relation) not in compact:
            return False
        return not fact.joint or any(marker in compact for marker in ("공동", "모두"))
    if fact.kind == "condition":
        compact = _compact(text)
        protected = [fact.operator, fact.threshold, fact.deadline]
        return _claim_matches(fact.canonical_text, text) and all(
            not value or _compact(value) in compact for value in protected
        )
    return _compact(fact.canonical_text) in _compact(text)


def compact_actor_set(compact_text: str, actors: set[str]) -> set[str]:
    return {actor for actor in actors if actor in compact_text}


def _claim_matches(expected: str, actual: str) -> bool:
    expected_compact = _compact(expected)
    actual_compact = _compact(actual)
    if expected_compact and expected_compact in actual_compact:
        return True
    expected_numbers = set(NUMBER.findall(expected))
    if not expected_numbers <= set(NUMBER.findall(actual)):
        return False
    for markers in (NEGATION_MARKERS, EXCEPTION_MARKERS, MODAL_MARKERS):
        protected = {marker for marker in markers if marker in expected_compact}
        if not protected <= {marker for marker in markers if marker in actual_compact}:
            return False
    tokens = {
        token
        for token in re.findall(r"[가-힣A-Za-z0-9_]{2,}", normalized_text(expected))
        if not token.isdigit()
    }
    if not tokens:
        return False
    actual_tokens = set(re.findall(r"[가-힣A-Za-z0-9_]{2,}", normalized_text(actual)))
    return len(tokens & actual_tokens) / len(tokens) >= 0.6


def _fact_issue_code(fact: CriticalFact) -> str:
    if fact.kind in {"amount", "metric"}:
        return "FACT_AMOUNT_MISMATCH"
    if fact.kind == "actor-relation":
        return "FACT_APPROVAL_RELATION_MISMATCH"
    if fact.kind in {"identifier", "product-name", "required-phrase"}:
        return "FACT_EXACT_PHRASE_MISMATCH"
    return "FACT_REQUIRED_MISSING"


def _fact_issue_message(fact: CriticalFact) -> str:
    return {
        "FACT_AMOUNT_MISMATCH": "금액 또는 지표의 값·단위·한정 표현이 원문과 일치하지 않습니다.",
        "FACT_APPROVAL_RELATION_MISMATCH": "승인 주체 또는 역할 관계가 원문과 일치하지 않습니다.",
        "FACT_EXACT_PHRASE_MISMATCH": "필수 식별자·제품명 또는 문구가 정확히 보존되지 않았습니다.",
        "FACT_REQUIRED_MISSING": "필수 사실의 조건·날짜 또는 제약이 충분히 보존되지 않았습니다.",
    }[_fact_issue_code(fact)]


def _obligation_priority(obligation: EvidenceObligation) -> int:
    return {
        "user-required": 1,
        "decision-critical": 3,
        "source-emphasized": 4,
    }[obligation.reason]


def _unique_issues(issues: list[ContentFactIssue]) -> list[ContentFactIssue]:
    seen: set[tuple[str, int, str]] = set()
    result: list[ContentFactIssue] = []
    for issue in issues:
        key = (issue.code, issue.slide_order, issue.message)
        if key in seen:
            continue
        seen.add(key)
        result.append(issue)
    return result
