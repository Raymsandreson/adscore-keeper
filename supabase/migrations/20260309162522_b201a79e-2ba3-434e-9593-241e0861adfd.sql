
-- Broadcast lists table
CREATE TABLE public.broadcast_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Broadcast list members (contacts)
CREATE TABLE public.broadcast_list_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  broadcast_list_id UUID NOT NULL REFERENCES public.broadcast_lists(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(broadcast_list_id, contact_id)
);

-- Broadcast send history
CREATE TABLE public.broadcast_sends (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  broadcast_list_id UUID REFERENCES public.broadcast_lists(id) ON DELETE SET NULL,
  message_text TEXT,
  media_url TEXT,
  media_type TEXT,
  instance_name TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.broadcast_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcast_sends ENABLE ROW LEVEL SECURITY;

-- RLS policies - authenticated users can CRUD
CREATE POLICY "Authenticated users can manage broadcast lists" ON public.broadcast_lists FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage broadcast list members" ON public.broadcast_list_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage broadcast sends" ON public.broadcast_sends FOR ALL TO authenticated USING (true) WITH CHECK (true);
