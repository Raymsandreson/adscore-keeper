-- Add deleted_at to leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Add deleted_at to contacts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Add deleted_at to lead_activities
ALTER TABLE public.lead_activities ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Add indexes for performance (filtering out archived records)
CREATE INDEX IF NOT EXISTS idx_leads_deleted_at ON public.leads (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_deleted_at ON public.contacts (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lead_activities_deleted_at ON public.lead_activities (deleted_at) WHERE deleted_at IS NULL;