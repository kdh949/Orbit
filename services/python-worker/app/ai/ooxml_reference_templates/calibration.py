from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from typing import Annotated, Any, Literal, Protocol, Self, cast

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.ai.ooxml_reference_templates.fidelity import EXPECTED_TEMPLATE_IDS


CALIBRATION_OBJECT_KEY = (
    "system/ooxml-reference-templates/fidelity-calibrations/v1/calibration.json"
)
CALIBRATION_CONTENT_TYPE = "application/json"
MAX_CALIBRATION_BYTES = 262_144
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
Sha256 = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class CalibrationObjectClient(Protocol):
    def head_object(self, **kwargs: object) -> dict[str, object]: ...

    def get_object(self, **kwargs: object) -> dict[str, object]: ...


class PrivateFidelityCalibrationError(RuntimeError):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__("OOXML reference fidelity calibration unavailable.")


class _StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        alias_generator=lambda value: "".join(
            [
                value.split("_")[0],
                *[part[:1].upper() + part[1:] for part in value.split("_")[1:]],
            ]
        ),
    )


class IdentityBaseline(_StrictModel):
    template_id: Annotated[
        str,
        Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100),
    ]
    version: Literal[1]
    renderer: Annotated[str, Field(min_length=1, max_length=100)]
    renderer_version: Annotated[str, Field(min_length=1, max_length=100)]
    report_sha256: Sha256


class PrivateFidelityCalibration(_StrictModel):
    schema_version: Literal[1]
    status: Literal["calibrated"]
    locked_region_ssim_threshold: float = Field(gt=0, le=1)
    geometry_edge_tolerance_px: Literal[0]
    rationale: Annotated[str, Field(min_length=1, max_length=500)]
    identity_baselines: list[IdentityBaseline] = Field(min_length=7, max_length=7)

    @model_validator(mode="after")
    def validate_complete_renderer_baselines(self) -> Self:
        template_ids = [baseline.template_id for baseline in self.identity_baselines]
        if len(template_ids) != len(set(template_ids)):
            raise ValueError("identity baseline template IDs must be unique")
        if set(template_ids) != EXPECTED_TEMPLATE_IDS:
            raise ValueError("identity baselines must contain every approved template")
        renderer_identities = {
            (baseline.renderer, baseline.renderer_version)
            for baseline in self.identity_baselines
        }
        if len(renderer_identities) != 1:
            raise ValueError("identity baselines must use one exact renderer version")
        return self


def load_private_fidelity_calibration(
    client: CalibrationObjectClient,
    bucket: str,
) -> dict[str, Any]:
    if not bucket.strip():
        raise PrivateFidelityCalibrationError(
            "OOXML_REFERENCE_FIDELITY_CALIBRATION_UNCONFIGURED"
        )
    metadata = _head_calibration(client, bucket)
    try:
        size = int(cast(Any, metadata["ContentLength"]))
        content_type = str(metadata["ContentType"])
        object_metadata = cast(Mapping[str, object], metadata["Metadata"])
        declared_sha256 = str(object_metadata["sha256"])
    except (KeyError, TypeError, ValueError) as error:
        raise PrivateFidelityCalibrationError(
            "OOXML_REFERENCE_FIDELITY_CALIBRATION_METADATA_INVALID"
        ) from error
    if (
        not 0 < size <= MAX_CALIBRATION_BYTES
        or content_type != CALIBRATION_CONTENT_TYPE
        or SHA256_PATTERN.fullmatch(declared_sha256) is None
    ):
        raise PrivateFidelityCalibrationError(
            "OOXML_REFERENCE_FIDELITY_CALIBRATION_METADATA_INVALID"
        )

    content = _read_calibration(client, bucket, size)
    if hashlib.sha256(content).hexdigest() != declared_sha256:
        raise PrivateFidelityCalibrationError(
            "OOXML_REFERENCE_FIDELITY_CALIBRATION_CHECKSUM_MISMATCH"
        )
    try:
        value = json.loads(content)
        calibration = PrivateFidelityCalibration.model_validate(value)
    except (json.JSONDecodeError, UnicodeDecodeError, ValidationError) as error:
        raise PrivateFidelityCalibrationError(
            "OOXML_REFERENCE_FIDELITY_CALIBRATION_INVALID"
        ) from error
    return calibration.model_dump(by_alias=True, mode="json")


def _head_calibration(
    client: CalibrationObjectClient,
    bucket: str,
) -> dict[str, object]:
    try:
        return client.head_object(Bucket=bucket, Key=CALIBRATION_OBJECT_KEY)
    except Exception as error:
        raise PrivateFidelityCalibrationError(
            "OOXML_REFERENCE_FIDELITY_CALIBRATION_UNAVAILABLE"
        ) from error


def _read_calibration(
    client: CalibrationObjectClient,
    bucket: str,
    expected_size: int,
) -> bytes:
    try:
        response = client.get_object(Bucket=bucket, Key=CALIBRATION_OBJECT_KEY)
        body = response["Body"]
        read = getattr(body, "read")
        content = read(expected_size + 1)
        close = getattr(body, "close", None)
        if callable(close):
            close()
    except Exception as error:
        raise PrivateFidelityCalibrationError(
            "OOXML_REFERENCE_FIDELITY_CALIBRATION_UNAVAILABLE"
        ) from error
    if not isinstance(content, bytes) or len(content) != expected_size:
        raise PrivateFidelityCalibrationError(
            "OOXML_REFERENCE_FIDELITY_CALIBRATION_CHECKSUM_MISMATCH"
        )
    return content
