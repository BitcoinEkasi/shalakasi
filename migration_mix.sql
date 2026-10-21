-- Per-student question mixes: remember how many times a chapter review has been finished,
-- so every new attempt gets a fresh mix. Safe to run more than once.
alter table chapter_reviews add column if not exists attempts int not null default 0;
