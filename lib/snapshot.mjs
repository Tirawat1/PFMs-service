// Applies permission-based filtering to a raw data snapshot before it's sent to the client.
export function shapeSnapshot({ admin, canAccounts, canDisburse, canRequests }, raw) {
  const { roles, users, categories, masterDocs, accounts, txns, requests, notifs, audit } = raw;
  return {
    roles,
    users: admin ? users : [],
    categories,
    masterDocs,
    accounts: admin || canAccounts || canDisburse ? accounts : [],
    txns: admin || canAccounts || canDisburse ? txns : [],
    requests: admin || canRequests ? requests : [],
    notifs,
    audit,
  };
}
