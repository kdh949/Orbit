# Orbit Editor Core Rules

These rules apply to `packages/editor-core`.

## Domain boundary

- Keep editor operations deterministic and independent of React, DOM, browser
  globals, network calls, database access, storage, and queue adapters.
- Use Deck and Patch contracts from `@orbit/shared`; do not introduce a second
  editor-only Deck shape.
- Patch helpers must preserve immutable input, stable IDs, ordering, group
  geometry, animation references, keyword references, and activity references.
- Keep repair and legacy migration behavior explicit and covered by fixtures.

## Public API

- Put implementation in domain modules and expose it through deliberate public
  exports. Do not add new application imports that reach into package `src`
  paths.
- Keep `createDemoDeck` and other sample data in fixture-oriented modules.
- Maintain root export compatibility while consumers migrate to domain
  subpaths.
- Avoid importing package root barrels from another implementation file in the
  same package.

## Testing

- Every patch, geometry, animation, table, text, or repair change requires a
  focused unit test that asserts both result and unchanged input.
- Run the narrowest test first:

```bash
pnpm --filter @orbit/editor-core test -- src/<domain>/<file>.test.ts
pnpm turbo run typecheck --filter=@orbit/editor-core
pnpm turbo run build --filter=@orbit/editor-core
```

- Changes that alter emitted Deck or Patch data also require the relevant
  `@orbit/shared` schema test.
