// Applies permission-based filtering to a raw data snapshot before it's sent to the client.
export function shapeSnapshot({ admin, canAccounts, canDisburse, canRequests, canSeeAdvances }, raw) {
  const { roles, users, categories, masterDocs, accounts, txns, requests, projections, streams, revenues, notifs, audit } = raw;
  return {
    roles,
    users: admin ? users : [],
    categories,
    masterDocs,
    accounts: admin || canAccounts || canDisburse ? accounts : [],
    txns: admin || canAccounts || canDisburse ? txns : [],
    requests: admin || canRequests ? requests : [],
    projections: admin || canRequests || canSeeAdvances ? (projections || []) : [],
    streams: admin || canAccounts || canDisburse ? (streams || []) : [],
    revenues: admin || canAccounts || canDisburse ? (revenues || []) : [],
    notifs,
    audit,
  };
}
