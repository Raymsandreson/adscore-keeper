-- Add new_followers column to instagram_metrics table
ALTER TABLE instagram_metrics 
ADD COLUMN IF NOT EXISTS new_followers INTEGER DEFAULT 0;