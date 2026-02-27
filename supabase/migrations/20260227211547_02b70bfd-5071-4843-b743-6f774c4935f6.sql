
-- Broadcast lists
CREATE TABLE public.whatsapp_broadcast_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  filter_criteria JSONB,
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Broadcast list contacts (many-to-many)
CREATE TABLE public.whatsapp_broadcast_list_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  list_id UUID NOT NULL REFERENCES public.whatsapp_broadcast_lists(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  contact_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campaigns
CREATE TABLE public.whatsapp_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  message_template TEXT NOT NULL,
  media_url TEXT,
  media_type TEXT,
  broadcast_list_id UUID REFERENCES public.whatsapp_broadcast_lists(id) ON DELETE SET NULL,
  instance_id UUID,
  interval_seconds INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'draft',
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campaign message log
CREATE TABLE public.whatsapp_campaign_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.whatsapp_campaigns(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  contact_name TEXT,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.whatsapp_broadcast_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_broadcast_list_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_campaign_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage broadcast lists" ON public.whatsapp_broadcast_lists FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can manage broadcast list contacts" ON public.whatsapp_broadcast_list_contacts FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can manage campaigns" ON public.whatsapp_campaigns FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can manage campaign messages" ON public.whatsapp_campaign_messages FOR ALL USING (auth.uid() IS NOT NULL);

-- Realtime for campaign progress
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_campaigns;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_campaign_messages;

-- Indexes
CREATE INDEX idx_broadcast_list_contacts_list ON public.whatsapp_broadcast_list_contacts(list_id);
CREATE INDEX idx_campaign_messages_campaign ON public.whatsapp_campaign_messages(campaign_id);
CREATE INDEX idx_campaign_messages_status ON public.whatsapp_campaign_messages(status);
