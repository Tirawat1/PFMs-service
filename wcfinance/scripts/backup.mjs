#!/usr/bin/env node
/**
 * pg_dump the database into backups/. Keeps the last 30 files.
 * Run daily from cron:  0 2 * * *  cd /srv/wcfinance && npm run backup
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.BACKUP_DIR || 'backups';
const KEEP = Number(process.env.BACKUP_KEEP || 30);
const url = process.env.DATABASE_URL;

if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }

mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = join(DIR, `wcfinance-${stamp}.dump`);

console.log(`dumping to ${file}`);
execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', file, url], { stdio: 'inherit' });

const old = readdirSync(DIR)
  .filter((f) => f.endsWith('.dump'))
  .map((f) => ({ f, t: statSync(join(DIR, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)
  .slice(KEEP);

for (const { f } of old) { unlinkSync(join(DIR, f)); console.log(`pruned ${f}`); }
console.log('backup complete');
