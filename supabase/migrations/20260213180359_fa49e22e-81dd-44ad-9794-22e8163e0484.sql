
ALTER TABLE public.activity_chat_messages 
ADD COLUMN deleted_at timestamp with time zone DEFAULT NULL,
ADD COLUMN deleted_by_name text DEFAULT NULL;
