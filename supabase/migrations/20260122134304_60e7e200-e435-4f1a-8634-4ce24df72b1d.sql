-- Adicionar campos de endereço na tabela contacts
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS neighborhood TEXT,
ADD COLUMN IF NOT EXISTS street TEXT,
ADD COLUMN IF NOT EXISTS cep TEXT;