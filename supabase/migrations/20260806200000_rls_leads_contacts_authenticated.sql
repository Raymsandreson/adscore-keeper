-- =============================================================================
-- Fecha o acesso ANÔNIMO PURO a leads e contacts. Aplicado em 06/08/2026.
--
-- As 8 policies foram criadas com TO public, e public inclui anon. Medido com
-- curl usando só a chave anon do bundle, SEM sign-in:
--   leads    -> 18.775 linhas (105 colunas: cpf, rg, birth_date, lead_phone,
--               lead_email, cep, accident_address, victim_name)
--   contacts -> 35.226 linhas
-- Não era só leitura: DELETE e UPDATE também estavam abertos a anon.
--
-- Conferido antes de aplicar — nenhum consumidor server-side depende de anon:
--   whatsapp-webhook, zapsign-webhook, manychat-webhook,
--   bulk-create-leads-from-campaign, create-whatsapp-group  -> SERVICE_ROLE
--   railway-server                                          -> SERVICE_ROLE
--   front -> external-client.ts:31 faz signInAnonymously(), e usuário anônimo
--            do Supabase tem role authenticated
--
-- VERIFICADO DEPOIS, empiricamente:
--   anon puro                -> leads */0        contacts */0
--   após signInAnonymously   -> leads 18.781     contacts 35.233
-- Ou seja: fechou por fora e o app segue funcionando.
--
-- LIMITE, com prova: a sessão anônima foi obtida em UMA requisição usando só a
-- chave pública (POST /auth/v1/signup com body vazio). Quem tiver a chave ainda
-- lê tudo. Este fix vale contra quem só tem a chave, não contra quem faz o
-- sign-in. Fechar de verdade exige exigir usuário não-anônimo
-- (auth.jwt()->>'is_anonymous' = 'false') tabela a tabela, com mapeamento de
-- tela — frente aberta, ver memória supabase-externo-rls-gap.
--
-- AINDA ABERTAS pelo mesmo defeito (TO public), não incluídas aqui:
--   lead_processes (1.770), processual_emails (2.719)
--
-- ROLLBACK: trocar authenticated de volta por public nas 8 linhas.
-- =============================================================================

alter policy "Anyone can read leads"     on public.leads    to authenticated;
alter policy "Anyone can insert leads"   on public.leads    to authenticated;
alter policy "Anyone can update leads"   on public.leads    to authenticated;
alter policy "Anyone can delete leads"   on public.leads    to authenticated;

alter policy "Anyone can read contacts"   on public.contacts to authenticated;
alter policy "Anyone can insert contacts" on public.contacts to authenticated;
alter policy "Anyone can update contacts" on public.contacts to authenticated;
alter policy "Anyone can delete contacts" on public.contacts to authenticated;
