from datetime import date

from app.ai.deck_generation.content_fact_quality import (
    apply_explicit_user_placements,
    as_validation_issues,
    expected_amount,
    sanitize_evidence_obligations,
    select_repair_slide_orders,
    validate_story_plan,
)
from app.ai.deck_generation.content_planning import (
    normalize_story_structural_policy,
)
from app.ai.deck_generation.models import (
    CommunicationContract,
    ContentFactIssue,
    CriticalFact,
    EvidenceObligation,
    GenerateDeckRequest,
    GeneratedStoryPlan,
    GeneratedStorySlide,
    PlacementConstraint,
)
from app.ai.deck_generation.pipeline import analyze_input
from app.ai.deck_generation.source_grounding import ground_sources


def raw_input():
    return ground_sources(
        analyze_input(
            GenerateDeckRequest(
                projectId="project_fact_qa",
                topic="PROJECT_COBALT_7421",
                prompt="운영 책임자와 보안 책임자의 공동 승인이 필요하며 예산은 37억 4천만 원이다.",
            )
        ),
        current_date=date(2026, 7, 18),
    ).raw_input


def test_korean_money_and_actor_relation_mismatches_are_advisory() -> None:
    raw = raw_input()
    source_id = raw.source_records[0].source_id
    amount = CriticalFact(
        factId="fact_amount",
        kind="amount",
        canonicalText="37억 4천만 원",
        sourceRefs=[source_id],
        value="37.4",
        unit="억원",
    )
    actors = CriticalFact(
        factId="fact_actors",
        kind="actor-relation",
        canonicalText="운영 책임자와 보안 책임자의 공동 승인",
        sourceRefs=[source_id],
        actors=["운영 책임자", "보안 책임자"],
        relation="승인",
        joint=True,
    )
    plan = GeneratedStoryPlan(
        title="검증",
        slides=[
            GeneratedStorySlide(
                title="예산과 승인",
                message="예산은 37억 원이며 운영 책임자, 보안 책임자, 제품 책임자가 공동 승인한다.",
                slideType="cover",
                sourceRefs=[source_id],
            )
        ],
        criticalFacts=[amount, actors],
    )

    issues = validate_story_plan(raw, plan)

    assert expected_amount(amount) == 3_740_000_000
    assert {issue.code for issue in issues} == {
        "FACT_AMOUNT_MISMATCH",
        "FACT_APPROVAL_RELATION_MISMATCH",
    }
    assert all(issue.priority == 2 for issue in issues)
    assert all(not issue.blocking for issue in as_validation_issues(issues))


def test_invalid_domain_evidence_is_removed_and_repairs_are_limited_to_three() -> None:
    raw = raw_input()
    source_id = raw.source_records[0].source_id
    valid = EvidenceObligation(
        obligationId="obligation_valid",
        canonicalText="공동 승인이 필요하다",
        evidenceText="공동 승인이 필요하며",
        sourceRefs=[source_id],
        reason="decision-critical",
        mustInclude=True,
    )
    invalid = EvidenceObligation(
        obligationId="obligation_invalid",
        canonicalText="출처에 없는 의료 금기",
        evidenceText="출처에 존재하지 않는 문장",
        sourceRefs=[source_id],
        reason="user-required",
        mustInclude=True,
    )

    obligations, invalid_issues = sanitize_evidence_obligations(
        raw,
        [valid, invalid],
    )
    ranked = select_repair_slide_orders(
        [
            ContentFactIssue(
                code="FACT_REQUIRED_MISSING",
                message="missing",
                slideOrder=order,
                priority=2,
            )
            for order in range(1, 6)
        ]
        + invalid_issues
    )

    assert obligations == [valid]
    assert [issue.code for issue in invalid_issues] == [
        "EVIDENCE_OBLIGATION_SOURCE_INVALID"
    ]
    assert ranked == [1, 2, 3]


