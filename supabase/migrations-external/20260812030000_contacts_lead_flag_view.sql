-- `contacts` + a coluna `has_lead`, para o filtro "Com Lead / Sem Lead" da tela
-- de Contatos parar de mentir.
--
-- Como era: o cliente baixava `contact_leads.contact_id` e devolvia a lista num
-- `.in('id', ...)`. O PostgREST corta a resposta em 1000 linhas e a tabela tem
-- 9.629 — a partir dali, contato com lead aparecia em "Sem Lead". Mandar os
-- 9.101 ids de volta também não resolveria: a URL não comporta.
--
-- `has_lead` olha as DUAS fontes (8.273 contatos existem só em `contact_leads`
-- e 936 só em `contacts.lead_id`), a mesma definição da RPC
-- `contacts_creation_series` — assim o gráfico e a lista batem quando se clica
-- numa barra.
--
-- `security_invoker = true`: a view herda as policies de RLS de `contacts`
-- (PG 17 aqui, então há suporte). Sem isso a view rodaria como dona e furaria
-- o RLS da tabela.
--
-- Rollback:
--   DROP VIEW public.contacts_lead_flag;
--   (e reverter useContacts.ts para o pré-filtro por `.in('id', ...)`)

CREATE OR REPLACE VIEW public.contacts_lead_flag
WITH (security_invoker = true) AS
SELECT
  c.*,
  (c.lead_id IS NOT NULL OR EXISTS (
     SELECT 1 FROM public.contact_leads cl WHERE cl.contact_id = c.id
   )) AS has_lead
FROM public.contacts c;

GRANT SELECT ON public.contacts_lead_flag TO anon, authenticated;
