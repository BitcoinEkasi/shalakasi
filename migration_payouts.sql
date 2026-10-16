-- ============================================================
-- Stack & Study — progress payouts (migration)
-- Run once in the Supabase SQL editor. Safe to run more than once.
-- ============================================================
-- Students earn sats for progress: passing a diploma chapter review or a
-- postgrad book test. Each reward is logged here as 'pending'; an admin
-- approves it (marks it paid) or rejects it. One reward per student per
-- chapter/book, ever — retakes never create a second one.

alter table students add column if not exists lightning_address text;

create table if not exists payouts (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade,
  kind          text not null check (kind in ('chapter', 'book')),
  ref_id        uuid not null,                 -- chapter id or book id
  label         text not null,                 -- e.g. "Chapter 3 review"
  amount_sats   int  not null check (amount_sats > 0),
  status        text not null default 'pending'
                  check (status in ('pending', 'paid', 'rejected')),
  note          text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  unique (student_id, kind, ref_id)
);
create index if not exists idx_payouts_status on payouts(status);

-- Server-side record of each chapter-review answer, so the review score is
-- worked out on the server instead of being trusted from the browser.
create table if not exists review_answers (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  chapter_id  uuid not null references chapters(id) on delete cascade,
  quiz_id     uuid not null references quiz_bank(id) on delete cascade,
  is_correct  boolean not null,
  answered_at timestamptz not null default now(),
  unique (student_id, quiz_id)
);

alter table payouts        enable row level security;
alter table review_answers enable row level security;
