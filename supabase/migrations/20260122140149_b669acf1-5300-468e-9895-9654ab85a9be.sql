-- Create table for custom contact classifications
CREATE TABLE public.contact_classifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT 'bg-gray-500',
  icon TEXT DEFAULT 'tag',
  display_order INTEGER DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contact_classifications ENABLE ROW LEVEL SECURITY;

-- Allow all users to read classifications
CREATE POLICY "Classifications are viewable by everyone" 
ON public.contact_classifications 
FOR SELECT 
USING (true);

-- Allow all users to insert new classifications
CREATE POLICY "Users can create classifications" 
ON public.contact_classifications 
FOR INSERT 
WITH CHECK (true);

-- Allow updates only for non-system classifications
CREATE POLICY "Users can update non-system classifications" 
ON public.contact_classifications 
FOR UPDATE 
USING (is_system = false);

-- Allow deletes only for non-system classifications
CREATE POLICY "Users can delete non-system classifications" 
ON public.contact_classifications 
FOR DELETE 
USING (is_system = false);

-- Insert default system classifications
INSERT INTO public.contact_classifications (name, color, icon, display_order, is_system) VALUES
  ('client', 'bg-green-500', 'user-check', 1, true),
  ('non_client', 'bg-gray-500', 'users', 2, true),
  ('prospect', 'bg-blue-500', 'user-plus', 3, true),
  ('partner', 'bg-purple-500', 'handshake', 4, true),
  ('supplier', 'bg-orange-500', 'package', 5, true);