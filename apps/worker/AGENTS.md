# Orbit Worker Rules

These rules apply to `apps/worker`.

## Queue and processor boundaries

- Treat queue names, Job names, payloads, and Job state as shared contracts.
  Update `packages/shared`, `packages/job-queue`, and contract documentation
  together when a payload changes.
- Keep processors idempotent across retry, stall recovery, duplicate delivery,
  and acknowledgement loss.
- Preserve existing concurrency, retry, retention, and terminal recovery
  behavior unless the task explicitly changes that policy.
- A processor should validate input, load context, call a domain pipeline,
  persist the outcome, and emit the business event. Keep transport recovery
  separate from domain calculation where an existing boundary is available.

## State and external services

- Use `JobQueuePort`, `StoragePort`, and provider interfaces instead of
  constructing adapters in processors.
- Validate Python and external provider results with shared schemas before
  persisting them.
- Complete the durable DB state transition before removing queue recovery
  evidence or acknowledging cleanup that cannot be reconstructed.
- Do not log API keys, tokens, cookies, raw audio, transcript text, presenter
  script, provider prompts, or file base64.

## Testing

- Every retry, recovery, idempotency, or terminal-state change requires a
  regression test for duplicate execution and partial failure.
- Run the narrowest processor test first:

```bash
pnpm turbo run test --filter=@orbit/worker -- src/<processor>.spec.ts
pnpm turbo run typecheck --filter=@orbit/worker
```

- Run the Worker build when changing Nest module wiring, queue registration,
  runtime imports, or generated metadata.
- Use integration tests only when Redis, PostgreSQL, or cross-process behavior
  is part of the contract; state the required services in the result.
