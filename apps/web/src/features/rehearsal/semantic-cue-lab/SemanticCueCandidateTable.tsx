import type { LabCandidateRow } from "./semanticCueLabModel";

function formatScore(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(3);
}

function joinTerms(terms: readonly string[]): string {
  return terms.length > 0 ? terms.join(", ") : "—";
}

export function SemanticCueCandidateTable(props: { rows: readonly LabCandidateRow[] }) {
  if (props.rows.length === 0) {
    return (
      <p className="scue-lab-empty" data-testid="candidate-table-empty">
        승인된 cue 후보가 없습니다.
      </p>
    );
  }

  return (
    <div className="scue-lab-table-scroll">
      <table className="scue-lab-table" data-testid="candidate-table">
        <thead>
          <tr>
            <th>cueId</th>
            <th>reportLabel</th>
            <th>lexical</th>
            <th>matched kw/alias</th>
            <th>concept</th>
            <th>retrieval</th>
            <th>candidate</th>
            <th>NLI 대상</th>
            <th>skip 이유</th>
            <th>final</th>
            <th>decision</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.cueId} data-testid={`candidate-row-${row.cueId}`}>
              <td>{row.cueId}</td>
              <td>{row.reportLabel}</td>
              <td>{formatScore(row.lexicalScore)}</td>
              <td>
                <div className="scue-lab-terms">
                  <span>kw: {joinTerms(row.matchedKeywords)}</span>
                  <span>alias: {joinTerms(row.matchedAliases)}</span>
                </div>
              </td>
              <td>
                <div className="scue-lab-terms">
                  <span>{formatScore(row.conceptCoverage)}</span>
                  <span>{joinTerms(row.matchedConcepts)}</span>
                </div>
              </td>
              <td>{formatScore(row.retrievalScore)}</td>
              <td>{formatScore(row.candidateScore)}</td>
              <td>{row.selectedForNli ? "✓" : "—"}</td>
              <td>{row.nliSkippedReason ?? "—"}</td>
              <td>{formatScore(row.finalScore)}</td>
              <td>
                <span className={`scue-lab-decision scue-lab-decision-${row.decision}`}>
                  {row.decision}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
