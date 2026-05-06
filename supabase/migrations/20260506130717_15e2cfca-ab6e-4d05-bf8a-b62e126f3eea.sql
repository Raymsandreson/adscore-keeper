ALTER TABLE public.onboarding_meeting_configs
  ADD COLUMN IF NOT EXISTS auto_schedule_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_schedule_message_template TEXT DEFAULT '✅ *Reunião de Onboarding agendada!*

Olá {{contact_name}}, sua reunião de boas-vindas foi agendada automaticamente:

📅 {{meeting_date}}
🕐 {{meeting_time}}
⏱ Duração: {{duration}} minutos
📹 Via chamada de vídeo no WhatsApp

Caso precise reagendar, é só nos avisar por aqui.';