def test_all_typed_fact_kinds_share_the_same_repair_priority() -> None:
    kinds = [
        "identifier",
        "product-name",
        "amount",
        "date",
        "actor-relation",
        "metric",
        "condition",
        "required-phrase",
    ]
    issues = [
        ContentFactIssue(
            code=f"FACT_{kind.upper()}",
            message=kind,
            slideOrder=index,
            priority=2,
        )
        for index, kind in enumerate(kinds, start=1)
    ]

    assert select_repair_slide_orders(issues) == [1, 2, 3]
    assert {issue.priority for issue in issues} == {2}


def test_explicit_cover_subtitle_placement_overrides_story_inference() -> None:
    raw = analyze_input(
        GenerateDeckRequest(
            projectId="project_cover_fact",
            topic="제품 소개",
            prompt="PROJECT_COBALT_7421을 표지 부제에 표시해줘.",
        )
    )
    plan = GeneratedStoryPlan(
        title="제품 소개",
        slides=[
            GeneratedStorySlide(
                title="제품 소개",
                message="핵심 제안",
                slideType="cover",
                sourceRefs=["topic:brief"],
            )
        ],
        communicationContract=CommunicationContract(),
    )

    updated = apply_explicit_user_placements(raw, plan)

    assert updated.critical_facts[0].canonical_text == "PROJECT_COBALT_7421"
    placement = updated.communication_contract.placement_constraints[0]
    assert placement.slide_role == "cover"
    assert placement.element_role == "subtitle"


def test_structural_story_obligations_move_to_matching_body_slides() -> None:
    raw = raw_input()
    source_id = raw.source_records[0].source_id
    agenda_obligation = EvidenceObligation(
        obligationId="agenda_obligation",
        canonicalText="공동 승인이 필요하다",
        evidenceText="공동 승인이 필요하며",
        sourceRefs=[source_id],
        reason="decision-critical",
        mustInclude=True,
    )
    closing_obligation = EvidenceObligation(
        obligationId="closing_obligation",
        canonicalText="예산은 37억 4천만 원이다",
        evidenceText="예산은 37억 4천만 원이다",
        sourceRefs=[source_id],
        reason="user-required",
        mustInclude=True,
    )
    plan = GeneratedStoryPlan(
        title="구조 장표 정규화",
        slides=[
            GeneratedStorySlide(
                title="표지",
                message="발표 소개",
                slideType="cover",
                sourceRefs=[source_id],
            ),
            GeneratedStorySlide(
                title="목차",
                message="발표 순서",
                slideType="agenda",
                sourceRefs=[source_id],
                obligationRefs=[agenda_obligation.obligation_id],
            ),
            GeneratedStorySlide(
                title="승인 조건",
                message="운영 책임자와 보안 책임자의 공동 승인이 필요하다",
                slideType="problem",
                sourceRefs=[source_id],
            ),
            GeneratedStorySlide(
                title="예산",
                message="예산은 37억 4천만 원이다",
                slideType="data",
                sourceRefs=[source_id],
            ),
            GeneratedStorySlide(
                title="감사합니다",
                message="경청해 주셔서 감사합니다",
                slideType="closing",
                sourceRefs=[source_id],
                obligationRefs=[closing_obligation.obligation_id],
            ),
        ],
        evidenceObligations=[agenda_obligation, closing_obligation],
    )

    normalized = normalize_story_structural_policy(plan)

    assert normalized.slides[1].source_refs == []
    assert normalized.slides[1].obligation_refs == []
    assert normalized.slides[-1].source_refs == []
    assert normalized.slides[-1].obligation_refs == []
    assert normalized.slides[2].obligation_refs == ["agenda_obligation"]
    assert normalized.slides[3].obligation_refs == ["closing_obligation"]


