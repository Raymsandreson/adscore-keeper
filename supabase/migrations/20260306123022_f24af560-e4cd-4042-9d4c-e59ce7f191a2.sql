
-- Add OAB fields to profiles for internal lawyer identification
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS oab_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS oab_uf TEXT;

-- Add relationship_date to contacts (date they assumed the relationship role)
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS relationship_date TIMESTAMPTZ;

-- Add description column to contact_classifications
ALTER TABLE public.contact_classifications ADD COLUMN IF NOT EXISTS description TEXT;

-- Update existing classifications with new names/descriptions
UPDATE public.contact_classifications SET description = 'Já contratou nossos serviços' WHERE name = 'client';
UPDATE public.contact_classifications SET description = 'Não encaixa no nosso perfil' WHERE name = 'non_client';
UPDATE public.contact_classifications SET description = 'Lead qualificado' WHERE name = 'prospect';
UPDATE public.contact_classifications SET description = 'Relação estruturada, recorrente ou comercial' WHERE name = 'partner';
UPDATE public.contact_classifications SET description = 'Fornecedor de serviços' WHERE name = 'supplier';

-- Insert new classification types if they don't exist
INSERT INTO public.contact_classifications (name, color, display_order, is_system, show_in_workflow, description)
VALUES
  ('lead', 'bg-sky-500', 2, true, true, 'Oportunidade de caso'),
  ('ponte', 'bg-amber-500', 5, true, true, 'Pessoa que ajuda a chegar no prospect'),
  ('nao_aderente', 'bg-slate-500', 7, true, true, 'Não encaixa no nosso perfil'),
  ('ex_cliente', 'bg-rose-500', 8, true, true, 'Já foi cliente'),
  ('advogado_interno', 'bg-emerald-500', 9, true, true, 'Advogado do escritório'),
  ('advogado_externo', 'bg-teal-500', 10, true, true, 'Advogado externo parceiro'),
  ('advogado_adverso', 'bg-red-500', 11, true, true, 'Advogado da parte contrária'),
  ('parte_contraria', 'bg-orange-500', 12, true, true, 'Parte contrária no processo'),
  ('prestador_servico', 'bg-cyan-500', 13, true, true, 'Prestador de serviço')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;
