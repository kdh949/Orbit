# Rehearsal Report Policy

## 화면 구성

리허설 리포트는 발표자가 첫 화면에서 이번 리허설의 상태를 바로 파악하도록 다음 순서로 구성한다.

1. 상단 Hero
2. AI 총평 카드
3. 발표 상태 요약 카드
4. 장표별 분석
5. 반복 문제 장표
6. 말버릇 / 멈춤
7. 발표 전사본

## 상단 Hero

- 제목은 `N회차 리허설 리포트` 형식으로 표시한다.
- 날짜는 `rehearsal_runs.created_at` 값을 기준으로 표시한다.
- `바로 다시 리허설` 버튼은 Hero 우측 CTA로 제공한다.
- 상단 앱바와 Hero에 동일한 재리허설 CTA를 중복 배치하지 않는다.

## AI 총평

리포트 첫 화면의 총평은 `report.aiSummary`에 한 줄 제목과 설명 문단으로 저장한다. 기존 `report.coaching.summary`는 한 문장 요약에 사용한다.

```ts
aiSummary: {
  headline: string;
  paragraphs: string[];
}
```

- `headline`은 한 줄 요약이다.
- `paragraphs`는 2~3문장 총평이다.
- 총평은 `transcript`, `metrics`, `slideTimings`, `missedKeywords`, `fillerWordDetails`를 근거로 생성한다.
- 현재 worker 요청에는 이전 회차 데이터가 포함되지 않으므로, 이전 회차 기반 AI 총평은 별도 계약 확장 후 처리한다.
- 과거 리포트처럼 `aiSummary`가 없는 경우 화면은 `coaching.summary`, `coaching.improvements`, `coaching.nextPracticeFocus`로 fallback한다.

## 발표 상태 요약 카드

발표 상태 요약 카드는 전체 발표 시간, 슬라이드별 소요 시간, 말버릇과 긴 멈춤 횟수를 보여준다. 이전 리허설과의 시간 변화도 함께 표시한다.

- 전체 발표 시간은 `report.metrics.durationSeconds`를 사용한다.
- 직전 리허설 대비 시간 변화는 이전 리포트의 `metrics.durationSeconds`와 비교한다.
- 슬라이드별 소요 시간은 `report.slideTimings`를 사용한다.
- 슬라이드 미리보기는 `deck.slides[].thumbnailUrl`을 사용한다.
- 시간 그래프는 최근 이전 리허설과 이번 리허설의 전체 시간을 비교한다.
- 말버릇 총 횟수는 `report.metrics.fillerWordCount`를 사용한다.
- 긴 멈춤 횟수는 `report.metrics.pauseCount`를 사용한다.

## 장표별 분석

장표별 분석은 각 장표의 반복 개선 지점을 찾는 용도다.

- 각 슬라이드 미리보기, 이번 소요 시간, 이전 평균 대비 변화량을 표시한다.
- 누락 키워드는 저장된 deck keyword 기준으로만 표시한다.
- AI가 임의로 키워드를 추론해서 누락으로 표시하지 않는다.
- 기준 키워드가 없는 장표에서는 누락 키워드를 평가할 근거가 없다.
- 장표별 AI 개선 포인트는 추후 `slideFeedback` 같은 별도 계약으로 확장한다.

## 반복 문제 장표

반복 문제 장표에서는 리허설이 2회 이상일 때 같은 장표의 변화와 반복 문제를 비교한다.

- 같은 장표에서 시간이 반복적으로 초과되는지 확인한다.
- 같은 장표에서 키워드 누락이 반복되는지 확인한다.
- 이번 회차가 이전보다 좋아졌는지 나빠졌는지 비교한다.
- 단일 리허설의 평가보다 여러 리허설의 누적 경향을 우선한다.

## 말버릇 / 멈춤

- 말버릇 총 횟수는 `report.metrics.fillerWordCount`를 사용한다.
- 상위 반복 표현은 `report.fillerWordDetails`를 count 내림차순으로 표시한다.
- 긴 멈춤 횟수는 `report.metrics.pauseCount`를 사용한다.
- 멈춤 상세 구간은 `report.pauseDetails`에 저장되지만, 장표별 연결은 추후 확장한다.

## 전사본 정책

- 전사본 원문은 DB에 기본 저장하지 않는다.
- 발표 직후 30분 동안만 Redis TTL 캐시로 제공한다.
- 화면은 `transcriptRetained=true`이고 `transcript`가 있으며 TTL이 살아 있는 경우에만 전사본 섹션을 표시한다.
- 30분이 지나면 전사본 섹션 자체를 숨긴다.
- 전사본은 펼치기/접기로 화면에서 확인할 수 있다.
- 다운로드는 Word에서 열 수 있는 문서 파일로 제공한다.
- 발표자 script와 raw transcript 원문은 청중 API로 노출하지 않는다.

## 후속 확장

- 이전 회차 데이터를 Python worker의 AI 입력에 포함해 `aiSummary`가 변화 추세까지 설명하도록 확장한다.
- 장표별 AI 개선 포인트를 `slideFeedback` 계약으로 분리한다.
- 전사본 다운로드는 클라이언트에서 최소 OOXML `.docx` 파일을 생성해 제공한다.
