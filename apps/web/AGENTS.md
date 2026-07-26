# Orbit Web UI Rules

These rules govern the integrated **Redesign System** described in
`apps/web/DESIGN.md`. The legacy design-system implementation has been
replaced; product UI must use the canonical tokens and primitives listed below
instead of introducing a parallel token or component system.

## UI architecture

- `apps/web/src/components/ui` is the shared primitive folder for the Redesign System.
- Keep each primitive in its own component and style files, and expose its public API through `apps/web/src/components/ui/index.ts`.
- Product-level reusable patterns belong in `apps/web/src/components/patterns`.
- Feature-specific components belong in their own `apps/web/src/features/<feature-name>` folder (e.g. `features/rehearsal`, `features/editor`), matching the existing feature layout.
- `components/ui` must never import from `features`.

## Styling

- Use CSS variables from `apps/web/src/styles/tokens.css`.
- Treat `apps/web/src/styles/tokens.css` as the single source of truth for
  color, typography, spacing, component size, shape, elevation, layering,
  motion, and responsive reference values.
- Do not add literal hex colors outside `tokens.css`.
- Do not add arbitrary spacing values when an existing spacing token fits.
- Do not add inline styles except for dynamically calculated coordinates.
- New reusable components must support `className`.

## TypeScript

- Do not add `any` or `as unknown as` to new production code.
- Existing violations are outside the scope of unrelated changes; do not expand
  them and do not refactor them unless the task explicitly targets typing debt.
- Prefer explicit props over complex generics.
- Extend native element props with `ComponentPropsWithoutRef`.
- Keep API and domain types inside their feature.

## Refactoring

- UI refactoring must not change API calls, Zustand state, routing, or report schema.
- Do not mix visual redesign and business-logic changes in the same task.
- Keep each change buildable.
- Run targeted tests through Turbo so workspace dependencies are built first:
  `pnpm turbo run test --filter=@orbit/web -- <test-path>`.
- Run `pnpm turbo run typecheck --filter=@orbit/web`.
- Run the Web build when changing routes, Vite configuration, assets, workers,
  or package/public import resolution.

## Accessibility

- Interactive elements must be buttons or links.
- Preserve keyboard focus styles.
- Icon-only buttons require `aria-label`.
- Do not communicate status using color alone.
