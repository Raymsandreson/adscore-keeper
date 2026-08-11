-- Vínculos de trabalho entre contatos e empresas.
--
-- Motivação: em caso de acidente dentro de uma empresa, precisamos saber quem
-- já conhecemos lá dentro — quem foi/é empregado, quem é RH/preposto, quem pode
-- testemunhar e quem pode falar da gente (ponte). Hoje só existiam tipos de
-- vínculo familiares/comerciais.
--
-- A empresa entra como um contato normal (full_name = razão social/nome fantasia)
-- e o vínculo aponta pessoa -> empresa.

INSERT INTO public.contact_relationship_types (name, icon, is_system, display_order) VALUES
  ('Empregado de',       'briefcase', true, 20),
  ('Ex-empregado de',    'briefcase', true, 21),
  ('Terceirizado em',    'briefcase', true, 22),
  ('Chefe/Supervisor de','briefcase', true, 23),
  ('RH/Preposto de',     'building',  true, 24),
  ('Sindicato/CIPA de',  'users',     true, 25),
  ('Testemunha de',      'gavel',     true, 26),
  ('Ponte na empresa',   'handshake', true, 27)
ON CONFLICT (name) DO NOTHING;

-- Consulta por empresa ("quem eu conheço dentro da X?") passa por relationship_type;
-- os índices existentes cobrem contact_id/related_contact_id, falta o tipo.
CREATE INDEX IF NOT EXISTS idx_contact_relationships_type
  ON public.contact_relationships (relationship_type);
