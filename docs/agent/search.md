# Agent search

`agent:search`는 Agent가 현재 운영 코드와 계약을 우선 탐색하도록 검색 범위를
제한한다. 기본 범위는 `apps`, `packages`, `services`, `tools`, `infra`, 현재
계약, 그리고 `docs/agent/repository-truth.json`의 `activeDocs`다.

```bash
pnpm agent:search "TemplateBlueprint"
pnpm agent:search "Template(Blueprint)?" --regex
pnpm agent:search "TemplateBlueprint" --historical
```

`--historical`을 지정한 경우에만 `docs/plans`, `docs/ideas`, `docs/qa`,
`docs/yb`, `tasks`를 검색한다. 완료된 계획에서 과거 경로를 찾아야 하는 경우를
제외하면 기본 검색을 사용한다.
