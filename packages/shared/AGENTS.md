# Orbit Shared Contract Rules

These rules apply to `packages/shared`.

## Contract ownership

- Zod schemas in this package are the runtime source of truth for Deck, File,
  Job, Rehearsal, Presentation, and WebSocket contracts.
- Export TypeScript types from schema inference where possible; do not maintain
  a second handwritten shape for the same payload.
- Keep enum values, defaults, optionality, and unknown-key behavior compatible
  unless the task explicitly authorizes a contract change.
- Contract changes must update the relevant schema tests and
  `docs/contracts.md`.

## Compatibility

- Add a compatibility path before migrating consumers. Remove a root export or
  legacy field only after repository-wide usage reaches zero.
- Prefer domain subpath exports over adding more unrelated symbols to the root
  barrel.
- Keep fixtures deterministic and free of secrets, personal data, raw audio,
  transcript text, and presenter script.
- This package must not import from `apps`, Web browser modules, NestJS, or
  infrastructure adapters.

## Testing

- Add positive, negative, defaulting, and backward-compatibility cases for
  changed schemas.
- Run the domain test before package-wide verification:

```bash
pnpm --filter @orbit/shared test -- src/<domain>/<schema>.test.ts
pnpm turbo run typecheck --filter=@orbit/shared
pnpm turbo run build --filter=@orbit/shared
```

- A shared contract change triggers verification of every affected consumer,
  not only this package.
