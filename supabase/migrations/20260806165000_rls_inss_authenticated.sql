-- =============================================================================
-- CORREÇÃO DE VAZAMENTO — aplicada em 06/08/2026.
--
-- inss_admin_processes e inss_status_history estavam legíveis E graváveis pela
-- chave anon, que é pública e vai no bundle do front. As policies se chamam
-- "..._all_authenticated" mas foram criadas com TO public — e public inclui
-- anon. Com USING(true), WITH CHECK(true) e cmd ALL, qualquer pessoa com a
-- chave lia os 839 requerimentos (cpf_segurado, nome_segurado, benefit_number)
-- e podia alterar ou apagar.
--
-- Comprovado com curl, só com a anon key:
--   antes:  GET /rest/v1/inss_admin_processes -> HTTP 206, content-range 0-0/839
--   depois: GET /rest/v1/inss_admin_processes -> content-range */0
--   controle: process_movements (policy correta, TO authenticated) -> */0
--
-- Consumidores conferidos, nenhum depende de acesso anônimo:
--   front   — InssAdminProcessesTab, InssEmailSearchTab, inssLeadProcess (logados)
--   railway — gmail-inss-sync, notify-inss-update, inss-matcher,
--             bulk-link-inss-by-cpf (service_role, não passa por RLS)
--
-- LIMITE DESTE FIX: não fecha o problema de fundo. external-client.ts:31 chama
-- signInAnonymously(), e usuário anônimo do Supabase tem role authenticated —
-- então quem tiver a chave ainda pode se autenticar e ler. Fechar isso exige
-- exigir usuário não-anônimo (auth.jwt()->>'is_anonymous' = 'false') tabela a
-- tabela. Frente aberta, ver a medição de 06/08/2026: leads (18.775),
-- contacts (35.226), lead_processes (1.770) e processual_emails (2.719)
-- seguem legíveis pela anon PURA, sem nem precisar do sign-in.
--
-- ROLLBACK: trocar authenticated de volta por public nas duas linhas.
-- EFEITO ESPERADO: com sessão do externo expirada, a aba INSS vem vazia em vez
-- de mostrar dados (mesmo padrão já visto em /casos). É o correto.
-- =============================================================================

alter policy inss_admin_processes_all_authenticated
  on public.inss_admin_processes to authenticated;

alter policy inss_status_history_all_authenticated
  on public.inss_status_history to authenticated;
