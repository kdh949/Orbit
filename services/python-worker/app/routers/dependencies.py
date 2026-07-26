from typing import cast

from fastapi import Request

from app.config import PythonWorkerConfig


def config_from_request(request: Request) -> PythonWorkerConfig:
    return cast(PythonWorkerConfig, request.app.state.config)
