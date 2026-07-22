from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from pydantic import Field

from app.ai.ooxml_reference_templates.models import (
    MutationPolicy,
    OoxmlReferenceTemplateManifest,
    StrictModel,
)
from app.ai.ooxml_reference_templates.registry import (
    ObjectStorage,
    RegistryError,
    load_active_reference_template,
)


EditableContentType = Literal["text", "image", "table", "chart"]


@dataclass(frozen=True)
class OoxmlReferenceTemplateAllowlist:
    templates: frozenset[tuple[str, int]]

    def permits(self, template_id: str, version: int) -> bool:
        return (template_id, version) in self.templates


class OoxmlReferenceTemplateOptionPreview(StrictModel):
    cover_asset_id: str = Field(min_length=1, max_length=128)
    body_asset_id: str = Field(min_length=1, max_length=128)


class OoxmlReferenceTemplateEditableRange(StrictModel):
    content_type: EditableContentType
    mutation_policy: MutationPolicy
    slot_count: int = Field(gt=0, le=500)


class OoxmlReferenceTemplateOption(StrictModel):
    template_id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    version: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=500)
    preview: OoxmlReferenceTemplateOptionPreview
    editable_ranges: list[OoxmlReferenceTemplateEditableRange] = Field(
        min_length=1,
        max_length=4,
    )


class OoxmlReferenceTemplateOptionsResponse(StrictModel):
    options: list[OoxmlReferenceTemplateOption] = Field(max_length=100)


def build_ooxml_reference_template_options(
    storage: ObjectStorage,
    manifests: Iterable[OoxmlReferenceTemplateManifest],
    allowlist: OoxmlReferenceTemplateAllowlist,
) -> OoxmlReferenceTemplateOptionsResponse:
    options: list[OoxmlReferenceTemplateOption] = []
    seen: set[tuple[str, int]] = set()
    candidates = sorted(
        manifests,
        key=lambda manifest: (manifest.template_id, manifest.version),
    )
    for manifest in candidates:
        identity = (manifest.template_id, manifest.version)
        if identity in seen or not allowlist.permits(*identity):
            continue
        seen.add(identity)
        try:
            verified = load_active_reference_template(storage, manifest)
        except (KeyError, OSError, RegistryError):
            continue
        options.append(_project_verified_template(verified))
    return OoxmlReferenceTemplateOptionsResponse(options=options)


def _project_verified_template(
    manifest: OoxmlReferenceTemplateManifest,
) -> OoxmlReferenceTemplateOption:
    editable_counts = Counter(
        (slot.content_type, slot.mutation_policy[0])
        for slide in manifest.source_slides
        for slot in slide.slots
    )
    editable_ranges = [
        OoxmlReferenceTemplateEditableRange(
            content_type=content_type,
            mutation_policy=mutation_policy,
            slot_count=slot_count,
        )
        for (content_type, mutation_policy), slot_count in sorted(
            editable_counts.items()
        )
    ]
    return OoxmlReferenceTemplateOption(
        template_id=manifest.template_id,
        version=manifest.version,
        name=manifest.name,
        description=manifest.description,
        preview=OoxmlReferenceTemplateOptionPreview(
            cover_asset_id=manifest.preview.cover_preview_id,
            body_asset_id=manifest.preview.body_preview_id,
        ),
        editable_ranges=editable_ranges,
    )
