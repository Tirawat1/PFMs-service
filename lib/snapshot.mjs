// Applies permission-based filtering to a raw data snapshot before it's sent to the client.
export function shapeSnapshot({ admin, canAccounts, canRequests }, raw) {
  const { roles, users, categories, masterDocs, accounts, txns, requests, notifs, audit } = raw;
  return {
    roles,
    users: admin ? users : [],
    categories,
    masterDocs,
    accounts: admin || canAccounts ? accounts : [],
    txns: admin || canAccounts ? txns : [],
    requests: admin || canRequests ? requests : [],
    notifs,
    audit,
  };
}
