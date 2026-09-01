import json
from types import SimpleNamespace
from typing import Any

import app.slide_question_guides as slide_question_guides_module
from app.slide_question_guides import (
    SlideQuestionGuideRequest,
    generate_deterministic_slide_question_guides,
    generate_slide_question_guides,
    generate_slide_question_guides_route,
)


def test_generates_three_grounded_questions_with_strict_ai_output() -> None:
    request = source_request()
    source_ref = {
        "kind": "slide",
        "slideId": "slide-1",
        "objectId": None,
        "deckVersion": 3,
        "contentHash": "a" * 64,
    }
    items = [
        {
            "questionType": question_type,
            "questionText": f"{question_type} 질문",
            "supportState": "grounded",
            "keyConcepts": [{"label": "시장 진입", "sourceRefs": [source_ref]}],
            "suggestedAnswer": {
                "summary": "교육 시장에서 먼저 검증합니다.",
                "structure": ["결론", "근거", "한계"],
                "caveats": ["제공된 근거 밖의 수치는 단정하지 않습니다."],
            },
            "remediation": None,
            "sourceRefs": [source_ref],
        }
        for question_type in ["evidence", "objection", "decision"]
    ]
    client = FakeClient({"items": items})

    response = generate_slide_question_guides(
        request,
        model="test-model",
        api_key=None,
        client=client,
    )

    payload = response.model_dump(by_alias=True)
    assert len(payload["items"]) == 3
    assert all(item["supportState"] == "grounded" for item in payload["items"])
    assert payload["items"][0]["sourceRefs"] == [source_ref]
    assert client.responses.last_request["model"] == "test-model"
    response_format = client.responses.last_request["text"]["format"]
    serialized_schema = json.dumps(response_format["schema"])
    assert response_format["strict"] is True
    assert '"anyOf"' in serialized_schema
    assert '"oneOf"' not in serialized_schema
    assert '"discriminator"' not in serialized_schema
    generation_input = json.loads(client.responses.last_request["input"])
    assert generation_input["targetSlideId"] == "slide-1"
    assert [slide["slideId"] for slide in generation_input["slides"]] == [
        "slide-1",
        "slide-2",
    ]
    assert generation_input["slides"][1]["speakerNotes"] == (
        "다음 슬라이드에서 실행 순서를 설명합니다."
    )
    assert payload["timings"]["webSearchMs"] >= 0
    assert payload["timings"]["generationMs"] >= 0


def test_returns_remediation_instead_of_calling_ai_without_sources() -> None:
    request = SlideQuestionGuideRequest.model_validate(
        {
            "targetSlideId": "slide-1",
            "deckVersion": 3,
            "slides": [
                {
                    "slideId": "slide-1",
                    "order": 1,
                    "deckVersion": 3,
                    "contentHash": "a" * 64,
                    "title": "",
                    "content": "",
                    "speakerNotes": "",
                }
            ],
            "references": [],
            "brief": None,
            "questionCount": 3,
        }
    )
    client = FakeClient({"items": []})

    response = generate_slide_question_guides(
        request,
        model="test-model",
        api_key=None,
        client=client,
    )

    payload = response.model_dump(by_alias=True)
    assert all(item["supportState"] == "insufficient" for item in payload["items"])
    assert all(item["suggestedAnswer"] is None for item in payload["items"])
    assert all(item["remediation"] is not None for item in payload["items"])
    assert client.responses.last_request is None


def test_uses_only_vetted_official_web_sources_and_keeps_search_query_bounded() -> None:
    request = source_request()
    client = OfficialWebClient()

    response = generate_slide_question_guides(
        request,
        model="test-model",
        api_key=None,
        client=client,
    )

    payload = response.model_dump(by_alias=True)
    assert payload["research"] == {
        "status": "succeeded",
        "attempts": 1,
        "officialSourceCount": 1,
        "issueCodes": [],
        "researchedAt": payload["research"]["researchedAt"],
    }
    assert payload["webSources"][0]["authority"] == "official"
    assert payload["items"][0]["sourceRefs"] == [payload["webSources"][0]]
    assert len(client.responses.requests) == 2
    search_request = client.responses.requests[0]
    assert search_request["tools"] == [
        {"type": "web_search", "search_context_size": "low"}
    ]
    assert "시장 진입 전략" in search_request["input"]
    assert "첫 고객군을 교육 시장으로 한정" not in search_request["input"]
    assert "초기 전환율은 12%" not in search_request["input"]
    assert "발표 대본" not in search_request["input"]


def test_web_search_failure_degrades_to_slide_only_generation() -> None:
    request = source_request()
    source_ref = {
        "kind": "slide",
        "slideId": "slide-1",
        "objectId": None,
        "deckVersion": 3,
        "contentHash": "a" * 64,
    }
    items = grounded_items(source_ref)
    client = SearchFailureClient({"items": items})

    response = generate_slide_question_guides(
        request,
        model="test-model",
        api_key=None,
        client=client,
    )

    payload = response.model_dump(by_alias=True)
    assert payload["research"]["status"] == "unavailable"
    assert payload["research"]["attempts"] == 1
    assert payload["research"]["issueCodes"] == ["provider-call-failed"]
    assert payload["webSources"] == []
    assert all(item["supportState"] == "grounded" for item in payload["items"])


