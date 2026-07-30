#!/usr/bin/env node
/** Restore a pg_dump file:  node scripts/restore.mjs backups/wcfinance-….dump */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const file = process.argv[2];
const url = process.env.DATABASE_URL;

if (!file) { console.error('usage: node scripts/restore.mjs <dump-file>'); process.exit(1); }
if (!existsSync(file)) { console.error(`no such file: ${file}`); process.exit(1); }
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`This REPLACES the contents of the target database.\nType the word RESTORE to continue: `);
rl.close();
if (answer.trim() !== 'RESTORE') { console.log('aborted'); process.exit(0); }

execFileSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-acl', '--dbname', url, file], { stdio: 'inherit' });
console.log('restore complete — run "npm run db:migrate" to apply any newer migrations');
