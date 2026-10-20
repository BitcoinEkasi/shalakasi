# Moving Stack & Study from Supabase to your own database

Everything runs on your Mynymbox server. Supabase is **never changed** — it stays as your safety net.
All commands below are run **on the server** (`root@ekasi-server`), from the app folder:

    cd /opt/shalakasi/app

## Before the evening you switch (students not affected)

1. `bash deploy/01-setup.sh` — installs Postgres 17 + PostgREST on localhost only. Ends with "OK".
2. `bash deploy/02-copy-data.sh` — paste your Supabase connection string (Session pooler) when asked.
   Ends with "All tables match." You can run it again any time before the switch to refresh the copy.
3. `/opt/node22/bin/node deploy/03-copy-books.js` — copies the book PDFs to the server disk.

## The switch (about 10 minutes, evening)

1. Tell students the site is briefly down. Run steps 2 and 3 above once more (fresh copy of the latest data).
2. `bash deploy/04-switch.sh` — points the app at your own database and restarts it. Prints `site: HTTP 200`.
3. Check: log in as a student, open a chapter, open a postgrad book PDF; log in to Admin, open Students, Payouts, Register.
4. `bash deploy/05-backup.sh install` — nightly backups (kept 14 days in /opt/shalakasi/backups).

## If anything looks wrong

`bash deploy/04-switch.sh back` — the app talks to Supabase again within seconds. (Anything done in the
few minutes on the new database stays there, so go back quickly or not at all.)

## Backups must leave the server

A backup on the same disk is not a backup. From your laptop, e.g. weekly:

    scp -r root@89.125.10.8:/opt/shalakasi/backups ~/stack-and-study-backups

## Notes
- The Register (attendance) now lives in your database (table `attendance_log`). Enrolment is not migrated.
- Keep Supabase for 2+ weeks after the switch, then pause the project.
- Never run `02-copy-data.sh` after the switch: it would overwrite newer data (the script refuses).
