export function PresentationAnimationTriggerDebug(props: {
  data: {
    confidence: number | null;
    confirmedOccurrenceIds: string[];
    currentCharOffset: number;
    previousCharOffset: number;
    currentStepAnimationIds: string[];
    currentStepIndex: number;
    latestTranscript: string;
    matches: Array<{ occurrenceId: string }>;
    occurrenceActions: Array<{ animationId: string; occurrenceId: string }>;
    playedAnimationIds: string[];
    speechStatus: string;
    targetOccurrenceIds: string[];
    transcript: string;
  };
}) {
  const { data } = props;
  const blocker = getAnimationTriggerBlocker(data);

  return (
    <aside
      aria-label="애니메이션 트리거 디버그"
      className="presentation-animation-trigger-debug"
    >
      <header>
        <strong>애니메이션 트리거 디버그</strong>
        <span>
          URL의 <code>animationDebug=1</code>에서만 표시
        </span>
      </header>
      <dl>
        <div>
          <dt>STT 상태</dt>
          <dd>{data.speechStatus}</dd>
        </div>
        <div>
          <dt>최근 인식</dt>
          <dd>{data.latestTranscript || "-"}</dd>
        </div>
        <div>
          <dt>confidence</dt>
          <dd>{data.confidence?.toFixed(2) ?? "브라우저 미제공"}</dd>
        </div>
        <div>
          <dt>대본 위치</dt>
          <dd>
            {data.previousCharOffset} → {data.currentCharOffset}
          </dd>
        </div>
        <div>
          <dt>매칭 occurrence</dt>
          <dd>
            {formatDebugValues(data.matches.map((match) => match.occurrenceId))}
          </dd>
        </div>
        <div>
          <dt>소비된 occurrence</dt>
          <dd>{formatDebugValues(data.confirmedOccurrenceIds)}</dd>
        </div>
        <div>
          <dt>실행된 animation</dt>
          <dd>{formatDebugValues(data.playedAnimationIds)}</dd>
        </div>
        <div>
          <dt>현재 step</dt>
          <dd>
            {data.currentStepIndex} ·{" "}
            {formatDebugValues(data.currentStepAnimationIds)}
          </dd>
        </div>
      </dl>
      <p className="presentation-animation-trigger-debug-blocker">
        판정: {blocker}
      </p>
      <details>
        <summary>연결 데이터 보기</summary>
        <p>트리거 occurrence: {formatDebugValues(data.targetOccurrenceIds)}</p>
        <p>
          action 연결:{" "}
          {formatDebugValues(
            data.occurrenceActions.map(
              (action) => `${action.occurrenceId} → ${action.animationId}`,
            ),
          )}
        </p>
        <p>위치 계산 대본: {data.transcript || "-"}</p>
      </details>
    </aside>
  );
}

function getAnimationTriggerBlocker(data: {
  confidence: number | null;
  confirmedOccurrenceIds: string[];
  latestTranscript: string;
  matches: Array<{ occurrenceId: string }>;
  occurrenceActions: Array<{ animationId: string; occurrenceId: string }>;
  speechStatus: string;
  targetOccurrenceIds: string[];
}) {
  if (data.speechStatus !== "listening") {
    return "음성 인식이 listening 상태가 아닙니다.";
  }
  if (!data.latestTranscript.trim()) {
    return "아직 STT 결과가 없습니다.";
  }
  if (data.confidence !== null && data.confidence < 0.7) {
    return "confidence가 0.70 미만이라 자동 실행을 막았습니다.";
  }
  if (data.targetOccurrenceIds.length === 0) {
    return "현재 슬라이드에 keyword-occurrence action이 없습니다.";
  }
  if (data.occurrenceActions.length === 0) {
    return "occurrence action 연결을 찾지 못했습니다.";
  }
  if (
    data.targetOccurrenceIds.length > 0 &&
    data.targetOccurrenceIds.every((occurrenceId) =>
      data.confirmedOccurrenceIds.includes(occurrenceId),
    )
  ) {
    return "해당 occurrence는 이미 처리되어 중복 실행하지 않습니다.";
  }
  if (data.matches.length === 0) {
    return "대본 위치·키워드·미소비 조건 중 하나가 일치하지 않습니다.";
  }
  return "매칭 성공: 다음 렌더에서 action 실행·step 전진을 확인하세요.";
}

function formatDebugValues(values: readonly string[]) {
  return values.length > 0 ? values.join(", ") : "-";
}
