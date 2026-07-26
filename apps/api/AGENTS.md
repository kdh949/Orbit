# Orbit API Rules

These rules apply to `apps/api`.

## Boundaries

- Keep HTTP parsing, status mapping, and authentication in controllers or
  guards. Business workflows belong in services or application use cases.
- Use Zod contracts from `@orbit/shared` for external request, response, Job,
  and WebSocket payloads. Do not redefine a shared DTO locally.
- Access storage, queues, AI, STT, and OCR through the existing ports and
  providers. Do not instantiate infrastructure adapters inside feature
  services.
- Preserve project and workspace ownership checks on every resource lookup.

## Persistence

- Manage schema changes with TypeORM migrations. Do not rely on
  `synchronize: true`.
- Keep transaction boundaries around the complete state change. Enqueue work
  only in the ordering required by the existing outbox or recovery contract.
- Put reusable persistence queries in repositories or query modules instead of
  controllers.
- Return stable not-found and authorization behavior; do not leak whether a
  resource exists outside the caller's project boundary.

## Contracts and privacy

- Keep File results in the `fileId`, `projectId`, `purpose`, `url`,
  `createdAt` shape.
- Keep Job states as `queued`, `running`, `succeeded`, and `failed`.
- Do not expose presenter script, raw audio, private transcript content, or
  internal provider payloads through audience endpoints.
- Business logs for enqueue, external provider calls, and user data state
  changes must not include secrets or raw private content.

## Testing

- Add or update a focused `*.spec.ts` when changing service, controller,
  repository, or authorization behavior.
- Prefer the narrowest test file first:

```bash
pnpm --filter @orbit/api test -- src/<feature>/<file>.spec.ts
pnpm turbo run typecheck --filter=@orbit/api
```

- Run the API build when changing Nest module wiring, decorators, generated
  metadata, or package resolution.
- For migrations, run both migration apply and revert against local Postgres
  and record the result.
