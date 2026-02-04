-- Add 'outbound_export' to comment_type constraint
ALTER TABLE instagram_comments DROP CONSTRAINT IF EXISTS instagram_comments_comment_type_check;
ALTER TABLE instagram_comments ADD CONSTRAINT instagram_comments_comment_type_check 
CHECK (comment_type IN ('received', 'sent', 'outbound_manual', 'outbound_n8n', 'outbound_export', 'reply_to_outbound'));