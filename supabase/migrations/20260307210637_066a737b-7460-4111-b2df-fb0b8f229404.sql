
ALTER TABLE public.expense_form_tokens 
ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz,
ADD COLUMN IF NOT EXISTS max_reminders integer NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS contact_phone text,
ADD COLUMN IF NOT EXISTS contact_name text;
