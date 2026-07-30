# tests/

Plain `node:test` — no framework, no config.

    npm test

`lib/` is pure and covered here: money arithmetic, the pipeline state machine,
and the permission rules. These are the parts where a silent regression costs
real money, so they are tested away from the database and the UI.

API-route and end-to-end tests need a throwaway database. Point `DATABASE_URL`
at one, then run them with the same command:

    DATABASE_URL=postgresql://…/wcfinance_test npm test
