
-- Create call_records table for managing phone calls
CREATE TABLE public.call_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_id UUID REFERENCES public.lead_activities(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  chat_message_id UUID REFERENCES public.activity_chat_messages(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  
  -- Call details
  call_type TEXT NOT NULL DEFAULT 'outbound', -- inbound, outbound
  call_result TEXT NOT NULL DEFAULT 'answered', -- answered, not_answered, voicemail, busy, wrong_number
  phone_used TEXT,
  duration_seconds INTEGER DEFAULT 0,
  
  -- Audio
  audio_url TEXT,
  audio_file_name TEXT,
  
  -- AI summary
  ai_summary TEXT,
  ai_transcript TEXT,
  
  -- CRM fields
  next_step TEXT,
  callback_date TIMESTAMP WITH TIME ZONE,
  callback_notes TEXT,
  tags TEXT[] DEFAULT '{}',
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  notes TEXT,
  
  -- Metadata
  lead_name TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.call_records ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view call records"
  ON public.call_records FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert call records"
  ON public.call_records FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update call records"
  ON public.call_records FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete call records"
  ON public.call_records FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX idx_call_records_user_id ON public.call_records(user_id);
CREATE INDEX idx_call_records_lead_id ON public.call_records(lead_id);
CREATE INDEX idx_call_records_contact_id ON public.call_records(contact_id);
CREATE INDEX idx_call_records_created_at ON public.call_records(created_at DESC);
CREATE INDEX idx_call_records_callback_date ON public.call_records(callback_date) WHERE callback_date IS NOT NULL;

-- Updated_at trigger
CREATE TRIGGER update_call_records_updated_at
  BEFORE UPDATE ON public.call_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_records;
