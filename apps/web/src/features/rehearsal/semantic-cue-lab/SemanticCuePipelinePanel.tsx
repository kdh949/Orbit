import type { SemanticCueDebugEvent } from "../speech/semanticCueDebugEvents";
import type { LabPipelineStep } from "./semanticCueLabModel";

const stepStatusLabel: Record<LabPipelineStep["status"], string> = {
  ok: "OK",
  skipped: "생략",
  fallback: "fallback",
  blocked: "차단"
};

export function SemanticCuePipelinePanel(props: {
  steps: readonly LabPipelineStep[];
  nli: SemanticCueDebugEvent["nli"] | undefined;
  nliSkipDetail: string;
}) {
  return (
    <div className="scue-lab-pipeline" data-testid="pipeline-panel">
      <ol className="scue-lab-pipeline-steps">
        {props.steps.map((step) => (
          <li key={step.id} data-testid={`pipeline-step-${step.id}`} className={`scue-lab-step scue-lab-step-${step.status}`}>
            <div className="scue-lab-step-head">
              <span className="scue-lab-step-label">{step.label}</span>
              <span className={`scue-lab-badge scue-lab-badge-${step.status}`}>
                {stepStatusLabel[step.status]}
              </span>
            </div>
            <p className="scue-lab-step-detail">{step.detail}</p>
          </li>
        ))}
      </ol>

      <section className="scue-lab-nli-detail" data-testid="nli-detail">
        <h4>NLI detail</h4>
        {props.nli ? (
          <dl>
            <div>
              <dt>provider</dt>
              <dd>{props.nli.provider}</dd>
            </div>
            <div>
              <dt>modelId</dt>
              <dd>{props.nli.modelId ?? "—"}</dd>
            </div>
            <div>
              <dt>latencyMs</dt>
              <dd>{props.nli.latencyMs}</dd>
            </div>
            <div>
              <dt>premise</dt>
              <dd className="scue-lab-mono">{props.nli.premise}</dd>
            </div>
            {props.nli.hypotheses.map((hypothesis, index) => (
              <div key={`${hypothesis.cueId}:${index}`} className="scue-lab-nli-hypothesis">
                <dt>{hypothesis.cueId}</dt>
                <dd>
                  <span className="scue-lab-mono">{hypothesis.hypothesis}</span>
                  <span className="scue-lab-nli-scores">
                    ent {hypothesis.entailmentScore.toFixed(3)} · neu{" "}
                    {hypothesis.neutralScore.toFixed(3)} · con{" "}
                    {hypothesis.contradictionScore.toFixed(3)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="scue-lab-nli-skipped" data-testid="nli-skipped-reason">
            NLI 실행 안 됨 · <strong>{props.nliSkipDetail}</strong>
          </p>
        )}
      </section>
    </div>
  );
}
