-- ============================================================
-- Stack & Study — complete database schema (self-hosted Postgres)
-- Matches the live Supabase database, plus attendance_log (the
-- Register page), which the Supabase copy was missing.
-- ============================================================

create table chapters (
  id          uuid primary key default gen_random_uuid(),
  number      integer not null unique,
  title       text not null,
  sort_order  integer not null,
  created_at  timestamptz not null default now()
);

create table sections (
  id              uuid primary key default gen_random_uuid(),
  chapter_id      uuid not null references chapters(id) on delete cascade,
  number          text not null,
  title           text not null,
  sort_order      integer not null,
  has_activity    boolean not null default false,
  activity_title  text,
  skill_tag       text,
  content_md      text,
  created_at      timestamptz not null default now(),
  unique (chapter_id, number)
);
create index idx_sections_chapter on sections(chapter_id);

create table students (
  id                 uuid primary key default gen_random_uuid(),
  username           text not null unique,
  password_hash      text not null,
  full_name          text not null,
  cohort             text,
  created_by         text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  student_type       text not null default 'diploma' check (student_type in ('diploma', 'postgrad')),
  lightning_address  text
);

create table quiz_bank (
  id             uuid primary key default gen_random_uuid(),
  section_id     uuid not null references sections(id) on delete cascade,
  question       text not null,
  options        jsonb not null,
  correct_index  integer not null,
  difficulty     text not null default 'core' check (difficulty in ('core', 'stretch', 'review')),
  created_at     timestamptz not null default now()
);
create index idx_quiz_section on quiz_bank(section_id);

create table student_progress (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  section_id      uuid not null references sections(id) on delete cascade,
  status          text not null default 'locked'
                    check (status in ('locked', 'available', 'in_progress', 'mastered', 'reinforced')),
  mastery_score   numeric(4,3) not null default 0,
  attempts_count  integer not null default 0,
  last_updated    timestamptz not null default now(),
  unique (student_id, section_id)
);
create index idx_progress_student on student_progress(student_id);

create table attempts (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id) on delete cascade,
  quiz_id           uuid not null references quiz_bank(id) on delete cascade,
  selected_index    integer not null,
  is_correct        boolean not null,
  response_time_ms  integer,
  attempted_at      timestamptz not null default now()
);
create index idx_attempts_student on attempts(student_id);

create table chat_log (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  section_id  uuid references sections(id) on delete set null,
  role        text not null check (role in ('student', 'satoshi')),
  message     text not null,
  created_at  timestamptz not null default now()
);
create index idx_chat_student on chat_log(student_id, created_at);

create table ai_decisions (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id) on delete cascade,
  from_section_id  uuid references sections(id) on delete set null,
  to_section_id    uuid references sections(id) on delete set null,
  decision_type    text not null check (decision_type in ('advance', 'reinforce', 'branch')),
  reasoning        text not null,
  created_at       timestamptz not null default now()
);
create index idx_decisions_student on ai_decisions(student_id, created_at);

create table chapter_reviews (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references students(id) on delete cascade,
  chapter_id     uuid not null references chapters(id) on delete cascade,
  score_percent  integer not null,
  passed         boolean not null,
  completed_at   timestamptz not null default now(),
  unique (student_id, chapter_id)
);
create index idx_chapter_reviews_student on chapter_reviews(student_id);

create table review_answers (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  chapter_id   uuid not null references chapters(id) on delete cascade,
  quiz_id      uuid not null references quiz_bank(id) on delete cascade,
  is_correct   boolean not null,
  answered_at  timestamptz not null default now(),
  unique (student_id, quiz_id)
);

create table postgrad_books (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  author        text,
  description   text,
  storage_path  text,
  file_name     text,
  sort_order    integer not null default 0,
  active        boolean not null default true,
  uploaded_by   text,
  created_at    timestamptz not null default now(),
  content_text  text,
  constraint postgrad_books_has_content check (storage_path is not null or content_text is not null)
);

create table postgrad_quiz_bank (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references postgrad_books(id) on delete cascade,
  question       text not null,
  options        jsonb not null,
  correct_index  integer not null,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);
create index idx_postgrad_quiz_book on postgrad_quiz_bank(book_id);

create table postgrad_progress (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  book_id         uuid not null references postgrad_books(id) on delete cascade,
  status          text not null default 'unread'
                    check (status in ('unread', 'in_progress', 'completed', 'failed')),
  score_percent   integer,
  attempts_count  integer not null default 0,
  last_updated    timestamptz not null default now(),
  unique (student_id, book_id)
);
create index idx_postgrad_progress_student on postgrad_progress(student_id);

create table postgrad_attempts (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  quiz_id         uuid not null references postgrad_quiz_bank(id) on delete cascade,
  selected_index  integer not null,
  is_correct      boolean not null,
  attempted_at    timestamptz not null default now()
);
create index idx_postgrad_attempts_student on postgrad_attempts(student_id);

create table payouts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  kind         text not null check (kind in ('chapter', 'book')),
  ref_id       uuid not null,
  label        text not null,
  amount_sats  integer not null check (amount_sats > 0),
  status       text not null default 'pending' check (status in ('pending', 'paid', 'rejected')),
  note         text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  unique (student_id, kind, ref_id)
);
create index idx_payouts_status on payouts(status);

-- The Register page: one row per student per calendar day.
create table attendance_log (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references students(id) on delete cascade,
  log_date        date not null,
  first_login_at  timestamptz not null default now(),
  last_login_at   timestamptz not null default now(),
  login_count     integer not null default 1,
  unique (student_id, log_date)
);
create index idx_attendance_date on attendance_log(log_date);
