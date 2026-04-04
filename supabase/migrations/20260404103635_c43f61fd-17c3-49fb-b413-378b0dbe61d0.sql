
ALTER TABLE public.wjia_command_shortcuts 
ADD COLUMN IF NOT EXISTS zapsign_settings JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.wjia_command_shortcuts.zapsign_settings IS 'Advanced ZapSign document creation settings: brand_logo, brand_primary_color, brand_name, require_cpf, validate_cpf, lock_name, lock_phone, require_selfie_photo, require_document_photo, folder_path, date_limit_days, redirect_link, observers[]';
