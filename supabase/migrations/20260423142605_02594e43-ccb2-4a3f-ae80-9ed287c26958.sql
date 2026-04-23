ALTER TABLE public.board_group_settings
  ADD COLUMN IF NOT EXISTS post_sign_mode text NOT NULL DEFAULT 'group',
  ADD COLUMN IF NOT EXISTS auto_archive_on_sign boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processual_acolhedor_id uuid;

ALTER TABLE public.board_group_settings
  DROP CONSTRAINT IF EXISTS board_group_settings_post_sign_mode_check;

ALTER TABLE public.board_group_settings
  ADD CONSTRAINT board_group_settings_post_sign_mode_check
  CHECK (post_sign_mode IN ('group', 'private'));

COMMENT ON COLUMN public.board_group_settings.post_sign_mode IS 'group = criar grupo WhatsApp ao assinar; private = continuar atendimento no chat privado';
COMMENT ON COLUMN public.board_group_settings.auto_archive_on_sign IS 'Arquivar conversa do lead ao assinar documento (inbox + WhatsApp via UazAPI)';
COMMENT ON COLUMN public.board_group_settings.processual_acolhedor_id IS 'Usuário da equipe processual que assume o lead após assinatura (modo privado)';