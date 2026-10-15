-- ============================================================
-- Stack & Study — Postgraduate student support (migration)
-- Run this once in the Supabase SQL editor.
-- It is safe to run more than once, and safe to run if an earlier
-- version of the postgrad migration was already applied.
-- ============================================================
-- Postgrad students don't follow the 10-chapter diploma curriculum —
-- they read whole books (PDFs uploaded by admin, or pasted text) and
-- take one test per book. This adds that as a parallel track without
-- touching chapters / sections / quiz_bank.

-- STUDENT TYPE
alter table students add column if not exists student_type text not null default 'diploma';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'students_student_type_check') then
    alter table students add constraint students_student_type_check
      check (student_type in ('diploma', 'postgrad'));
  end if;
end $$;

-- BOOKS (PDF in Storage, or pasted text)
create table if not exists postgrad_books (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  author          text,
  description     text,
  storage_path    text,
  file_name       text,
  content_text    text,
  sort_order      int not null default 0,
  active          boolean not null default true,
  uploaded_by     text,
  created_at      timestamptz not null default now()
);
-- Upgrade path for databases created by the first (PDF-only) version:
alter table postgrad_books alter column storage_path drop not null;
alter table postgrad_books alter column file_name drop not null;
alter table postgrad_books add column if not exists content_text text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'postgrad_books_has_content') then
    alter table postgrad_books add constraint postgrad_books_has_content
      check (storage_path is not null or content_text is not null);
  end if;
end $$;

-- ONE TEST PER BOOK
create table if not exists postgrad_quiz_bank (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid not null references postgrad_books(id) on delete cascade,
  question        text not null,
  options         jsonb not null,
  correct_index   int not null,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists idx_postgrad_quiz_book on postgrad_quiz_bank(book_id);

-- READING + TEST PROGRESS
create table if not exists postgrad_progress (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  book_id         uuid not null references postgrad_books(id) on delete cascade,
  status          text not null default 'unread'
                    check (status in ('unread', 'in_progress', 'completed', 'failed')),
  score_percent   int,
  attempts_count  int not null default 0,
  last_updated    timestamptz not null default now(),
  unique (student_id, book_id)
);
create index if not exists idx_postgrad_progress_student on postgrad_progress(student_id);

create table if not exists postgrad_attempts (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  quiz_id         uuid not null references postgrad_quiz_bank(id) on delete cascade,
  selected_index  int not null,
  is_correct      boolean not null,
  attempted_at    timestamptz not null default now()
);
create index if not exists idx_postgrad_attempts_student on postgrad_attempts(student_id);

-- ROW LEVEL SECURITY — locked by default; only the backend's
-- service_role key touches these tables.
alter table postgrad_books     enable row level security;
alter table postgrad_quiz_bank enable row level security;
alter table postgrad_progress  enable row level security;
alter table postgrad_attempts  enable row level security;

-- PRIVATE STORAGE BUCKET for book PDFs (students get short-lived signed URLs)
insert into storage.buckets (id, name, public)
values ('postgrad-books', 'postgrad-books', false)
on conflict (id) do nothing;
