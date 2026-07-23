from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
from collections.abc import Mapping
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel


Sha256 = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
REFERENCE_FONTCONFIG_FILE = Path("/etc/orbit-fontconfig/fonts.conf")
_FONTCONFIG_WEIGHT_BY_WGHT = {600: 180.0}


class _StrictModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_alias=True,
        validate_by_name=False,
        extra="forbid",
        frozen=True,
        strict=True,
        str_strip_whitespace=False,
    )


class FontAliasAxisValues(_StrictModel):
    grad: int | None = Field(alias="GRAD", default=None, strict=True)
    opsz: int | None = Field(default=None, strict=True)
    wdth: int | None = Field(default=None, strict=True)
    wght: int = Field(strict=True)


class FontAliasLicense(_StrictModel):
    spdx_id: Literal["OFL-1.1"]
    sha256: Sha256


class FontAliasApproval(_StrictModel):
    status: Literal["approved"]
    approved_on: Literal["2026-07-23"]


class ApprovedFontAlias(_StrictModel):
    requested_typeface: Annotated[str, Field(min_length=1, max_length=200)]
    target_family: Annotated[str, Field(min_length=1, max_length=200)]
    target_style: Annotated[str, Field(min_length=1, max_length=100)]
    alias_kind: Literal["family-style", "variable-instance"]
    axis_values: FontAliasAxisValues
    source_font_sha256: Sha256
    license: FontAliasLicense
    approval: FontAliasApproval


