-- =============================================================================
-- Fecha as 14 tabelas de backup que ficaram com RLS DESLIGADO e grant para anon.
--
-- Diferente de 20260806200000 / 20260806210000 / 20260807110000, onde o defeito
-- era policy "TO public", aqui e pior: RLS simplesmente nunca foi ligado. Sao
-- tabelas criadas por "create table ... as select" no meio de migrations
-- anteriores, e o create table as nao herda RLS nem policy da tabela de origem —
-- copia os dados e mais nada. O dado sai de uma tabela protegida e cai numa
-- aberta, com o mesmo conteudo.
--
-- JA APLICADA no externo em 07/08/2026, registrada em schema_migrations como
-- 20260807150133 — dai o timestamp do arquivo. Conferido em 10/08/2026: 14/14 com
-- RLS on, 0 policies, anon sem SELECT. O arquivo chegou ao repo depois; re-rodar e
-- inofensivo (o DO block e idempotente).
--
-- Medido em 07/08/2026 (Security Advisor: 14x rls_disabled_in_public, ERROR).
-- 48.758 linhas no total, todas com grant a anon e authenticated:
--
--   zz_lci_bkp_20260730                      29.290   checklists juridicos por
--                                                     lead (items jsonb, 37 MB)
--   bkp_acolhedor_padronizacao_20260804       6.553
--   zz_conversations_lead_bkp_20260804        5.770   TELEFONE + instancia
--   zz_ual_retro_bkp_semana_20260731          2.946
--   lead_whatsapp_groups_bkp_20260721         1.870   nome do grupo, que segue
--                                                     "LEAD N - NOME" e portanto
--                                                     carrega nome de cliente
--   _backup_contact_group_marca_20260721      1.236   TELEFONE
--   zz_ual_retro_bkp_20260731                   278
--   zz_contacts_city_bkp                        272
--   zz_ual_repoint_bkp_20260730                 254
--   bkp_padroniza_acolhedor_trab                138
--   zz_lead_group_autolink_bkp_20260731         101   lead_name
--   bkp_reatribuicao_edilan_trab                 35
--   zz_process_movements_redistribuicao_bkp      13   CNJ, valor de indenizacao,
--                                                     descricao da decisao
--   zz_checklist_merge_bkp_20260730               2
--
-- Conferido antes de aplicar: NENHUMA e referenciada em src/, supabase/functions/
-- ou railway-server/ — so aparecem nas migrations que as criaram. Entao ligar RLS
-- sem policy nao quebra consumidor nenhum. Quem precisar restaurar usa
-- service_role, que ignora RLS, ou o SQL editor.
--
-- RLS sem policy ja nega tudo para anon/authenticated; o revoke vai junto para
-- que uma policy permissiva criada por engano no futuro nao reabra sozinha.
-- O advisor passa a marcar rls_enabled_no_policy (INFO) no lugar de
-- rls_disabled_in_public (ERROR) — e o estado desejado para tabela de backup.
--
-- NAO APAGA NADA. Varias ja passaram da validade (julho), mas descartar backup e
-- decisao separada, com confirmacao propria.
--
-- ROLLBACK, por tabela:
--   alter table public.<t> disable row level security;
--   grant select, insert, update, delete on public.<t> to anon, authenticated;
-- =============================================================================

do $$
declare
  t text;
  alvos text[] := array[
    '_backup_contact_group_marca_20260721',
    'bkp_acolhedor_padronizacao_20260804',
    'bkp_padroniza_acolhedor_trab',
    'bkp_reatribuicao_edilan_trab',
    'lead_whatsapp_groups_bkp_20260721',
    'zz_checklist_merge_bkp_20260730',
    'zz_contacts_city_bkp',
    'zz_conversations_lead_bkp_20260804',
    'zz_lci_bkp_20260730',
    'zz_lead_group_autolink_bkp_20260731',
    'zz_process_movements_redistribuicao_bkp',
    'zz_ual_repoint_bkp_20260730',
    'zz_ual_retro_bkp_20260731',
    'zz_ual_retro_bkp_semana_20260731'
  ];
begin
  foreach t in array alvos loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'ignorando %: nao existe mais', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    raise notice 'fechada: %', t;
  end loop;
end $$;
