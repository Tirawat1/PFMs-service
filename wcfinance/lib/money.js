/** Money is stored as BigInt satang. 1 baht = 100 satang. */

export const toSatang = (baht) => BigInt(Math.round(Number(baht) * 100));
export const toBaht = (satang) => Number(satang) / 100;

const fmt = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

export const formatTHB = (satang) => fmt.format(toBaht(satang));

/** Sum of a transaction ledger for one account, as BigInt satang. */
export function ledgerBalance(txns) {
  return txns.reduce((sum, t) => (t.type === 'in' ? sum + t.amount : sum - t.amount), 0n);
}

/** Coverage of projected spend by actual reimbursement, 0-1 (null when nothing projected). */
export function coverage(projected, reimbursed) {
  if (!projected || projected === 0n) return null;
  return Number(reimbursed) / Number(projected);
}
