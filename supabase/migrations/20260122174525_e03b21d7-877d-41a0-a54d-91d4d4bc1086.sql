-- Create table for contact relationships
CREATE TABLE public.contact_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  related_contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Prevent duplicate relationships in same direction
  UNIQUE(contact_id, related_contact_id, relationship_type)
);

-- Create relationship types table for custom types
CREATE TABLE public.contact_relationship_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  icon TEXT DEFAULT 'users',
  is_system BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contact_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_relationship_types ENABLE ROW LEVEL SECURITY;

-- RLS policies for contact_relationships
CREATE POLICY "Anyone can read contact_relationships" ON public.contact_relationships FOR SELECT USING (true);
CREATE POLICY "Anyone can insert contact_relationships" ON public.contact_relationships FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update contact_relationships" ON public.contact_relationships FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete contact_relationships" ON public.contact_relationships FOR DELETE USING (true);

-- RLS policies for contact_relationship_types
CREATE POLICY "Anyone can read relationship_types" ON public.contact_relationship_types FOR SELECT USING (true);
CREATE POLICY "Anyone can insert relationship_types" ON public.contact_relationship_types FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update non-system types" ON public.contact_relationship_types FOR UPDATE USING (is_system = false);
CREATE POLICY "Users can delete non-system types" ON public.contact_relationship_types FOR DELETE USING (is_system = false);

-- Insert default relationship types
INSERT INTO public.contact_relationship_types (name, icon, is_system, display_order) VALUES
  ('Indicação', 'megaphone', true, 1),
  ('Parceiro', 'handshake', true, 2),
  ('Mãe', 'heart', true, 3),
  ('Pai', 'heart', true, 4),
  ('Esposa', 'heart', true, 5),
  ('Marido', 'heart', true, 6),
  ('Filho(a)', 'baby', true, 7),
  ('Irmão(ã)', 'users', true, 8),
  ('Colega de trabalho', 'briefcase', true, 9),
  ('Amigo(a)', 'smile', true, 10),
  ('Cliente indicado', 'user-plus', true, 11);