from __future__ import annotations


class SlotCapacityError(ValueError):
    def __init__(
        self,
        code: str,
        detail: str,
        *,
        package_bytes: bytes | None = None,
    ) -> None:
        self.code = code
        self.retryable = False
        self.authored_fallback_created = False
        self.package_bytes = package_bytes
        super().__init__(f"{code}: {detail}")
