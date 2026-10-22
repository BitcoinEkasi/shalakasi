-- Study pace and groups.
-- mastered_at: when a section was first mastered (the weekly pace counts from it). Existing mastered sections keep their last update time.
alter table student_progress add column if not exists mastered_at timestamptz;
update student_progress set mastered_at = last_updated where status = 'mastered' and mastered_at is null;
-- study_group: 1 or 2, for the centre's two-week rotation (null = not set).
alter table students add column if not exists study_group smallint check (study_group in (1, 2));
notify pgrst, 'reload schema';
