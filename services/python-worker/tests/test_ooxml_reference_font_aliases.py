from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from xml.etree import ElementTree as ET

import pytest
from pydantic import ValidationError

from app.ai.ooxml_reference_templates import font_aliases


def test_approved_alias_policy_rejects_family_axis_and_checksum_drift() -> None:
    policy = font_aliases.approved_font_alias_policy().model_dump(
        by_alias=True,
        mode="json",
    )

    for path, value in (
        (("aliases", 0, "targetFamily"), "Fallback"),
        (("aliases", 2, "axisValues", "opsz"), 12),
        (("aliases", 3, "sourceFontSha256"), "0" * 64),
    ):
        candidate = json.loads(json.dumps(policy))
        target: object = candidate
        for part in path[:-1]:
            target = target[part]  # type: ignore[index]
        target[path[-1]] = value  # type: ignore[index]
        with pytest.raises(ValidationError):
            font_aliases.ApprovedFontAliasPolicy.model_validate(candidate)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value.update(
            {"schema_version": value.pop("schemaVersion")}
        ),
        lambda value: value.update({"schemaVersion": True}),
        lambda value: value["aliases"][0].update(
            {"requested_typeface": value["aliases"][0].pop("requestedTypeface")}
        ),
        lambda value: value["aliases"][0].update({"targetFamily": " Lora "}),
    ],
)
def test_approved_alias_policy_matches_strict_shared_json_contract(
    mutate: object,
) -> None:
    policy = font_aliases.approved_font_alias_policy().model_dump(
        by_alias=True,
        mode="json",
    )
    mutate(policy)  # type: ignore[operator]

    with pytest.raises(ValidationError):
        font_aliases.ApprovedFontAliasPolicy.model_validate(policy)


def test_resolver_records_approved_alias_without_exposing_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected_sha256 = font_aliases.APPROVED_FONT_ALIAS_PAYLOADS[0][
        "sourceFontSha256"
    ]

    def fake_run(args: list[str], **_kwargs: object) -> SimpleNamespace:
        assert args[1] in {"Lora SemiBold", "Lora:style=SemiBold"}
        return SimpleNamespace(
            stdout=(
                "Lora\x1fSemiBold\x1fLora SemiBold\x1f"
                "\x1f180\x1f100\x1f/private/licensed/Lora.ttf"
            )
        )

    monkeypatch.setattr(font_aliases.subprocess, "run", fake_run)
    monkeypatch.setattr(
        font_aliases,
        "_file_sha256",
        lambda _path: expected_sha256,
    )

    resolution = font_aliases.inspect_font_resolution(
        "Lora SemiBold",
        ["source"],
        "fc-match",
        font_aliases.approved_font_alias_policy(),
    )

    assert resolution["status"] == "approved-alias"
    assert resolution["resolvedFamily"] == "Lora"
    assert resolution["resolvedStyle"] == "SemiBold"
    assert resolution["axisValues"]["wght"] == 600
    assert "/private/" not in json.dumps(resolution)


def test_resolver_rejects_family_style_weight_or_width_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected_sha256 = font_aliases.APPROVED_FONT_ALIAS_PAYLOADS[1][
        "sourceFontSha256"
    ]

    monkeypatch.setattr(
        font_aliases,
        "_query_font",
        lambda *_args, **_kwargs: {
            "family": "Roboto",
            "style": "SemiBold",
            "fullname": "Roboto SemiBold",
            "fontvariations": "",
            "weight": "80",
            "width": "75",
            "file": "/private/licensed/Roboto.ttf",
        },
    )
    monkeypatch.setattr(
        font_aliases,
        "_file_sha256",
        lambda _path: expected_sha256,
    )

    resolution = font_aliases.inspect_font_resolution(
        "Roboto SemiBold",
        ["generated"],
        "fc-match",
        font_aliases.approved_font_alias_policy(),
    )

    assert resolution["status"] == "alias-mismatch"


def test_resolver_rejects_variable_axis_or_file_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected_sha256 = font_aliases.APPROVED_FONT_ALIAS_PAYLOADS[2][
        "sourceFontSha256"
    ]

    monkeypatch.setattr(
        font_aliases.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            stdout=(
                "Roboto Serif,Roboto Serif 20pt\x1f"
                "20pt Regular,Regular\x1fRoboto Serif 20pt Regular\x1f"
                "GRAD=0,opsz=12,wdth=100,wght=400\x1f"
                "80\x1f100\x1f/private/licensed/RobotoSerif.ttf"
            )
        ),
    )
    monkeypatch.setattr(
        font_aliases,
        "_file_sha256",
        lambda _path: expected_sha256,
    )

    resolution = font_aliases.inspect_font_resolution(
        "Roboto Serif 14pt",
        ["generated"],
        "fc-match",
        font_aliases.approved_font_alias_policy(),
    )

    assert resolution["status"] == "alias-mismatch"
    assert resolution["sha256"] == expected_sha256
    assert "/private/" not in json.dumps(resolution)


def test_resolver_preserves_existing_exact_family_behavior(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    font = tmp_path / "exact.ttf"
    font.write_bytes(b"exact")
    monkeypatch.setattr(
        font_aliases.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            stdout=(
                f"Exact Family\x1fRegular\x1fExact Family\x1f"
                f"\x1f80\x1f100\x1f{font}"
            )
        ),
    )

    resolution = font_aliases.inspect_font_resolution(
        "Exact Family",
        ["source"],
        "fc-match",
        None,
    )

    assert resolution["status"] == "exact"
    assert resolution["resolvedFamily"] == "Exact Family"
    assert str(tmp_path) not in json.dumps(resolution)


def test_fontconfig_overlay_uses_pattern_rewrite_without_scan_alias() -> None:
    path = (
        Path(__file__).resolve().parents[1]
        / "config"
        / "ooxml-reference-font-aliases.conf"
    )
    root = ET.fromstring(path.read_bytes())
    matches = root.findall("match")
    scoped_config = (
        Path(__file__).resolve().parents[1]
        / "config"
        / "ooxml-reference-fontconfig.conf"
    )
    scoped_root = ET.fromstring(scoped_config.read_bytes())
    dockerfile = (
        Path(__file__).resolve().parents[3]
        / "infra"
        / "docker"
        / "python-worker.Dockerfile"
    ).read_text(encoding="utf-8")

    assert len(matches) == 4
    assert all(match.get("target") == "pattern" for match in matches)
    assert b'target="scan"' not in path.read_bytes()
    assert "/etc/fonts/conf.d" not in dockerfile
    assert [include.text for include in scoped_root.findall("include")] == [
        "/etc/fonts/fonts.conf",
        "/etc/orbit-fontconfig/ooxml-reference-font-aliases.conf",
    ]
