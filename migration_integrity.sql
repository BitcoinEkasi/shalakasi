-- Integrity: remember the IP of each day's last login, and let a teacher unlock one more try at a chapter test.
alter table attendance_log add column if not exists last_ip text;
alter table chapter_reviews add column if not exists extra_attempts int not null default 0;
alter table chapter_reviews add column if not exists unlocked_at timestamptz;
notify pgrst, 'reload schema';
