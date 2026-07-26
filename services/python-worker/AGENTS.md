# Orbit Python Worker Rules

These rules apply to `services/python-worker`.

## Application boundaries

- Keep FastAPI routes responsible for transport parsing, Pydantic validation,
  status mapping, and delegation. Put reusable execution logic in domain
  modules or services.
- Preserve endpoint paths, status codes, response models, and exception
  mapping during structural extraction.
- Validate external and cross-language input with Pydantic models before
  executing domain logic.
- Keep blocking or CPU-heavy work behind the existing execution boundary; do
  not move it onto the async event loop without measuring the effect.

## Data and privacy

- Do not log API keys, tokens, cookies, raw audio, transcript text, presenter
  script, full prompts, document content, or file base64.
- Keep temporary file cleanup in `finally` or an equivalent lifecycle
  boundary.
- Preserve file-size, package-security, resource-limit, and archive traversal
  checks in PPTX and document processing.
- Return schema-compatible failure details without exposing internal paths or
  credentials.

## Dependencies and style

- Manage dependencies only through `pyproject.toml` and `uv.lock`; do not add
  `requirements.txt`.
- Keep Python 3.12, Ruff, and strict mypy compatibility.
- Prefer explicit Pydantic and typed domain models over untyped dictionaries at
  transport boundaries.

## Testing

- Add or update the narrowest pytest module for each behavior change.
- Run focused checks first:

```bash
cd services/python-worker
uv run ruff check <changed paths>
uv run mypy app
uv run pytest tests/<target_test.py>
```

- Run the full Python suite for shared model, app factory, broad router,
  dependency, or PPTX facade changes.
