-- Meeting configuration per board
CREATE TABLE public.onboarding_meeting_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT false,
  activity_type TEXT NOT NULL DEFAULT 'reuniao',
  host_user_id UUID,
  meeting_duration_minutes INTEGER NOT NULL DEFAULT 30,
  buffer_minutes INTEGER NOT NULL DEFAULT 15,
  available_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',
  start_hour INTEGER NOT NULL DEFAULT 8,
  end_hour INTEGER NOT NULL DEFAULT 18,
  meeting_type TEXT NOT NULL DEFAULT 'video_whatsapp',
  auto_send_after_signature BOOLEAN NOT NULL DEFAULT true,
  message_template TEXT DEFAULT '🤝 *Reunião de Boas-Vindas!*

Parabéns por assinar o documento! Agora vamos agendar sua reunião de onboarding.

👉 Escolha o melhor horário: {{booking_link}}

⏱ Duração: {{duration}} minutos
📹 Via chamada de vídeo no WhatsApp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(board_id)
);

-- Available slots
CREATE TABLE public.onboarding_meeting_slots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES public.onboarding_meeting_configs(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meeting_slots_config ON public.onboarding_meeting_slots(config_id, start_time);
CREATE INDEX idx_meeting_slots_available ON public.onboarding_meeting_slots(is_available, start_time) WHERE is_available = true;

-- Bookings
CREATE TABLE public.onboarding_meeting_bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slot_id UUID REFERENCES public.onboarding_meeting_slots(id) ON DELETE SET NULL,
  config_id UUID NOT NULL REFERENCES public.onboarding_meeting_configs(id) ON DELETE CASCADE,
  lead_id UUID,
  contact_phone TEXT,
  contact_name TEXT,
  booking_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(booking_token)
);

CREATE INDEX idx_meeting_bookings_token ON public.onboarding_meeting_bookings(booking_token);
CREATE INDEX idx_meeting_bookings_config ON public.onboarding_meeting_bookings(config_id, status);

-- RLS
ALTER TABLE public.onboarding_meeting_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_meeting_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_meeting_bookings ENABLE ROW LEVEL SECURITY;

-- Configs: authenticated users manage
CREATE POLICY "Authenticated users can manage meeting configs"
  ON public.onboarding_meeting_configs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Slots: public read (for booking page), authenticated manage
CREATE POLICY "Anyone can view available slots"
  ON public.onboarding_meeting_slots FOR SELECT USING (true);

CREATE POLICY "Authenticated users can manage slots"
  ON public.onboarding_meeting_slots FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Bookings: public insert (via booking link), authenticated read all
CREATE POLICY "Anyone can create a booking"
  ON public.onboarding_meeting_bookings FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can view their booking by token"
  ON public.onboarding_meeting_bookings FOR SELECT USING (true);

CREATE POLICY "Authenticated users can manage bookings"
  ON public.onboarding_meeting_bookings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Updated at triggers
CREATE TRIGGER update_meeting_configs_updated_at
  BEFORE UPDATE ON public.onboarding_meeting_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_meeting_bookings_updated_at
  BEFORE UPDATE ON public.onboarding_meeting_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();