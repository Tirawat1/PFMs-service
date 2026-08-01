// Guards the "set status directly, bypassing the normal workflow" escape hatch used
// only when importing pre-existing historical data. Deliberately gated on a role flag
// narrower than admin — see this plan's Global Constraints.
export function applyStatusOverride({ isMigrationOperator, chosenStatus }) {
  if (!isMigrationOperator) return { error: "Only a data-migration operator can set status directly." };
  if (!chosenStatus) return { error: "Choose a status." };
  return { ok: true };
}
