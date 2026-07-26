# Shared subpath migration

`@orbit/shared`의 root export는 기존 consumer 호환성을 위해 유지한다. 신규 production
코드는 domain subpath를 사용한다.

```ts
import type { Deck } from "@orbit/shared/deck";
import type { Job } from "@orbit/shared/jobs";
```

## Codemod

dry-run은 `packages/shared/package.json`의 export entry와 각 barrel의 AST를 읽어
symbol별 canonical subpath를 계산한다. 하나의 symbol이 여러 subpath에 있거나
매핑되지 않으면 파일을 추측해서 바꾸지 않고 `conflicts`에 보고한다.

```bash
pnpm shared:subpaths -- --dry-run
pnpm shared:subpaths -- --write
```

2026-07-26 migration에서는 618개 파일의 2,358개 symbol을 옮겼고 conflict는
0건이었다. production root importer는 453개에서 0개가 되었다. 테스트 파일은 root
compatibility를 검증할 수 있지만, `verify:guard`는 apps와 packages의 신규 production
root import를 거부한다.
