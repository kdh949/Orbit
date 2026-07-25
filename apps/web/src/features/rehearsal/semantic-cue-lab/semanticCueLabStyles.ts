export const semanticCueLabPageStyles = `
.scue-lab {
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 20px 96px;
  color: #0f172a;
  font-size: 14px;
  line-height: 1.5;
}
.scue-lab-header h1 { margin: 0; font-size: 22px; }
.scue-lab-subtitle { margin: 4px 0 0; color: #475569; }
.scue-lab-status {
  margin: 12px 0 0;
  padding: 8px 12px;
  background: #ecfeff;
  border: 1px solid #a5f3fc;
  border-radius: 8px;
}
.scue-lab-section {
  margin-top: 20px;
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
}
.scue-lab-section > h2 { margin: 0 0 12px; font-size: 16px; }
.scue-lab-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 10px; }
.scue-lab-inline { display: inline-flex; gap: 6px; align-items: center; }
.scue-lab-meta { color: #64748b; }
.scue-lab button {
  padding: 6px 12px;
  border: 1px solid #cbd5f5;
  border-radius: 8px;
  background: #f8fafc;
  cursor: pointer;
  font-size: 13px;
}
.scue-lab button:hover { background: #eef2ff; }
.scue-lab-run { background: #2563eb; color: #ffffff; border-color: #2563eb; }
.scue-lab-textarea {
  width: 100%;
  min-height: 96px;
  margin-top: 10px;
  padding: 8px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.scue-lab input[type="text"], .scue-lab input:not([type]), .scue-lab select {
  padding: 6px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 13px;
}
.scue-lab-file { display: inline-flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; }
.scue-lab-error { margin-top: 10px; color: #b91c1c; font-family: ui-monospace, monospace; font-size: 12px; }

.scue-lab-slide-detail { margin-top: 12px; }
.scue-lab-slide-meta { display: flex; flex-wrap: wrap; gap: 16px; }
.scue-lab-slide-meta dt { color: #64748b; font-size: 12px; }
.scue-lab-slide-meta dd { margin: 0; font-weight: 600; }
.scue-lab-cue-card { margin-top: 10px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
.scue-lab-cue-card header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.scue-lab-cue-tag { padding: 1px 8px; border-radius: 999px; background: #e2e8f0; font-size: 11px; }
.scue-lab-cue-approved { background: #dcfce7; }
.scue-lab-cue-suggested { background: #fef9c3; }
.scue-lab-cue-excluded { background: #e2e8f0; }
.scue-lab-cue-stale { background: #fee2e2; }
.scue-lab-cue-meaning { margin: 6px 0; font-weight: 600; }
.scue-lab-cue-fields { margin: 0; padding-left: 16px; color: #475569; font-size: 12px; }

.scue-lab-segment-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.scue-lab-segment-form input:not([type="checkbox"]) { width: 100px; }
.scue-lab-segment-form input[data-testid="segment-text"] { width: 260px; }
.scue-lab-segment-list { margin: 12px 0 0; padding-left: 16px; }
.scue-lab-segment-list li { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.scue-lab-final { color: #15803d; font-weight: 600; }
.scue-lab-partial { color: #b45309; font-weight: 600; }
.scue-lab-segment-text { flex: 1; }
.scue-lab-details { margin-top: 12px; }

.scue-lab-provider { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; display: inline-flex; gap: 12px; align-items: center; }
.scue-lab-provider legend { font-size: 12px; color: #64748b; }

.scue-lab-failure-controls { margin-top: 12px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
.scue-lab-failure-grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.scue-lab-failure-chip { display: inline-flex; gap: 6px; align-items: center; padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 999px; font-size: 12px; }
.scue-lab-failure-chip.active { background: #fee2e2; border-color: #fca5a5; }

.scue-lab-pipeline { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.scue-lab-pipeline-steps { margin: 0; padding-left: 0; list-style: none; }
.scue-lab-step { padding: 6px 10px; border-left: 3px solid #cbd5e1; margin-bottom: 6px; background: #f8fafc; }
.scue-lab-step-ok { border-left-color: #16a34a; }
.scue-lab-step-fallback { border-left-color: #d97706; }
.scue-lab-step-blocked { border-left-color: #dc2626; }
.scue-lab-step-skipped { border-left-color: #94a3b8; }
.scue-lab-step-head { display: flex; justify-content: space-between; gap: 8px; }
.scue-lab-step-label { font-weight: 600; }
.scue-lab-step-detail { margin: 2px 0 0; color: #475569; font-size: 12px; }
.scue-lab-badge { font-size: 11px; padding: 0 8px; border-radius: 999px; background: #e2e8f0; }
.scue-lab-badge-ok { background: #dcfce7; }
.scue-lab-badge-fallback { background: #fef3c7; }
.scue-lab-badge-blocked { background: #fee2e2; }
.scue-lab-nli-detail { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
.scue-lab-nli-detail dt { color: #64748b; font-size: 12px; }
.scue-lab-nli-detail dd { margin: 0 0 6px; }
.scue-lab-mono { font-family: ui-monospace, monospace; font-size: 12px; }
.scue-lab-nli-scores { display: block; color: #475569; font-size: 12px; }
.scue-lab-nli-skipped { padding: 8px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; }

.scue-lab-table-scroll { overflow-x: auto; margin-top: 10px; }
.scue-lab-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.scue-lab-table th, .scue-lab-table td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; vertical-align: top; }
.scue-lab-table th { background: #f1f5f9; }
.scue-lab-terms { display: flex; flex-direction: column; gap: 2px; }
.scue-lab-decision { padding: 1px 8px; border-radius: 999px; background: #e2e8f0; }
.scue-lab-decision-covered { background: #dcfce7; }
.scue-lab-decision-partial { background: #fef9c3; }
.scue-lab-decision-not_covered { background: #fee2e2; }
.scue-lab-decision-contradicted { background: #fecaca; }

.scue-lab-action-gate { margin-top: 8px; }
.scue-lab-gate-flags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.scue-lab-gate-flags span { padding: 2px 10px; border-radius: 999px; font-size: 12px; }
.scue-lab-gate-flags .ok { background: #dcfce7; }
.scue-lab-gate-flags .blocked { background: #fee2e2; }
.scue-lab-action-gate dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
.scue-lab-action-gate dt { color: #64748b; font-size: 12px; }
.scue-lab-action-gate dd { margin: 0; font-weight: 600; }

.scue-lab-mode-preview { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.scue-lab-preview-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; }
.scue-lab-preview-card header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.scue-lab-preview-card h4 { margin: 0; font-size: 14px; }
.scue-lab-mode-chip { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #e0e7ff; }
.scue-lab-live-preview { background: #0f172a; color: #e2e8f0; }
.scue-lab-audience-note { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #7f1d1d; color: #fecaca; }
.scue-lab-live-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.scue-lab-live-chip { padding: 2px 10px; border-radius: 999px; background: #1e293b; font-size: 12px; }
.scue-lab-live-chip.ok { background: #14532d; color: #bbf7d0; }
.scue-lab-live-note { font-size: 11px; color: #94a3b8; }
.scue-lab-system-status ul, .scue-lab-checklist ul, .scue-lab-report-outcomes { list-style: none; margin: 6px 0 0; padding: 0; }
.scue-lab-system-status li { display: flex; flex-direction: column; padding: 6px; border-radius: 6px; background: #fff7ed; margin-bottom: 4px; }
.scue-lab-status-label { font-weight: 600; }
.scue-lab-status-detail { color: #475569; font-size: 12px; }
.scue-lab-status-retry { font-size: 11px; color: #b45309; }
.scue-lab-outcome { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 4px 0; }
.scue-lab-outcome-status { padding: 1px 8px; border-radius: 999px; background: #e2e8f0; font-size: 11px; }
.scue-lab-outcome-covered .scue-lab-outcome-status { background: #dcfce7; }
.scue-lab-outcome-partial .scue-lab-outcome-status { background: #fef9c3; }
.scue-lab-outcome-missed .scue-lab-outcome-status { background: #fee2e2; }
.scue-lab-outcome-unmeasured .scue-lab-outcome-status { background: #e0e7ff; }
.scue-lab-outcome-reason, .scue-lab-outcome-tag, .scue-lab-outcome-evidence { font-size: 11px; color: #475569; }
.scue-lab-report-fallback { color: #b45309; font-weight: 600; }
.scue-lab-report-guidance { font-size: 12px; color: #475569; font-style: italic; }

.scue-lab-timeline { list-style: none; margin: 0; padding: 0; }
.scue-lab-timeline-item { padding: 6px 10px; border-left: 3px solid #cbd5e1; margin-bottom: 6px; background: #f8fafc; }
.scue-lab-timeline-capability { border-left-color: #6366f1; }
.scue-lab-timeline-decision { border-left-color: #0ea5e9; }
.scue-lab-timeline-head { display: flex; gap: 8px; align-items: center; }
.scue-lab-timeline-kind { font-size: 11px; padding: 0 8px; border-radius: 999px; background: #e2e8f0; }
.scue-lab-timeline-item p { margin: 2px 0 0; color: #475569; font-size: 12px; }

.scue-lab-pass { color: #15803d; font-weight: 700; }
.scue-lab-fail { color: #b91c1c; font-weight: 700; }
.scue-lab-empty { color: #64748b; font-style: italic; }

@media (max-width: 720px) {
  .scue-lab-pipeline { grid-template-columns: 1fr; }
}
`;