def test_deterministic_provider_delays_and_returns_valid_items() -> None:
    delays: list[float] = []

    first = generate_deterministic_slide_question_guides(
        source_request(),
        seed=42,
        error_rate_percent=0,
        sleeper=delays.append,
    )
    second = generate_deterministic_slide_question_guides(
        source_request(),
        seed=42,
        error_rate_percent=0,
        sleeper=delays.append,
    )

    assert len(delays) == 2
    assert 20 <= delays[0] <= 30
    assert delays[0] == delays[1]
    assert first == second
    payload = first.model_dump(by_alias=True)
    assert payload["model"] == "deterministic-load-test-v1"
    assert [item["questionType"] for item in payload["items"]] == [
        "evidence",
        "objection",
        "decision",
    ]
    assert all(item["supportState"] == "grounded" for item in payload["items"])
    assert all(
        item["sourceRefs"][0]["slideId"] == "slide-1" for item in payload["items"]
    )
    assert 20_000 <= payload["timings"]["totalProviderMs"] <= 30_000


def test_route_uses_deterministic_provider_without_openai(
    monkeypatch: Any,
) -> None:
    delays: list[float] = []
    monkeypatch.setattr(slide_question_guides_module.time, "sleep", delays.append)
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                config=SimpleNamespace(
                    load_test_provider_mode="deterministic",
                    load_test_provider_seed=7,
                    load_test_provider_error_rate_percent=0,
                    openai_model="unused",
                    openai_api_key=None,
                )
            )
        )
    )

    response = generate_slide_question_guides_route(source_request(), request)

    assert len(delays) == 1
    assert 20 <= delays[0] <= 30
    assert response.model == "deterministic-load-test-v1"


def source_request() -> SlideQuestionGuideRequest:
    return SlideQuestionGuideRequest.model_validate(
        {
            "targetSlideId": "slide-1",
            "deckVersion": 3,
            "slides": [
                {
                    "slideId": "slide-1",
                    "order": 1,
                    "deckVersion": 3,
                    "contentHash": "a" * 64,
                    "title": "시장 진입 전략",
                    "content": "첫 고객군을 교육 시장으로 한정하고 검증합니다.",
                    "speakerNotes": "현재 슬라이드 발표 대본입니다.",
                },
                {
                    "slideId": "slide-2",
                    "order": 2,
                    "deckVersion": 3,
                    "contentHash": "c" * 64,
                    "title": "실행 순서",
                    "content": "검증 이후 확장합니다.",
                    "speakerNotes": "다음 슬라이드에서 실행 순서를 설명합니다.",
                },
            ],
            "references": [
                {
                    "fileId": "file-1",
                    "chunkId": "chunk-1",
                    "contentHash": "b" * 64,
                    "content": "교육 시장의 초기 전환율은 12%입니다.",
                }
            ],
            "brief": None,
            "questionCount": 3,
        }
    )


def grounded_items(source_ref: dict[str, object]) -> list[dict[str, object]]:
    return [
        {
            "questionType": question_type,
            "questionText": f"{question_type} 질문",
            "supportState": "grounded",
            "keyConcepts": [{"label": "공식 근거", "sourceRefs": [source_ref]}],
            "suggestedAnswer": {
                "summary": "제공된 공식 근거 범위에서 답합니다.",
                "structure": ["결론", "근거"],
                "caveats": [],
            },
            "remediation": None,
            "sourceRefs": [source_ref],
        }
        for question_type in ["evidence", "objection", "decision"]
    ]


class FakeResponses:
    def __init__(self, output: dict[str, object]) -> None:
        self.output = output
        self.last_request: dict[str, Any] | None = None

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.last_request = kwargs
        output = {"officialSourceIds": [], **self.output}
        return SimpleNamespace(output_text=json.dumps(output, ensure_ascii=False))


class FakeClient:
    def __init__(self, output: dict[str, object]) -> None:
        self.responses = FakeResponses(output)


class OfficialWebResponses:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.requests.append(kwargs)
        if kwargs.get("tools"):
            text = "KAIST 공식 페이지는 교육과정의 프로젝트 기반 학습을 설명합니다. [공식 안내]"
            start = text.index("[공식 안내]")
            return SimpleNamespace(
                output_text=text,
                output=[
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": text,
                                "annotations": [
                                    {
                                        "type": "url_citation",
                                        "url": "https://kaist.example.edu/program?utm_source=test",
                                        "title": "KAIST 공식 교육과정",
                                        "start_index": start,
                                        "end_index": len(text),
                                    }
                                ],
                            }
                        ],
                    }
                ],
            )
        generation_input = json.loads(kwargs["input"])
        candidate = generation_input["webSourceCandidates"][0]
        web_source = {
            "kind": "web",
            "sourceId": candidate["sourceId"],
            "url": candidate["url"],
            "title": candidate["title"],
            "authority": "official",
            "contentHash": candidate["contentHash"],
            "retrievedAt": candidate["retrievedAt"],
        }
        return SimpleNamespace(
            output_text=json.dumps(
                {
                    "items": grounded_items(web_source),
                    "officialSourceIds": [candidate["sourceId"]],
                },
                ensure_ascii=False,
            )
        )


class OfficialWebClient:
    def __init__(self) -> None:
        self.responses = OfficialWebResponses()


class SearchFailureResponses:
    def __init__(self, output: dict[str, object]) -> None:
        self.output = output

    def create(self, **kwargs: Any) -> SimpleNamespace:
        if kwargs.get("tools"):
            raise RuntimeError("provider unavailable")
        return SimpleNamespace(
            output_text=json.dumps(
                {"officialSourceIds": [], **self.output},
                ensure_ascii=False,
            )
        )


class SearchFailureClient:
    def __init__(self, output: dict[str, object]) -> None:
        self.responses = SearchFailureResponses(output)
