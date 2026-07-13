-- Contatos de Varas/Tribunais (telefone, WhatsApp, e-mail) — diretório fixo acessível
-- na página de Atividades, para a equipe não caçar contato toda vez que precisa
-- cobrar andamento processual. Base futura para automação de cobrança (e-mail/WhatsApp).
-- Tabela vive no Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- Rollback: DROP TABLE IF EXISTS public.court_contacts;

CREATE TABLE IF NOT EXISTS public.court_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,          -- ex: "2ª Vara do Trabalho de Fortaleza"
  court_type      text,                   -- vara | tribunal | secretaria | outro
  comarca         text,                   -- cidade/comarca/UF
  phone           text,
  whatsapp        text,
  email           text,
  notes           text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz             -- soft delete, padrão do app
);

ALTER TABLE public.court_contacts ENABLE ROW LEVEL SECURITY;

-- Diretório interno da equipe: qualquer usuário autenticado lê e mantém.
DROP POLICY IF EXISTS court_contacts_select_authenticated ON public.court_contacts;
CREATE POLICY court_contacts_select_authenticated
  ON public.court_contacts FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS court_contacts_insert_authenticated ON public.court_contacts;
CREATE POLICY court_contacts_insert_authenticated
  ON public.court_contacts FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS court_contacts_update_authenticated ON public.court_contacts;
CREATE POLICY court_contacts_update_authenticated
  ON public.court_contacts FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
