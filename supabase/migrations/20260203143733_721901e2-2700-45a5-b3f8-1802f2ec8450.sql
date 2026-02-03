-- Drop the old constraint and add the new one with more comment types
ALTER TABLE public.instagram_comments DROP CONSTRAINT instagram_comments_comment_type_check;

ALTER TABLE public.instagram_comments ADD CONSTRAINT instagram_comments_comment_type_check 
CHECK (comment_type = ANY (ARRAY['received'::text, 'sent'::text, 'outbound_manual'::text, 'outbound_n8n'::text]));