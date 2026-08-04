---
target: components/App.jsx (entire frontend)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-08-04T15-15-06Z
slug: components-app-jsx
---
Method: dual-agent (A: design-review sub-agent · B: detector+evidence sub-agent)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Disburse-modal submit silently disables with zero explanation |
| 2 | Match System / Real World | 4 | Terminology genuinely mirrors the faculty's real money-movement process |
| 3 | User Control and Freedom | 2 | Reverse-step + one-shot undo exist, but most deletes have no undo path |
| 4 | Consistency and Standards | 2 | Three different confirmation levels for equally destructive delete actions |
| 5 | Error Prevention | 1 | Same no-confirm destructive-icon pattern repeats ~8x app-wide |
| 6 | Recognition Rather Than Recall | 3 | Detail page surfaces most context inline, low recall burden |
| 7 | Flexibility and Efficiency | 1 | Zero keyboard shortcuts, zero bulk actions, anywhere |
| 8 | Aesthetic and Minimalist Design | 3 | Component-level restraint, but FinDashboard stacks ~10 equal-weight panels |
| 9 | Error Recovery | 2 | Toasts surface errors; no inline field-level diagnosis anywhere |
| 10 | Help and Documentation | 0 | No tooltips, no onboarding, nothing explains advance/purse/deposit |
| Total | | 20/40 | Acceptable |

## Design Specificity Verdict

Design review: Not generic CRUD scaffolding - pipeline stepper, discrepancy flag/fix/resolve loop, advance-projection-settle chain, purse/deposit math, vendor-registration branching, Thai bank/PromptPay fields are domain-specific. Reads generic only in execution: ad-hoc inline styles instead of the token system, one uniform "icon + onClick" idiom regardless of destructiveness.

Detector scan: 21 color findings, all one rule (design-system-color), exit code 2. Small set of colors repeated inconsistently: #7cb3ff (link blue) 7 times across lines 149/649/687/840/1474/1533/1538, plus rgba(245,181,68,.14), #3fd8a4, #f5b544 each 2x.

Browser evidence: not available this run - no browser-automation tool exposed to Assessment B. Dev server already running, no cleanup needed.

## Priority Issues

[P0] Destructive single-click icons with zero confirmation - delete user/role, detach doc, remove sample all fire instantly, no modal/reason/confirm. App already has two better patterns (category-delete confirm, transaction-delete reason-modal) just applied inconsistently.

[P0] Disburse button disables with no diagnosis - highest-stakes action, single giant boolean disabled expression, no inline messaging.

[P1] Color system leaks outside tokens - detector-confirmed, 21 findings, #7cb3ff used 7x as raw literal instead of token.

[P1] Icon-only controls are keyboard/screen-reader inaccessible app-wide - bare <i> with onClick, no button/role/tabIndex/aria-label.

[P1] FinDashboard has no single focus - ~10 equal-weight panels on first paint, no "needs you today" banner unlike DeptDashboard.

[P3] "Closed" status reads as inactive not success - same muted gray as disabled element.

## Persona Red Flags

Alex (officer disbursing daily): 7 ungrouped disburse-modal fields, silent disable on missing field, no bulk-advance path, zero keyboard shortcuts anywhere.

Sam (accessibility-dependent): cannot tab to/activate any amount-correction pencil or delete icon; progress bars convey percentage via div width only, no printed number.

## Minor Observations

window.confirm() is the only native dialog in an otherwise custom-modal app. .pipe-cell/.stat clickable but no hover state unlike .catcard/.bankcard. Loading state is unstyled plain text despite /api/data being the heaviest fetch. "Correct" and numedit pencil are two vocabularies for the same action.