def test_unmatched_structural_obligation_remains_unassigned() -> None:
    raw = raw_input()
    source_id = raw.source_records[0].source_id
    obligation = EvidenceObligation(
        obligationId="unmatched_obligation",
        canonicalText="완전히 다른 필수 조건",
        evidenceText="공동 승인이 필요하며",
        sourceRefs=["unmatched:source"],
        reason="user-required",
        mustInclude=True,
    )
    plan = normalize_story_structural_policy(
        GeneratedStoryPlan(
            title="미배치 obligation",
            slides=[
                GeneratedStorySlide(
                    title="표지",
                    message="발표 소개",
                    slideType="cover",
                ),
                GeneratedStorySlide(
                    title="목차",
                    message="발표 순서",
                    slideType="agenda",
                    obligationRefs=[obligation.obligation_id],
                ),
                GeneratedStorySlide(
                    title="본문",
                    message="공동 승인 절차",
                    slideType="problem",
                    sourceRefs=[source_id],
                ),
                GeneratedStorySlide(
                    title="감사합니다",
                    message="경청해 주셔서 감사합니다",
                    slideType="closing",
                ),
            ],
            evidenceObligations=[obligation],
        )
    )

    issues = validate_story_plan(raw, plan)

    assert all(
        obligation.obligation_id not in slide.obligation_refs
        for slide in plan.slides
    )
    assert "EVIDENCE_OBLIGATION_MISSING" in {issue.code for issue in issues}


def test_body_placement_on_agenda_order_resolves_to_first_body() -> None:
    raw = raw_input()
    source_id = raw.source_records[0].source_id
    fact = CriticalFact(
        factId="body_fact",
        kind="required-phrase",
        canonicalText="공동 승인이 필요하다",
        sourceRefs=[source_id],
    )
    plan = normalize_story_structural_policy(
        GeneratedStoryPlan(
            title="본문 배치",
            slides=[
                GeneratedStorySlide(
                    title="표지",
                    message="발표 소개",
                    slideType="cover",
                ),
                GeneratedStorySlide(
                    title="목차",
                    message="발표 순서",
                    slideType="agenda",
                ),
                GeneratedStorySlide(
                    title="승인 조건",
                    message="공동 승인이 필요하다",
                    slideType="problem",
                    sourceRefs=[source_id],
                ),
                GeneratedStorySlide(
                    title="실행 계획",
                    message="실행 계획을 설명한다",
                    slideType="process",
                ),
                GeneratedStorySlide(
                    title="감사합니다",
                    message="경청해 주셔서 감사합니다",
                    slideType="closing",
                ),
            ],
            criticalFacts=[fact],
            communicationContract=CommunicationContract(
                placementConstraints=[
                    PlacementConstraint(
                        targetId=fact.fact_id,
                        slideRole="body",
                        elementRole="message",
                        slideOrder=2,
                    )
                ]
            ),
        )
    )

    issues = validate_story_plan(raw, plan)

    assert "FACT_PLACEMENT_MISMATCH" not in {issue.code for issue in issues}


def test_unplaced_fact_falls_back_to_first_body() -> None:
    raw = raw_input()
    source_id = raw.source_records[0].source_id
    fact = CriticalFact(
        factId="missing_body_fact",
        kind="required-phrase",
        canonicalText="PROJECT_UNPLACED_991",
        sourceRefs=[source_id],
    )
    plan = normalize_story_structural_policy(
        GeneratedStoryPlan(
            title="본문 fallback",
            slides=[
                GeneratedStorySlide(
                    title="표지",
                    message="발표 소개",
                    slideType="cover",
                ),
                GeneratedStorySlide(
                    title="목차",
                    message="발표 순서",
                    slideType="agenda",
                ),
                GeneratedStorySlide(
                    title="첫 본문",
                    message="본문 내용",
                    slideType="problem",
                ),
                GeneratedStorySlide(
                    title="감사합니다",
                    message="경청해 주셔서 감사합니다",
                    slideType="closing",
                ),
            ],
            criticalFacts=[fact],
        )
    )

    issues = validate_story_plan(raw, plan)

    assert next(
        issue for issue in issues if issue.code == "FACT_EXACT_PHRASE_MISMATCH"
    ).slide_order == 3
