-- Create contacts table for managing people/contacts separately from leads
CREATE TABLE public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  instagram_username TEXT,
  instagram_url TEXT,
  classification TEXT DEFAULT 'prospect', -- 'client', 'non_client', 'prospect', 'partner', 'supplier'
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  city TEXT,
  state TEXT,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  converted_to_lead_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (matching leads table pattern)
CREATE POLICY "Anyone can read contacts" 
ON public.contacts 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert contacts" 
ON public.contacts 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update contacts" 
ON public.contacts 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete contacts" 
ON public.contacts 
FOR DELETE 
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_contacts_updated_at
BEFORE UPDATE ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();