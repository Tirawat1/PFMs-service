# Operations

## Health

`GET /api/health` returns `200` with `{status, database, uptimeSeconds,
latencyMs}`, or `503` when the database is unreachable. The container's
HEALTHCHECK polls it every 30s; point your uptime monitor at the same URL.

## Logs

    docker compose logs -f app
    docker compose logs -f db

Prisma logs warnings and errors in production, every query in development. Logs
go to stdout — collect them at the Docker level, don't write log files into the
container.

## Common problems

**App restarts in a loop.** Almost always a bad `DATABASE_URL` or a missing
`AUTH_SECRET` — the entrypoint refuses to start without them. `docker compose
logs app` names the one that failed.

**"database not reachable after 60s".** The db container is unhealthy. Check
`docker compose ps` and `docker compose logs db`; a password change in `.env`
after the volume was created does *not* change the password inside the existing
volume.

**Migrations fail on boot.** Restore the pre-upgrade backup, then apply
migrations by hand with `RUN_MIGRATIONS_ON_BOOT=false` and
`npx prisma migrate deploy` so you can read the error.

**Balances look wrong.** Balances derive from the transaction ledger. Compare
`SELECT type, SUM(amount) FROM transactions GROUP BY type` against the account
row; if they disagree, something wrote a balance directly. That is a bug.

## Routine

| When | Do |
| --- | --- |
| Daily (cron) | `scripts/backup.mjs` |
| Weekly | Check `/api/health`, skim audit entries for surprises |
| Monthly | Restore the latest backup into a scratch database |
| Each release | Backup → `docker compose up -d --build` → verify health |
| Each term | Review users and roles; disable anyone who has left |

## Security notes

- Session cookies are httpOnly, sameSite=lax, and `secure` in production.
- Passwords are bcrypt at cost 12. Nothing stores a password in clear text.
- The login route gives one message for both wrong username and wrong password.
- Department users are scoped in the query, not in the UI — a department cannot
  read another's rows by editing a URL.
- `docker-compose.yml` does not publish Postgres. Leave it that way.
