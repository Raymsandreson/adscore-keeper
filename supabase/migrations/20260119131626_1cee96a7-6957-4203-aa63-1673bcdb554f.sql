-- Add classification date and location fields to leads table
ALTER TABLE public.leads
ADD COLUMN classification_date date DEFAULT CURRENT_DATE,
ADD COLUMN became_client_date date,
ADD COLUMN city text,
ADD COLUMN state text,
ADD COLUMN neighborhood text;