class ApprovedFontAliasPolicy(_StrictModel):
    schema_version: Literal[1]
    resolver: Literal["fontconfig"]
    aliases: list[ApprovedFontAlias] = Field(min_length=4, max_length=4)

    @field_validator("schema_version", mode="before")
    @classmethod
    def validate_schema_version_type(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("schemaVersion must be an integer")
        return value

    @model_validator(mode="after")
    def validate_exact_approved_aliases(self) -> ApprovedFontAliasPolicy:
        payload = [
            alias.model_dump(by_alias=True, mode="json") for alias in self.aliases
        ]
        if payload != APPROVED_FONT_ALIAS_PAYLOADS:
            raise ValueError("font alias policy must match the approved v1 mapping")
        return self


APPROVED_FONT_ALIAS_PAYLOADS: list[dict[str, Any]] = [
    {
        "requestedTypeface": "Lora SemiBold",
        "targetFamily": "Lora",
        "targetStyle": "SemiBold",
        "aliasKind": "family-style",
        "axisValues": {
            "GRAD": None,
            "opsz": None,
            "wdth": None,
            "wght": 600,
        },
        "sourceFontSha256": (
            "822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7"
        ),
        "license": {
            "spdxId": "OFL-1.1",
            "sha256": (
                "1d9a970809ac804b582a6ce7f0ebc4e7fefcbfd7ff6299cad35ee656a21be716"
            ),
        },
        "approval": {"status": "approved", "approvedOn": "2026-07-23"},
    },
    {
        "requestedTypeface": "Roboto SemiBold",
        "targetFamily": "Roboto",
        "targetStyle": "SemiBold",
        "aliasKind": "family-style",
        "axisValues": {
            "GRAD": None,
            "opsz": None,
            "wdth": 100,
            "wght": 600,
        },
        "sourceFontSha256": (
            "d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134"
        ),
        "license": {
            "spdxId": "OFL-1.1",
            "sha256": (
                "061402327a96aadb0bfb694a960ed289ecd38d383e396243831ab81feb109c41"
            ),
        },
        "approval": {"status": "approved", "approvedOn": "2026-07-23"},
    },
    {
        "requestedTypeface": "Roboto Serif 14pt",
        "targetFamily": "Roboto Serif",
        "targetStyle": "Regular",
        "aliasKind": "variable-instance",
        "axisValues": {
            "GRAD": 0,
            "opsz": 14,
            "wdth": 100,
            "wght": 400,
        },
        "sourceFontSha256": (
            "351ced75f3851806aa6d846b669361521eb1925cfc530396df9c1a1b77061ddb"
        ),
        "license": {
            "spdxId": "OFL-1.1",
            "sha256": (
                "34dbfbb43e0b4fdeef445d77b9ac0b988e5ad7a9bbf16808c97b66c66d51f553"
            ),
        },
        "approval": {"status": "approved", "approvedOn": "2026-07-23"},
    },
    {
        "requestedTypeface": "Roboto Serif 14pt Medium",
        "targetFamily": "Roboto Serif",
        "targetStyle": "Medium",
        "aliasKind": "variable-instance",
        "axisValues": {
            "GRAD": 0,
            "opsz": 14,
            "wdth": 100,
            "wght": 500,
        },
        "sourceFontSha256": (
            "351ced75f3851806aa6d846b669361521eb1925cfc530396df9c1a1b77061ddb"
        ),
        "license": {
            "spdxId": "OFL-1.1",
            "sha256": (
                "34dbfbb43e0b4fdeef445d77b9ac0b988e5ad7a9bbf16808c97b66c66d51f553"
            ),
        },
        "approval": {"status": "approved", "approvedOn": "2026-07-23"},
    },
]


def approved_font_alias_policy() -> ApprovedFontAliasPolicy:
    return ApprovedFontAliasPolicy.model_validate(
        {
            "schemaVersion": 1,
            "resolver": "fontconfig",
            "aliases": APPROVED_FONT_ALIAS_PAYLOADS,
        }
    )


def canonical_font_alias_policy_sha256(
    policy: ApprovedFontAliasPolicy | Mapping[str, object],
) -> str:
    validated = (
        policy
        if isinstance(policy, ApprovedFontAliasPolicy)
        else ApprovedFontAliasPolicy.model_validate(policy)
    )
    content = json.dumps(
        validated.model_dump(by_alias=True, mode="json"),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(content).hexdigest()


def inspect_font_resolution(
    requested_typeface: str,
    roles: list[str],
    font_match: str | None,
    policy: ApprovedFontAliasPolicy | Mapping[str, object] | None,
) -> dict[str, Any]:
    base: dict[str, Any] = {
        "requestedFamily": requested_typeface,
        "roles": roles,
        "status": "unavailable",
        "resolvedFamily": None,
        "sha256": None,
    }
    if font_match is None:
        return base
    validated_policy = (
        None
        if policy is None
        else (
            policy
            if isinstance(policy, ApprovedFontAliasPolicy)
            else ApprovedFontAliasPolicy.model_validate(policy)
        )
    )
    aliases = (
        {}
        if validated_policy is None
        else {alias.requested_typeface: alias for alias in validated_policy.aliases}
    )
    alias = aliases.get(requested_typeface)
    subprocess_environment = reference_fontconfig_subprocess_environment()
    resolution = _query_font(
        font_match,
        requested_typeface,
        subprocess_environment,
    )
    if resolution is None:
        return base
    checksum = _file_sha256(resolution["file"])
    if checksum is None:
        return base
    resolved_family = str(resolution["family"])[:500]
    if alias is None:
        if requested_typeface.casefold() not in _tokens(resolved_family):
            return {
                **base,
                "status": "substituted",
                "resolvedFamily": resolved_family,
                "sha256": checksum,
            }
        return {
            **base,
            "status": "exact",
            "resolvedFamily": resolved_family,
            "sha256": checksum,
        }

    target_resolution = _query_font(
        font_match,
        _target_pattern(alias),
        subprocess_environment,
    )
    if (
        target_resolution is None
        or not _matches_alias(resolution, checksum, alias)
        or not _matches_alias(
            target_resolution,
            _file_sha256(target_resolution["file"]),
            alias,
        )
        or resolution["file"] != target_resolution["file"]
    ):
        return {
            **base,
            "status": "alias-mismatch",
            "resolvedFamily": resolved_family,
            "sha256": checksum,
        }
    assert validated_policy is not None
    return {
        **base,
        "status": "approved-alias",
        "resolvedFamily": alias.target_family,
        "resolvedStyle": alias.target_style,
        "axisValues": alias.axis_values.model_dump(by_alias=True, mode="json"),
        "sha256": checksum,
        "licenseSha256": alias.license.sha256,
        "aliasPolicySha256": canonical_font_alias_policy_sha256(validated_policy),
    }


def reference_fontconfig_subprocess_environment() -> dict[str, str] | None:
    if not REFERENCE_FONTCONFIG_FILE.is_file():
        return None
    environment = dict(os.environ)
    environment["FONTCONFIG_FILE"] = str(REFERENCE_FONTCONFIG_FILE)
    return environment


def _query_font(
    font_match: str,
    pattern: str,
    environment: Mapping[str, str] | None = None,
) -> dict[str, str] | None:
    try:
        result = subprocess.run(
            [
                font_match,
                pattern,
                "--format",
                "%{family}\x1f%{style}\x1f%{fullname}\x1f"
                "%{fontvariations}\x1f%{weight}\x1f%{width}\x1f%{file}",
            ],
            check=True,
            capture_output=True,
            env=environment,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    parts = result.stdout.split("\x1f")
    if len(parts) != 7 or not parts[0].strip() or not parts[6].strip():
        return None
    return {
        "family": parts[0].strip()[:500],
        "style": parts[1].strip()[:500],
        "fullname": parts[2].strip()[:500],
        "fontvariations": parts[3].strip()[:500],
        "weight": parts[4].strip()[:100],
        "width": parts[5].strip()[:100],
        "file": parts[6].strip(),
    }


def _target_pattern(alias: ApprovedFontAlias) -> str:
    pattern = f"{alias.target_family}:style={alias.target_style}"
    if alias.alias_kind == "variable-instance":
        axes = alias.axis_values.model_dump(by_alias=True, mode="json")
        variations = ",".join(
            f"{key}={value}" for key, value in axes.items() if value is not None
        )
        pattern += f":fontvariations={variations}"
    return pattern


def _matches_alias(
    resolution: Mapping[str, str],
    checksum: str | None,
    alias: ApprovedFontAlias,
) -> bool:
    if (
        checksum != alias.source_font_sha256
        or alias.target_family.casefold()
        not in _tokens(str(resolution["family"]))
        or alias.target_style.casefold() not in _tokens(str(resolution["style"]))
    ):
        return False
    if alias.alias_kind != "variable-instance":
        expected_weight = _FONTCONFIG_WEIGHT_BY_WGHT.get(alias.axis_values.wght)
        resolved_weight = _finite_number(str(resolution["weight"]))
        if expected_weight is None or resolved_weight != expected_weight:
            return False
        expected_width = alias.axis_values.wdth
        return expected_width is None or _finite_number(
            str(resolution["width"])
        ) == float(expected_width)
    expected_axes = {
        key: float(value)
        for key, value in alias.axis_values.model_dump(
            by_alias=True,
            mode="json",
        ).items()
        if value is not None
    }
    return _font_variations(str(resolution["fontvariations"])) == expected_axes


def _tokens(value: str) -> set[str]:
    return {token.strip().casefold() for token in value.split(",") if token.strip()}


def _font_variations(value: str) -> dict[str, float]:
    result: dict[str, float] = {}
    for item in value.split(","):
        if not item.strip():
            continue
        key, separator, raw_value = item.partition("=")
        if not separator or key in result:
            return {}
        try:
            parsed = float(raw_value)
        except ValueError:
            return {}
        if not math.isfinite(parsed):
            return {}
        result[key] = parsed
    return result


def _finite_number(value: str) -> float | None:
    try:
        parsed = float(value)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def _file_sha256(value: str) -> str | None:
    try:
        return hashlib.sha256(Path(value).read_bytes()).hexdigest()
    except OSError:
        return None
