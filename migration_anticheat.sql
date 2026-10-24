-- Anti-cheat: remember when a student opened each section, so the server can ask for a fair reading time.
alter table student_progress add column if not exists opened_at timestamptz;
notify pgrst, 'reload schema';
