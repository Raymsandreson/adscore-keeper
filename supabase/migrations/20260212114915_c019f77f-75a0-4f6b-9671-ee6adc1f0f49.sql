
-- Add OTE columns to commission_goals
ALTER TABLE public.commission_goals
ADD COLUMN IF NOT EXISTS ote_value numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS min_threshold_percent numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS calculation_mode text NOT NULL DEFAULT 'proportional',
ADD COLUMN IF NOT EXISTS accelerator_multiplier numeric DEFAULT 1.5,
ADD COLUMN IF NOT EXISTS cap_percent numeric DEFAULT 150;
