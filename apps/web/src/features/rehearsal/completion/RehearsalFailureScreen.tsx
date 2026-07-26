export function RehearsalFailureScreen(props: {
  error: string;
  onPracticeWithoutVoice?: () => void;
  onRetry: () => void;
  projectId?: string;
}) {
  return (
    <main className="rehearsal-preflight-screen" aria-label="리허설 오류">
      <section className="rehearsal-preflight-card" role="alert">
        <div className="rehearsal-preflight-copy">
          <span className="redesign-eyebrow">REHEARSAL ERROR</span>
          <h1>리허설을 시작하지 못했습니다.</h1>
          <p>{props.error}</p>
        </div>
        <div className="rehearsal-preflight-actions">
          <button
            className="rehearsal-preflight-start"
            onClick={props.onRetry}
            type="button"
          >
            다시 시도
          </button>
          {props.onPracticeWithoutVoice ? (
            <button
              className="rehearsal-preflight-quiet"
              onClick={props.onPracticeWithoutVoice}
              type="button"
            >
              마이크 없이 연습
            </button>
          ) : null}
          <a
            href={
              props.projectId
                ? `/project/${encodeURIComponent(props.projectId)}`
                : "/project"
            }
          >
            프로젝트로 돌아가기
          </a>
        </div>
      </section>
    </main>
  );
}
