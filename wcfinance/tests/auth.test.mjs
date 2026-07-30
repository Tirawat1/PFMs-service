import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, seesAllDepts } from '../lib/auth.js';

test('wildcard permission grants everything', () => {
  assert.equal(can(['*'], 'disburse'), true);
  assert.equal(can(['*'], 'anything'), true);
});

test('a department may create but not disburse', () => {
  assert.equal(can(['create'], 'create'), true);
  assert.equal(can(['create'], 'disburse'), false);
});

test('only finance and admin see every department', () => {
  assert.equal(seesAllDepts(['create']), false);
  assert.equal(seesAllDepts(['verify']), false);
  assert.equal(seesAllDepts(['disburse']), true);
  assert.equal(seesAllDepts(['*']), true);
});
