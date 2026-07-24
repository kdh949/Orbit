from __future__ import annotations

from collections.abc import Mapping, Sequence

STRUCTURAL_SLIDE_TYPES = frozenset({"cover", "agenda", "closing"})


def is_structural_slide_type(slide_type: str) -> bool:
    return slide_type in STRUCTURAL_SLIDE_TYPES


def is_body_slide_type(slide_type: str) -> bool:
    return not is_structural_slide_type(slide_type)


def body_slide_orders(
    slide_types: Mapping[int, str] | Sequence[str],
) -> list[int]:
    items = (
        slide_types.items()
        if isinstance(slide_types, Mapping)
        else enumerate(slide_types, start=1)
    )
    return [
        order
        for order, slide_type in items
        if is_body_slide_type(str(slide_type))
    ]


def resolve_constraint_order(
    role: str,
    explicit: int | None,
    slide_types: Mapping[int, str] | Sequence[str],
) -> int:
    ordered_types = (
        dict(slide_types)
        if isinstance(slide_types, Mapping)
        else dict(enumerate(slide_types, start=1))
    )
    if not ordered_types:
        return 1
    if role == "cover":
        return 1

    body_orders = body_slide_orders(ordered_types)
    if not body_orders:
        return 1
    if role == "closing":
        return body_orders[-1]
    if explicit is None:
        return body_orders[0]
    clamped = min(max(1, explicit), max(ordered_types))
    return min(body_orders, key=lambda order: (abs(order - clamped), order))
