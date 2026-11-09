# Trying inbill on your own computer

Everything runs locally: the app, a local Supabase (database, sign-in, file storage) in Docker, and no outside services. **Nothing here touches the real site or its database.** No domain, Resend or Razorpay is needed.

## Start

```bash
scripts/local-up.sh
```

Then open **http://localhost:5300**. The first run installs packages (about a minute). Stop it with Ctrl+C. The Docker engine and the local database keep running in the background (`colima stop` stops them).

Test sign-in details for this local copy are in the file `LOCAL-TEST-LOGIN.txt` in this folder. They only work on this computer. You can also create more accounts with "Create your account"; sign-ups are confirmed automatically locally.

## What works locally

All pages and the new editor, saving, issuing, payments, books, GST files, e-invoice practice mode, sample data, team access, accountant overview and client links (use two accounts), business deletion, privacy and terms, the Roadmap.

## What does not (on purpose)

- **Email:** nothing is sent; sending is simulated.
- **Online payment:** the payment link page pays in simulation only.
- **The Claude and ChatGPT connector:** needs Supabase's OAuth server and a public address. Its database layer is installed and tested.

## How it is wired

`scripts/local-up.sh` writes `.env.local` with `INBILL_SUPABASE_URL=http://127.0.0.1:54321`. `lib/supabase.ts` accepts that setting only for a localhost address, so it can never redirect the real site. The local database is the Docker project `supa` (database on port 54322, gateway on 54321) and has all migrations applied, including the ones not yet on the real database.

## If something looks wrong

- Page says it cannot reach the database: run `docker ps` and check the five `supabase_*_supa` containers are up; `scripts/local-up.sh` starts them.
- Out of memory: close other apps; the Docker engine is limited to 3 GB.
- Reset the test data: ask Claude to reset the local database; it is a copy and safe to wipe.
