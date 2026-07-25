import {
  labFailureInjectionLabels,
  labFailureInjections,
  type LabFailureInjection
} from "./semanticCueLabModel";

export function SemanticCueFailureControls(props: {
  active: ReadonlySet<LabFailureInjection>;
  onToggle: (injection: LabFailureInjection) => void;
  onClear: () => void;
}) {
  return (
    <fieldset className="scue-lab-failure-controls" data-testid="failure-controls">
      <legend>Failure injection</legend>
      <div className="scue-lab-failure-grid">
        {labFailureInjections.map((injection) => {
          const checked = props.active.has(injection);
          return (
            <label
              key={injection}
              className={checked ? "scue-lab-failure-chip active" : "scue-lab-failure-chip"}
            >
              <input
                type="checkbox"
                checked={checked}
                data-testid={`failure-${injection}`}
                onChange={() => props.onToggle(injection)}
              />
              <span>{labFailureInjectionLabels[injection]}</span>
            </label>
          );
        })}
      </div>
      <button type="button" onClick={props.onClear} data-testid="failure-clear">
        전체 해제
      </button>
    </fieldset>
  );
}
