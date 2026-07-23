from __future__ import annotations

import json
from pathlib import Path

from app.ai.ooxml_reference_templates.registry import (
    LocalDirectoryObjectStorage,
    canonical_manifest_bytes,
)
from scripts import ingest_ooxml_reference_templates as cli
from test_ooxml_reference_registry import (
    _manifest,
    _preview_png,
    _source_pptx,
)


def test_apply_uploads_four_verified_objects_and_is_idempotent(
    tmp_path: Path,
    monkeypatch: object,
    capsys: object,
) -> None:
    source = _source_pptx(tmp_path / "inputs")
    cover = _preview_png(tmp_path / "inputs", "cover.png", (255, 0, 0))
    body = _preview_png(tmp_path / "inputs", "body.png", (0, 0, 255))
    manifest = _manifest(source, cover, body)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_bytes(canonical_manifest_bytes(manifest))
    catalog_path = _repository_catalog(tmp_path, source, manifest)
    storage = LocalDirectoryObjectStorage(tmp_path / "private-storage")
    monkeypatch.setattr(  # type: ignore[attr-defined]
        cli,
        "build_s3_immutable_catalog_writer",
        lambda: storage,
    )
    argv = _apply_args(catalog_path, source, manifest_path, cover, body)

    assert cli.main(argv) == 0
    first = json.loads(capsys.readouterr().out)  # type: ignore[attr-defined]
    assert first["dryRun"] is False
    assert first["createdObjectCount"] == 4
    assert first["templates"] == [
        {
            "templateId": "operating-review",
            "version": 1,
            "manifestSha256": manifest_path_sha256(manifest_path),
            "createdObjectCount": 4,
        }
    ]
    assert str(tmp_path) not in json.dumps(first)
    assert "system/ooxml-reference-templates" not in json.dumps(first)

    assert cli.main(argv) == 0
    second = json.loads(capsys.readouterr().out)  # type: ignore[attr-defined]
    assert second["createdObjectCount"] == 0
    assert second["templates"][0]["createdObjectCount"] == 0


def test_apply_validates_every_input_before_writing_remote_objects(
    tmp_path: Path,
    monkeypatch: object,
    capsys: object,
) -> None:
    source = _source_pptx(tmp_path / "inputs")
    cover = _preview_png(tmp_path / "inputs", "cover.png", (255, 0, 0))
    body = _preview_png(tmp_path / "inputs", "body.png", (0, 0, 255))
    manifest = _manifest(source, cover, body)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_bytes(canonical_manifest_bytes(manifest))
    body.write_bytes(b"\x89PNG\r\n\x1a\nchecksum-drift")
    catalog_path = _repository_catalog(tmp_path, source, manifest)
    storage_root = tmp_path / "private-storage"
    monkeypatch.setattr(  # type: ignore[attr-defined]
        cli,
        "build_s3_immutable_catalog_writer",
        lambda: LocalDirectoryObjectStorage(storage_root),
    )

    assert cli.main(
        _apply_args(catalog_path, source, manifest_path, cover, body)
    ) == 1
    captured = capsys.readouterr()  # type: ignore[attr-defined]
    assert "PREVIEW_CHECKSUM_MISMATCH" in captured.err
    assert not storage_root.exists()
    assert str(tmp_path) not in captured.err


def test_apply_rejects_existing_different_bytes_without_exposing_storage_key(
    tmp_path: Path,
    monkeypatch: object,
    capsys: object,
) -> None:
    source = _source_pptx(tmp_path / "inputs")
    cover = _preview_png(tmp_path / "inputs", "cover.png", (255, 0, 0))
    body = _preview_png(tmp_path / "inputs", "body.png", (0, 0, 255))
    manifest = _manifest(source, cover, body)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_bytes(canonical_manifest_bytes(manifest))
    catalog_path = _repository_catalog(tmp_path, source, manifest)
    storage = LocalDirectoryObjectStorage(tmp_path / "private-storage")
    monkeypatch.setattr(  # type: ignore[attr-defined]
        cli,
        "build_s3_immutable_catalog_writer",
        lambda: storage,
    )
    argv = _apply_args(catalog_path, source, manifest_path, cover, body)
    assert cli.main(argv) == 0
    capsys.readouterr()  # type: ignore[attr-defined]
    source_object = (
        tmp_path
        / "private-storage/system/ooxml-reference-templates/operating-review/v1/source.pptx"
    )
    source_object.write_bytes(b"different-existing-object")

    assert cli.main(argv) == 1
    captured = capsys.readouterr()  # type: ignore[attr-defined]
    assert "IMMUTABLE_OBJECT_CONFLICT" in captured.err
    assert "system/ooxml-reference-templates" not in captured.err
    assert str(tmp_path) not in captured.err


def _apply_args(
    catalog: Path,
    source: Path,
    manifest: Path,
    cover: Path,
    body: Path,
) -> list[str]:
    identity = "operating-review"
    return [
        "--catalog",
        str(catalog),
        "--source",
        f"{identity}={source}",
        "--manifest",
        f"{identity}={manifest}",
        "--cover-preview",
        f"{identity}={cover}",
        "--body-preview",
        f"{identity}={body}",
        "--apply",
    ]


def _repository_catalog(tmp_path: Path, source: Path, manifest: object) -> Path:
    manifest_value = manifest.model_dump(by_alias=True, mode="json")  # type: ignore[attr-defined]
    catalog = {
        "schemaVersion": 2,
        "templates": [
            {
                "templateId": "operating-review",
                "version": 1,
                "status": "disabled",
                "sourceFormat": "pptx",
                "sourceSha256": manifest_value["sourceSha256"],
                "slideCount": 2,
                "name": "Operating Review",
                "description": "운영 리뷰",
                "preview": {
                    "coverPreviewId": "cover",
                    "coverPreviewSha256": manifest_value["preview"][
                        "coverPreviewSha256"
                    ],
                    "bodyPreviewId": "body",
                    "bodyPreviewSha256": manifest_value["preview"][
                        "bodyPreviewSha256"
                    ],
                },
                "provenance": {
                    "authorizationStatus": "approved",
                    "inventoryVersion": 1,
                },
                "annotationReview": {
                    "status": "approved",
                    "reviewedOn": "2026-07-23",
                    "reviewedManifestSha256": "a" * 64,
                    "slideCount": 2,
                    "slotCount": 1,
                    "contentTypes": ["text"],
                },
                "activationBlockers": [
                    "PRIVATE_MANAGED_STORAGE_ADAPTER_UNCONFIGURED",
                    "FONT_AVAILABILITY_VALIDATION_PENDING",
                ],
            }
        ],
    }
    del source
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(catalog), encoding="utf-8")
    return path


def manifest_path_sha256(path: Path) -> str:
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()
