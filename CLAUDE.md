# Nordic Pet dashboard

Profit dashboard for one fictional store. Two sources: a Google Sheet and a Google Drive
folder. Data flows source → raw tables → fact tables → metrics → screen. Nothing skips a step.

## Commands

```bash
npm run dev            # local app
npm test               # unit tests
npm run lint           # lint, must be clean before a PR
npm run db:reset       # rebuild the database from migrations + seed
```

## Rules

- Never write to `main`. Branch, PR, merge.
- The screen never calculates. It displays what the metrics layer returns.
- An ingester upserts. Running it twice must change nothing.
- Never write a zero where "no data" is what happened. Missing cost is missing, not free.
- Money is stored in the currency it was billed in, and converted at the rate of that day.
- Every task ships with a check that fails when the change is reverted.
- Service-account keys and passwords live in `.env.local` and in Vercel. Never in git.

## Gotchas in this data

The source data is filled in by a human and is dirty on purpose. Before assuming a parser
bug, check the raw table: the row is probably there, and probably wrong in a way the loader
should have handled.
