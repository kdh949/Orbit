from pathlib import Path

from app.ai.deck_generation.design_pack_evaluation import (
    evaluate_golden_briefs,
    load_golden_briefs,
)


FIXTURES = Path(__file__).parent / "fixtures/design-pack-golden"


def test_four_family_golden_report_passes_shared_rubric() -> None:
    report = evaluate_golden_briefs(load_golden_briefs(FIXTURES))

    assert report["fixtureCount"] == 4
    assert report["passed"] is True
    assert report["humanEvaluation"] == {
        "blindPreferencePercent": None,
        "presentationReadyRating": None,
        "status": "not-measured",
    }
    assert all(
        family["selectedPackId"] == family["expectedPackId"]
        for family in report["families"]
    )
    assert all(family["new"]["score"] >= 85 for family in report["families"])
    assert all(family["new"]["publicationP0"] == 0 for family in report["families"])
    assert all(family["new"]["publicationP1"] == 0 for family in report["families"])
