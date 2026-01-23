-- Remove the legacy prospect_classification column from instagram_comments
-- Data has been migrated to contacts.classifications
ALTER TABLE public.instagram_comments DROP COLUMN IF EXISTS prospect_classification;