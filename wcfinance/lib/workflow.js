/**
 * The reimbursement pipeline, in order. Each step names who may advance it.
 * Kept in one place so the UI, the API and the tests agree.
 */
export const REQUEST_FLOW = [
  { status: 'notified',          label: 'Notified',          advancedBy: 'create' },
  { status: 'docs_submitted',    label: 'Docs submitted',    advancedBy: 'verify' },
  { status: 'verified',          label: 'Verified',          advancedBy: 'disburse' },
  { status: 'disbursed',         label: 'Disbursed',         advancedBy: 'verify' },
  { status: 'purchase_complete', label: 'Purchase complete', advancedBy: 'verify' },
  { status: 'closed',            label: 'Closed',            advancedBy: null }
];

export const REIMBURSED_STATUSES = ['disbursed', 'purchase_complete', 'closed'];

export const isReimbursed = (status) => REIMBURSED_STATUSES.includes(status);

export function nextStatus(status) {
  const i = REQUEST_FLOW.findIndex((s) => s.status === status);
  return i >= 0 && i < REQUEST_FLOW.length - 1 ? REQUEST_FLOW[i + 1].status : null;
}

export function prevStatus(status) {
  const i = REQUEST_FLOW.findIndex((s) => s.status === status);
  return i > 0 ? REQUEST_FLOW[i - 1].status : null;
}

/** Bank details are only still needed before the money moves. */
export const bankStillNeeded = (status) => !isReimbursed(status);

/** Proof of payment may be attached from disbursement onward. */
export const canAttachProof = (status) => isReimbursed(status);

export const PROJECTION_FLOW = ['submitted', 'approved', 'advanced', 'linked', 'settled'];
