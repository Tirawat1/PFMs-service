import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStatus, prevStatus, isReimbursed, bankStillNeeded, canAttachProof } from '../lib/workflow.js';

test('pipeline advances in order and stops at closed', () => {
  assert.equal(nextStatus('notified'), 'docs_submitted');
  assert.equal(nextStatus('verified'), 'disbursed');
  assert.equal(nextStatus('closed'), null);
});

test('pipeline reverses and stops at the first step', () => {
  assert.equal(prevStatus('disbursed'), 'verified');
  assert.equal(prevStatus('notified'), null);
});

test('a request counts as reimbursed only once money has moved', () => {
  assert.equal(isReimbursed('verified'), false);
  assert.equal(isReimbursed('disbursed'), true);
  assert.equal(isReimbursed('closed'), true);
});

test('bank details are requested before disbursement, never after', () => {
  assert.equal(bankStillNeeded('docs_submitted'), true);
  assert.equal(bankStillNeeded('disbursed'), false);
});

test('proof of payment attaches from disbursement onward', () => {
  assert.equal(canAttachProof('verified'), false);
  assert.equal(canAttachProof('purchase_complete'), true);
});
