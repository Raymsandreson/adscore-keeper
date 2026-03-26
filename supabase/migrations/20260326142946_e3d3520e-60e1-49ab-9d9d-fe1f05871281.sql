ALTER TABLE public.board_group_settings 
ADD COLUMN initial_message_template text,
ADD COLUMN forward_document_types text[] DEFAULT '{}'::text[],
ADD COLUMN use_ai_message boolean DEFAULT false;