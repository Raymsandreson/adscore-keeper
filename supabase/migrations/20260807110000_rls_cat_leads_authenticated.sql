-- =============================================================================
-- Fecha o acesso ANONIMO PURO a cat_leads e cat_lead_contacts.
--
-- Mesmo defeito de 20260806200000 (leads/contacts) e 20260806210000
-- (lead_processes/processual_emails): RLS habilitado, mas as 8 policies foram
-- criadas com TO public — e public inclui anon. Medido em 07/08/2026:
--
--   cat_leads          278 linhas, RLS on, 4 policies {public} USING (true)
--                      SELECT + INSERT + UPDATE + DELETE abertos
--   cat_lead_contacts   13 linhas, idem
--   grants: anon, authenticated
--
-- O dado exposto e pessoal e sensivel sob LGPD: das 278 linhas, 278 tem cpf,
-- 278 tem nome_completo, 272 tem celular_1, alem de endereco, bairro, cep e
-- municipio de pessoa acidentada. Nao era so leitura — DELETE tambem estava
-- aberto, entao a chave publica do bundle apagava a base inteira.
--
-- Por que "authenticated" resolve por fora: o front faz signInAnonymously()
-- em external-client.ts:31, e usuario anonimo do Supabase tem role
-- authenticated. Consumidores server-side usam SERVICE_ROLE, que ignora RLS.
--
-- LIMITE, o mesmo ja registrado em 20260806200000: a sessao anonima sai de UMA
-- requisicao com a chave publica (POST /auth/v1/signup com body vazio). Isto
-- fecha contra quem so tem a chave, nao contra quem faz o sign-in. Fechar de
-- verdade exige auth.jwt()->>'is_anonymous' = 'false' tabela a tabela — frente
-- aberta, ver memoria supabase-externo-rls-gap.
--
-- ROLLBACK: trocar authenticated de volta por public nas 8 linhas.
-- =============================================================================

alter policy "Anyone can read cat_leads"   on public.cat_leads to authenticated;
alter policy "Anyone can insert cat_leads" on public.cat_leads to authenticated;
alter policy "Anyone can update cat_leads" on public.cat_leads to authenticated;
alter policy "Anyone can delete cat_leads" on public.cat_leads to authenticated;

alter policy "Anyone can read cat_lead_contacts"   on public.cat_lead_contacts to authenticated;
alter policy "Anyone can insert cat_lead_contacts" on public.cat_lead_contacts to authenticated;
alter policy "Anyone can update cat_lead_contacts" on public.cat_lead_contacts to authenticated;
alter policy "Anyone can delete cat_lead_contacts" on public.cat_lead_contacts to authenticated;
