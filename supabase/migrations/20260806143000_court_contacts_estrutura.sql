-- Reestruturação dos contatos de varas/tribunais (Supabase EXTERNO kmedldlepwiityjsdahz).
--
-- Problema: `court_type` misturava duas perguntas num campo só — "que nível da
-- estrutura é" (vara/tribunal) e "com quem eu falo" (secretaria/gabinete) — e
-- `comarca` virou campo-lixeira: dos 6 registros existentes, 3 guardavam cidade
-- ("Cuiabá/MT"), 2 guardavam tribunal ("TRT21", "TJPA 2ºGRAU") e 1 só a cidade.
-- Sem separar isso, filtrar por estado ou por ramo é impossível.
--
-- Decisão: atributos estruturados, não hierarquia de pastas. A árvore
-- (ramo → tribunal → comarca) passa a ser uma visualização derivada, o que
-- evita migração quando aparecer JEF, Turma Recursal ou ponto não-judicial
-- (APS/INSS, PGF, CEJUSC, perito) — casos que a árvore não comportaria.
--
-- `court_type` NÃO é removida aqui: fica como legado por 24h (Regra 4), com o
-- app gravando os dois campos. Removível na migration seguinte.
--
-- Índices sem CONCURRENTLY de propósito: a tabela tem 6 linhas.
--
-- ROLLBACK (testado no plano, <1min):
--   ALTER TABLE public.court_contacts
--     DROP COLUMN IF EXISTS branch, DROP COLUMN IF EXISTS degree,
--     DROP COLUMN IF EXISTS court_code, DROP COLUMN IF EXISTS uf,
--     DROP COLUMN IF EXISTS contact_type, DROP COLUMN IF EXISTS unit_name,
--     DROP COLUMN IF EXISTS unit_key, DROP COLUMN IF EXISTS origin_codes,
--     DROP COLUMN IF EXISTS preferred_channel, DROP COLUMN IF EXISTS last_confirmed_at;
--   (os dados antigos de name/court_type/comarca/phone/whatsapp/email seguem intactos)

ALTER TABLE public.court_contacts
  ADD COLUMN IF NOT EXISTS branch            text,        -- ramo da justiça
  ADD COLUMN IF NOT EXISTS degree            text,        -- instância
  ADD COLUMN IF NOT EXISTS court_code        text,        -- TRT22, TJPI, TRF1, INSS...
  ADD COLUMN IF NOT EXISTS uf                char(2),
  ADD COLUMN IF NOT EXISTS contact_type      text,        -- secretaria | gabinete | ...
  ADD COLUMN IF NOT EXISTS unit_name         text,        -- nome canônico da unidade
  ADD COLUMN IF NOT EXISTS unit_key          text,        -- agrupa pontos da mesma unidade
  ADD COLUMN IF NOT EXISTS origin_codes      text[],      -- códigos OOOO do CNJ desta unidade
  ADD COLUMN IF NOT EXISTS preferred_channel text,        -- canal que de fato responde
  ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz; -- última vez que alguém confirmou

COMMENT ON COLUMN public.court_contacts.court_code IS
  'Chave curta do tribunal (TRT22, TJPI, TRF1) ou do órgão não-judicial (INSS, PGF, CEJUSC). Casa com o tribunal decodificado do número CNJ do processo.';
COMMENT ON COLUMN public.court_contacts.unit_key IS
  'court_code + nome da unidade normalizado. Agrupa pontos de contato do mesmo lugar: a secretaria e o gabinete da 6ª Vara Cível de Teresina compartilham a chave.';
COMMENT ON COLUMN public.court_contacts.origin_codes IS
  'Códigos OOOO do CNJ atendidos por esta unidade. O que o código identifica varia por ramo: vara na Justiça do Trabalho, comarca na Estadual, subseção na Federal.';
COMMENT ON COLUMN public.court_contacts.last_confirmed_at IS
  'Gabinete de desembargador é contato volátil (promoção, mudança de câmara, aposentadoria). Sem confirmação há mais de 12 meses, a UI marca o registro como a conferir.';

-- Vocabulário fechado: é o que impede o campo de virar texto livre de novo.
ALTER TABLE public.court_contacts DROP CONSTRAINT IF EXISTS court_contacts_branch_chk;
ALTER TABLE public.court_contacts ADD CONSTRAINT court_contacts_branch_chk
  CHECK (branch IS NULL OR branch IN
    ('trabalhista','federal','estadual','eleitoral','militar','superior','extrajudicial'));

