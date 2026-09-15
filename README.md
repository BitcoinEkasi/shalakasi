# ShalaKasi

**My First Bitcoin Diploma — Powered by Bitcoin Ekasi**

A self-paced Bitcoin Diploma platform for Bitcoin Ekasi, built for Students work through a 10-chapter Bitcoin curriculum at their own pace on shared workstations, with mastery-based progression, cumulative chapter reviews, and real-time Bitcoin network data woven directly into the lessons.


---
## What it does

- **10-chapter curriculum, ~82 sections** — from "Why Do We Need Money?" through fiat's failures, Bitcoin's creation, wallets and self-custody, Lightning, the technical fundamentals, and a closing reflection on why it all matters.
- **Adaptive, mastery-based progression** — a student only advances past a section once they've scored above threshold on its checkpoint questions. Sections that fall short are marked for review, not silently skipped.
- **Chapter Reviews** — once every section in a chapter is mastered, a cumulative test pulls together every checkpoint question from that whole chapter. A student must score **70%+ to pass** before the next chapter unlocks — this isn't optional, it's a real gate.
- **Sats rewards** — passing a chapter review is wired to trigger a real 500-sat Lightning payment via the existing Bitcoin Ekasi Attendance Tracker's payment rails (currently disabled pending final payment credentials — see [Known gaps](#known-gaps-and-honest-status) below).
- **Live Bitcoin Network dashboard** — a dedicated screen showing real-time BTC/ZAR price, current block height and hash, live mempool activity, current fee rates, and a live-ticking countdown to the next halving — all pulled directly from public APIs (CoinGecko, mempool.space), refreshing automatically.
- **The Book** — the entire curriculum as one scrollable, readable reference with a jump-to table of contents.
- **Progress path** — a visual winding path of all 10 chapters, colored by mastery status, plus a running sats-earned counter.
- **Completion certificate** — a student who finishes every chapter gets a styled, printable certificate.
- **Automatic attendance** — every login is logged (Monday–Friday), building a real register without any manual step.
- **Admin dashboard** (`/admin.html`) — student account management, the attendance register, a program-level Impact dashboard (completion rates, chapter-by-chapter funnel, toughest questions) for reporting to the steering committee, and enrolment agreement capture (liability waiver / POPIA consent) per student.

---

## Tech stack

- **Backend:** Node.js + Express, hosted on [Render](https://render.com)
- **Database:** [Supabase](https://supabase.com) (Postgres) — students, curriculum, progress, quiz attempts, chapter reviews, attendance, enrolment records
- **Frontend:** Plain HTML/CSS/JavaScript, no framework — served directly by Express
- **Live data:** CoinGecko and mempool.space public APIs, called directly from the browser (no backend involved, no API key needed)

There is currently **no AI/LLM integration** — an earlier version used the Claude API for an in-app tutor and adaptive routing; this was deliberately removed to eliminate API cost and external-service dependency. Routing decisions now run on a fixed rule (75% mastery threshold).

---

## Project structure

```
shalakasi/
├── server.js              # Express app — all API routes
├── services/
│   ├── supabase.js        # Supabase client (service_role, server-side only)
│   ├── aiEngine.js        # Rule-based section routing logic
│   └── blinkPayment.js    # Sats reward payment integration (currently unused — see Known gaps)
├── public/
│   ├── index.html/app.js/style.css     # Student-facing app
│   └── admin.html/admin.js/admin-style.css  # Admin dashboard
├── data/                  # SQL migrations + curriculum/quiz seed data (JSON)
├── scripts/                # One-off seed scripts (seed_curriculum.js, seed_content.js, seed_quiz.js)
└── CONTENT_GUIDE.md        # Format/pattern guide for writing new lesson content
```

## Setup

1. Create a Supabase project, run every migration file in `data/*.sql` (in the Supabase SQL editor)
2. Copy `.env.example` to `.env` and fill in:
   ```
   SUPABASE_URL=
   SUPABASE_SERVICE_ROLE_KEY=
   JWT_SECRET=
   ADMIN_KEY=
   ```
3. `npm install`
4. Seed the curriculum:
   ```
   node scripts/seed_curriculum.js
   node scripts/seed_content.js content_seed.json        # repeat per chapter batch
   node scripts/seed_quiz.js quiz_bank_seed.json          # repeat per chapter batch
   ```
5. `npm start` — runs on `http://localhost:3300`
6. Create your first admin-provisioned student via `POST /api/admin/students` (see admin dashboard for the UI version)

### Deploying

Pushes to `main` auto-deploy on Render. **Always check the Render dashboard for a green checkmark after pushing** — a failed deploy silently leaves the previous version running with no obvious error on the frontend.

---

## Known gaps and honest status

- **Sats rewards are not live.** The payment code path exists (`services/blinkPayment.js`) but is currently disconnected from `server.js` to keep the app deployable without payment credentials configured. Reconnecting it requires `BITCOINEKASI_SUPABASE_URL`, `BITCOINEKASI_SUPABASE_SERVICE_ROLE_KEY`, and a real `BLINK_API_KEY`.
- **No student has completed the full Diploma yet** — the completion certificate is built and tested in isolation, not yet confirmed against a real end-to-end graduate.
- **Free-tier hosting** — Render's free plan sleeps after inactivity, causing a ~50 second delay on the first request after idle. Worth upgrading before real classroom use at scale.
- **Content coverage** — Chapters 1–7 have expanded, detailed lesson text; Chapters 8–10 currently have the original (shorter) draft content. See `CONTENT_GUIDE.md` for the pattern to extend them.
- **Single production database, single admin key** — no staging environment or backup database yet.

---

## Credits

Built for **Bitcoin Ekasi Mossel Bay, South Africa.
