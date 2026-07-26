# Editor Core public API

`@orbit/editor-core`는 React나 browser runtime에 의존하지 않는 순수 Deck
편집 연산을 제공한다. 새 consumer는 필요한 기능만 노출하는 subpath를
사용하고, root export는 기존 consumer migration 동안만 호환 경로로
유지한다.

| import                                   | 역할                                |
| ---------------------------------------- | ----------------------------------- |
| `@orbit/editor-core/activities`          | Activity slide와 design preset 연산 |
| `@orbit/editor-core/community-templates` | Community template 정규화와 적용    |
| `@orbit/editor-core/fixtures`            | 결정적인 sample Deck fixture        |
| `@orbit/editor-core/keywords`            | Keyword occurrence 계산과 진단      |
| `@orbit/editor-core/patches`             | Deck patch 생성, 적용, repair       |
| `@orbit/editor-core/playback`            | Animation timeline과 slide playback |
| `@orbit/editor-core/table`               | Table 편집 연산                     |
| `@orbit/editor-core/text`                | Rich text 편집 연산                 |
