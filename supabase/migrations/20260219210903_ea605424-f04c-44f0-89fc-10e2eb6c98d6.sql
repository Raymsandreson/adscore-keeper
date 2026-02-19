
-- Add target_days column (array of weekday integers: 0=Sunday, 1=Monday, ..., 6=Saturday)
-- Default to weekdays (Mon-Fri = [1,2,3,4,5])
ALTER TABLE public.user_daily_goal_defaults
ADD COLUMN target_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}';
