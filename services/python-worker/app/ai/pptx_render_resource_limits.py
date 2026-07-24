from __future__ import annotations

import signal
import threading
import time
from collections.abc import Callable
from typing import TypeVar


T = TypeVar("T")


class PptxRenderResourceLimitError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def run_bitmap_decode_with_timeout(
    operation: Callable[[], T],
    *,
    timeout_seconds: float,
    timeout_code: str,
) -> T:
    if timeout_seconds <= 0:
        raise PptxRenderResourceLimitError(timeout_code)

    started_at = time.monotonic()
    sigalrm = getattr(signal, "SIGALRM", None)
    itimer_real = getattr(signal, "ITIMER_REAL", None)
    getitimer = getattr(signal, "getitimer", None)
    setitimer = getattr(signal, "setitimer", None)
    if (
        threading.current_thread() is not threading.main_thread()
        or sigalrm is None
        or itimer_real is None
        or not callable(getitimer)
        or not callable(setitimer)
        or getitimer(itimer_real)[0] != 0
    ):
        result = operation()
        if time.monotonic() - started_at > timeout_seconds:
            raise PptxRenderResourceLimitError(timeout_code)
        return result

    previous_handler = signal.getsignal(sigalrm)

    def deadline_reached(_signum: int, _frame: object) -> None:
        raise PptxRenderResourceLimitError(timeout_code)

    signal.signal(sigalrm, deadline_reached)
    setitimer(itimer_real, timeout_seconds)
    try:
        return operation()
    finally:
        setitimer(itimer_real, 0)
        signal.signal(sigalrm, previous_handler)


def validate_rendered_bitmap(
    content: bytes,
    *,
    width: int,
    height: int,
    max_dimension: int,
    max_bytes: int,
    dimension_code: str,
    byte_code: str,
) -> None:
    if (
        width <= 0
        or height <= 0
        or width > max_dimension
        or height > max_dimension
    ):
        raise PptxRenderResourceLimitError(dimension_code)
    if not content or len(content) > max_bytes:
        raise PptxRenderResourceLimitError(byte_code)
