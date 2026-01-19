-- Create table to store custom field definitions
CREATE TABLE public.lead_custom_fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_account_id TEXT,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text', -- text, number, date, select, checkbox
  field_options TEXT[] DEFAULT '{}', -- for select type fields
  is_required BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table to store custom field values for each lead
CREATE TABLE public.lead_custom_field_values (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.lead_custom_fields(id) ON DELETE CASCADE,
  value_text TEXT,
  value_number NUMERIC,
  value_date DATE,
  value_boolean BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(lead_id, field_id)
);

-- Enable RLS
ALTER TABLE public.lead_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_custom_field_values ENABLE ROW LEVEL SECURITY;

-- RLS policies for lead_custom_fields
CREATE POLICY "Anyone can read lead_custom_fields" 
ON public.lead_custom_fields FOR SELECT USING (true);

CREATE POLICY "Anyone can insert lead_custom_fields" 
ON public.lead_custom_fields FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update lead_custom_fields" 
ON public.lead_custom_fields FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete lead_custom_fields" 
ON public.lead_custom_fields FOR DELETE USING (true);

-- RLS policies for lead_custom_field_values
CREATE POLICY "Anyone can read lead_custom_field_values" 
ON public.lead_custom_field_values FOR SELECT USING (true);

CREATE POLICY "Anyone can insert lead_custom_field_values" 
ON public.lead_custom_field_values FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update lead_custom_field_values" 
ON public.lead_custom_field_values FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete lead_custom_field_values" 
ON public.lead_custom_field_values FOR DELETE USING (true);