ALTER TABLE public.court_contacts DROP CONSTRAINT IF EXISTS court_contacts_degree_chk;
ALTER TABLE public.court_contacts ADD CONSTRAINT court_contacts_degree_chk
  CHECK (degree IS NULL OR degree IN
    ('primeiro','jef','turma_recursal','segundo','superior','nao_aplica'));

ALTER TABLE public.court_contacts DROP CONSTRAINT IF EXISTS court_contacts_contact_type_chk;
ALTER TABLE public.court_contacts ADD CONSTRAINT court_contacts_contact_type_chk
  CHECK (contact_type IS NULL OR contact_type IN
    ('secretaria','gabinete','central','distribuicao','oficial','pericia','outro'));

ALTER TABLE public.court_contacts DROP CONSTRAINT IF EXISTS court_contacts_channel_chk;
ALTER TABLE public.court_contacts ADD CONSTRAINT court_contacts_channel_chk
  CHECK (preferred_channel IS NULL OR preferred_channel IN ('phone','whatsapp','email'));

CREATE INDEX IF NOT EXISTS idx_court_contacts_court_code
  ON public.court_contacts (court_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_court_contacts_unit_key
  ON public.court_contacts (unit_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_court_contacts_branch_degree
  ON public.court_contacts (branch, degree) WHERE deleted_at IS NULL;

-- ── Backfill dos 6 registros existentes (nenhum se perde, todos ganham campos) ──
-- unit_key segue exatamente a normalização de src/lib/courtCatalog.ts.

UPDATE public.court_contacts SET
  branch = 'trabalhista', degree = 'primeiro', court_code = 'TRT23', uf = 'MT',
  contact_type = 'secretaria', unit_name = '5ª Vara do Trabalho de Cuiabá',
  unit_key = 'TRT23:5-vara-trabalho-cuiaba', comarca = 'Cuiabá'
WHERE id = 'ea896c9e-43e6-484d-bb4e-4567363df0d5';

-- Secretaria e gabinete da mesma vara: mesmo unit_key, pontos de contato distintos.
-- origin_codes 0140 = comarca de Teresina no TJPI (evidência: a 4ª Vara Cível e a
-- Vara de Registros Públicos de Teresina usam esse mesmo código; 27 processos ativos).
UPDATE public.court_contacts SET
  branch = 'estadual', degree = 'primeiro', court_code = 'TJPI', uf = 'PI',
  contact_type = 'secretaria', unit_name = '6ª Vara Cível de Teresina',
  unit_key = 'TJPI:6-vara-civel-teresina', comarca = 'Teresina',
  origin_codes = ARRAY['0140']
WHERE id = 'cfdd1b4d-d02d-41dc-9c7a-a0f7233847ca';

UPDATE public.court_contacts SET
  branch = 'estadual', degree = 'primeiro', court_code = 'TJPI', uf = 'PI',
  contact_type = 'gabinete', unit_name = '6ª Vara Cível de Teresina',
  unit_key = 'TJPI:6-vara-civel-teresina', comarca = 'Teresina',
  origin_codes = ARRAY['0140']
WHERE id = '2a2ce78a-cfc2-4062-837d-de63bba6d080';

UPDATE public.court_contacts SET
  branch = 'estadual', degree = 'segundo', court_code = 'TJPA', uf = 'PA',
  contact_type = 'gabinete', unit_name = 'Gab. Desa. Gleide Pereira de Moura',
  unit_key = 'TJPA:gab-desa-gleide-pereira-moura', comarca = NULL,
  last_confirmed_at = created_at
WHERE id = '64a380a1-8af3-4658-89d6-f8e83a5e836c';

UPDATE public.court_contacts SET
  branch = 'trabalhista', degree = 'segundo', court_code = 'TRT21', uf = 'RN',
  contact_type = 'gabinete', unit_name = 'Gab. Des. Carlos Newton',
  unit_key = 'TRT21:gab-des-carlos-newton', comarca = NULL,
  last_confirmed_at = created_at
WHERE id = 'b964d36d-f3b0-4930-8aa3-f0622aa48a30';

UPDATE public.court_contacts SET
  branch = 'estadual', degree = 'primeiro', court_code = 'TJMA', uf = 'MA',
  contact_type = 'secretaria', unit_name = 'Vara Única de Peritoró',
  unit_key = 'TJMA:vara-unica-peritoro', comarca = 'Peritoró'
WHERE id = 'f82e7008-12b8-4fa9-a96f-3804ec14e604';
