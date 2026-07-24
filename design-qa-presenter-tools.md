# Presenter tools design QA

- Reference: `C:\Users\Runner\Desktop\Frame 20.png` (`4214x2753`)
- Implementation: `D:\Projects\Orbit\.tmp\design-qa\presenter-tools-expanded.png` (`1421x874`)
- Route: `http://localhost:5173/rehearsal/project_a0facb38-58a5-4994-9748-5b02718029e3?presenterSessionId=session_532ff212-ff33-4733-9056-34003ef7efa1&presenterWindow=1&slideIndex=8&stepIndex=0`
- Viewport: `1421x874`
- State: presenter tool panel expanded, audience output disconnected

## Comparison history

1. First implementation pass
   - Replaced the persistent header controls with a centered collapsible tool panel.
   - Matched the reference's four equal action tiles and centered toggle placement.
   - Preserved the existing presenter content layout below the tool panel.

## Required surfaces

- Typography: existing presenter UI type scale and weights retained.
- Spacing/layout: four equal-width controls, centered panel, toggle immediately below the panel.
- Tokens: existing redesign surface, border, radius, text, and error tokens reused.
- Icons/assets: existing Tabler icon set reused for all four actions and the toggle.
- Copy: `애플리케이션 공유하기`, `전체 화면 공유하기`, `청중 화면 가리기`, `발표 종료`.

## Interaction checks

- Presenter tools start collapsed.
- Expand button reveals all four actions.
- Collapse button hides the panel and restores `aria-expanded="false"`.
- Browser console contains no warnings or errors.

## Result

passed
