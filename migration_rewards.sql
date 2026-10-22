-- Rewards are now approved and paid in the Attendance Tracker.
-- sent_to_tracker: true once the tracker has the reward (it then decides; this app only mirrors paid / rejected).
alter table payouts add column if not exists sent_to_tracker boolean not null default false;
notify pgrst, 'reload schema';
