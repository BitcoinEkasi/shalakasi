-- Final exam: one result row per student, and the answers recorded while the exam is being written.
create table if not exists final_exams (
  student_id     uuid primary key references students(id) on delete cascade,
  score_percent  int not null,
  passed         boolean not null default false,
  attempts       int not null default 0,
  completed_at   timestamptz,
  extra_attempts int not null default 0,
  unlocked_at    timestamptz
);
create table if not exists final_answers (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  quiz_id     uuid not null references quiz_bank(id) on delete cascade,
  is_correct  boolean not null,
  answered_at timestamptz not null default now(),
  unique (student_id, quiz_id)
);
alter table final_exams   enable row level security;
alter table final_answers enable row level security;
grant all on final_exams, final_answers to service_role;
notify pgrst, 'reload schema';
