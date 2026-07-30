#!/usr/bin/env node
/** Fails loudly before deploy if the environment is not production-ready. */

const REQUIRED = ['DATABASE_URL', 'AUTH_SECRET', 'APP_URL'];
const problems = [];

for (const key of REQUIRED) {
  if (!process.env[key]) problems.push(`${key} is not set`);
}

const secret = process.env.AUTH_SECRET || '';
if (secret && secret.length < 32) problems.push('AUTH_SECRET is shorter than 32 characters');
if (/change-?me|secret|password|example/i.test(secret)) problems.push('AUTH_SECRET looks like a placeholder');

const url = process.env.DATABASE_URL || '';
if (url && /:(change-me|password|postgres)@/.test(url)) problems.push('DATABASE_URL still contains a default password');
if (process.env.NODE_ENV === 'production' && process.env.APP_URL?.startsWith('http://') && !process.env.APP_URL.includes('localhost')) {
  problems.push('APP_URL is http:// in production — serve over TLS');
}

if (problems.length) {
  console.error('\nEnvironment is not ready:\n');
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('\nSee .env.example and docs/deployment.md\n');
  process.exit(1);
}

console.log('✓ environment looks good');
