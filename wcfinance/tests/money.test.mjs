import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSatang, toBaht, ledgerBalance, coverage } from '../lib/money.js';

test('baht converts to satang without float drift', () => {
  assert.equal(toSatang(185000), 18500000n);
  assert.equal(toSatang(0.1) + toSatang(0.2), toSatang(0.3));
});

test('satang converts back to baht', () => {
  assert.equal(toBaht(18500000n), 185000);
});

test('ledger balance nets in against out', () => {
  const txns = [
    { type: 'in', amount: 120000000n },
    { type: 'out', amount: 18500000n },
    { type: 'out', amount: 4200000n }
  ];
  assert.equal(ledgerBalance(txns), 97300000n);
});

test('coverage is null when nothing is projected', () => {
  assert.equal(coverage(0n, 500n), null);
  assert.equal(coverage(1000n, 500n), 0.5);
});
