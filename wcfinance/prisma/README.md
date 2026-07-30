# prisma/

`schema.prisma` is the source of truth for the database. `seed.mjs` loads the
reference data every deployment needs: roles, the two bank accounts, the four
funding streams, the nine expense categories with their document checklists, and
one admin user.

## First run

    npm run db:migrate:dev -- --name init   # creates migrations/ and applies it
    npm run db:seed

## Later changes

Edit `schema.prisma`, then:

    npm run db:migrate:dev -- --name what_changed

Commit the generated folder under `migrations/`. In production the entrypoint
runs `prisma migrate deploy`, which only applies committed migrations and never
generates new ones.

## Money

All amounts are `BigInt` **satang** (1 baht = 100 satang). Never store baht as a
float. `lib/money.js` has the conversion and formatting helpers.
