-- =============================================================================
-- CASO 398 (Charles x Porto Rico): o processo estava na ficha de OUTRA pessoa.
--
-- NÃO É MIGRATION DE ESTRUTURA. É conserto de DADO, de um caso só, com aval
-- explícito do Raym (08/09/2026). Modo Leopardo: aditivo, com backup e volta.
--
-- O QUE FOI VISTO (08/09/2026)
-- O grupo 120363410348021695 está ligado pela ponte à ficha
--   A = 9d81291f  "✅ CASO 398 | Charles x Porto Rico | 14/05/2023"
--       criada 22/07 à mão, nome = nome do grupo, sem CPF, sem telefone,
--       caso CASO-934 com 1 processo (INSS 2002572522), 12 atividades.
-- Os processos judiciais do Charles estavam em
--   B = 7d073d69  "Charles vieira dos santos Junior"
--       importado 30/06 da Planilha BPC, telefone com DDD 79 (Sergipe),
--       board "BPC - Autismo", acolhedor Edilan, caso "CASO 398" com 4
--       processos, 21 atividades, 30 movimentações, 6 marcos, 1 audiência.
--
-- A PRIMEIRA HIPÓTESE (fundir A em B) ESTAVA ERRADA. Conferindo identidade:
--   * quem escreve no grupo como "Charles": 1.104 mensagens, telefone com
--     DDD 86 (Piauí) = contato 3ed59bc8 "Charles", ligado à ficha A.
--   * o telefone da ficha B (DDD 79) NUNCA escreveu no grupo.
--   * autor dos processos no Escavador: "Charles Mendes da Silva" = contato
--     8605eb76, criado automaticamente em 31/08 e pendurado em B.
--   * o caso CASO 398 foi criado em 22/06 — B só existe desde 30/06. Alguém
--     apontou o caso para B depois, provavelmente buscando "Charles".
-- Conclusão: A é o cliente do grupo com o nome errado. B é OUTRA pessoa
-- (lead de BPC, Sergipe) que recebeu por engano o caso trabalhista de A.
-- Fundir A em B enterraria o cliente do grupo na ficha de um estranho.
--
-- Telefone e CPF do cliente não estão escritos aqui: vêm dos contatos
-- (3ed59bc8 e 8605eb76) na hora de rodar. Dado pessoal não entra no repo.
--
-- O QUE MUDA (tudo dentro de UMA transação, com contagem travada)
--   1. legal_cases CASO 398 (734683f8)        lead B → A ............... 1 linha
--   2. lead_processes do CASO 398             lead B → A ............... 4 linhas
--   3. lead_processes INSS 2002572522         caso CASO-934 → CASO 398 . 1 linha
--   4. lead_activities de B (todas do CASO 398)  lead B → A ............ 21 linhas
--   5. lead_activities de A no CASO-934       caso → CASO 398 .......... 10 linhas
--   6. lead_activities sem lead nos processos do caso  lead → A ........ 1 linha
--   7. process_updates do CASO 398            lead B → A ............... 30 linhas
--   8. process_movements do CASO 398          lead B → A ............... 6 linhas
--   9. hearings de B                          lead B → A ............... 1 linha
--  10. contact_leads de B (Charles Mendes, M. de Sousa)  lead B → A .... 2 linhas
--  11. leads A: nome "Charles Mendes da Silva", telefone e CPF vindos
--      dos contatos ................................................... 1 linha
--  12. legal_cases CASO-934 (e9541f6b): deleted_at = now() ............ 1 linha
--                                                                    ── 79 linhas
--
-- O QUE NÃO MUDA (de propósito)
--   * A ponte, dom_grupos_piloto e grupo_processo_detectado já apontam para A.
--   * lead_activity_audit_log: é histórico, não se reescreve.
--   * lead_checklist_instances (A 95, B 65): geradas por etapa de board;
--     mover duplicaria checklist. Ficam onde estão.
--   * Ficha B continua viva: volta a ser só o lead de BPC da planilha, com
--     0 processos e 0 atividades. Nada dela é apagado.
--   * Contatos "Charles" (telefone) e "Charles Mendes da Silva" (CPF) são a
--     mesma pessoa e ficam os dois em A. Fundir contato é outra esteira.
--   * A coluna "Processo —" na lista de grupos CONTINUA vazia depois disto:
--     é o `@g.us` da view (ponte sem sufixo, índice com). Conserto separado.
--
-- ROTA DE FUGA: tabela zz_caso398_bkp_20260908 guarda toda linha tocada
-- (antes). O bloco de rollback está no fim, comentado. Desfaz em < 1 min.
-- =============================================================================

begin;

-- ── 0. Backup do que vai mudar ───────────────────────────────────────────────
create table if not exists public.zz_caso398_bkp_20260908 (
  tabela text not null, pk text not null, linha jsonb not null,
  gravado_em timestamptz not null default now()
);

insert into zz_caso398_bkp_20260908 (tabela, pk, linha)
select 'legal_cases', id::text, to_jsonb(t) from legal_cases t
 where id in ('734683f8-124a-4651-9bdc-f6057b7eb62d','e9541f6b-60ec-49a9-b779-81b12ce974c3')
union all
select 'lead_processes', id::text, to_jsonb(t) from lead_processes t
 where case_id in ('734683f8-124a-4651-9bdc-f6057b7eb62d','e9541f6b-60ec-49a9-b779-81b12ce974c3')
union all
select 'lead_activities', id::text, to_jsonb(t) from lead_activities t
 where lead_id in ('7d073d69-d2a3-4f8d-a382-fd2b300f8943','9d81291f-5e01-4d34-8ea4-e7b282591da6')
    or process_id in (select id from lead_processes where case_id = '734683f8-124a-4651-9bdc-f6057b7eb62d')
union all
select 'process_updates', id::text, to_jsonb(t) from process_updates t where case_id = '734683f8-124a-4651-9bdc-f6057b7eb62d'
union all
select 'process_movements', id::text, to_jsonb(t) from process_movements t where case_id = '734683f8-124a-4651-9bdc-f6057b7eb62d'
union all
select 'hearings', id::text, to_jsonb(t) from hearings t where lead_id = '7d073d69-d2a3-4f8d-a382-fd2b300f8943'
union all
select 'contact_leads', id::text, to_jsonb(t) from contact_leads t where lead_id = '7d073d69-d2a3-4f8d-a382-fd2b300f8943'
union all
select 'leads', id::text, to_jsonb(t) from leads t where id = '9d81291f-5e01-4d34-8ea4-e7b282591da6';

-- ── 1..12. As mudanças, cada uma com a contagem travada ──────────────────────
do $fix$
declare
  A constant uuid := '9d81291f-5e01-4d34-8ea4-e7b282591da6';  -- cliente do grupo
  B constant uuid := '7d073d69-d2a3-4f8d-a382-fd2b300f8943';  -- outra pessoa (BPC)
  CASO_398 constant uuid := '734683f8-124a-4651-9bdc-f6057b7eb62d';
  CASO_934 constant uuid := 'e9541f6b-60ec-49a9-b779-81b12ce974c3';
  n int;
begin
  update legal_cases set lead_id = A where id = CASO_398 and lead_id = B;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'passo 1: esperava 1, afetou % — nada gravado', n; end if;

  update lead_processes set lead_id = A where case_id = CASO_398 and lead_id = B and deleted_at is null;
  get diagnostics n = row_count;
  if n <> 4 then raise exception 'passo 2: esperava 4, afetou % — nada gravado', n; end if;

  update lead_processes set case_id = CASO_398 where id = '0f6cd950-f420-4b2e-9299-cb85cf241c40' and case_id = CASO_934;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'passo 3: esperava 1, afetou % — nada gravado', n; end if;

  update lead_activities set lead_id = A where lead_id = B and case_id = CASO_398 and deleted_at is null;
  get diagnostics n = row_count;
  if n <> 21 then raise exception 'passo 4: esperava 21, afetou % — nada gravado', n; end if;

  update lead_activities set case_id = CASO_398 where lead_id = A and case_id = CASO_934 and deleted_at is null;
  get diagnostics n = row_count;
  if n <> 10 then raise exception 'passo 5: esperava 10, afetou % — nada gravado', n; end if;

  update lead_activities set lead_id = A, case_id = coalesce(case_id, CASO_398)
   where lead_id is null and deleted_at is null
     and process_id in (select id from lead_processes where case_id = CASO_398);
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'passo 6: esperava 1, afetou % — nada gravado', n; end if;

  update process_updates set lead_id = A where case_id = CASO_398 and lead_id = B;
  get diagnostics n = row_count;
  if n <> 30 then raise exception 'passo 7: esperava 30, afetou % — nada gravado', n; end if;

  update process_movements set lead_id = A where case_id = CASO_398 and lead_id = B;
  get diagnostics n = row_count;
  if n <> 6 then raise exception 'passo 8: esperava 6, afetou % — nada gravado', n; end if;

  update hearings set lead_id = A where lead_id = B and deleted_at is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'passo 9: esperava 1, afetou % — nada gravado', n; end if;

  update contact_leads set lead_id = A where lead_id = B;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'passo 10: esperava 2, afetou % — nada gravado', n; end if;

  update leads set
    lead_name  = 'Charles Mendes da Silva',
    lead_phone = coalesce(lead_phone, (select phone from contacts where id = '3ed59bc8-97b6-4a0e-9ebb-40d7e2941f58')),
    cpf        = coalesce(cpf,        (select cpf   from contacts where id = '8605eb76-e9b3-4746-9222-05ae05d93721'))
   where id = A and lead_name like '%CASO 398%';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'passo 11: esperava 1, afetou % — nada gravado', n; end if;

  update legal_cases set deleted_at = now() where id = CASO_934 and deleted_at is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'passo 12: esperava 1, afetou % — nada gravado', n; end if;
end $fix$;

commit;

-- ── ROLLBACK (rodar inteiro se precisar desfazer) ────────────────────────────
-- begin;
-- update legal_cases     set lead_id = '7d073d69-d2a3-4f8d-a382-fd2b300f8943' where id = '734683f8-124a-4651-9bdc-f6057b7eb62d';
-- update legal_cases     set deleted_at = null where id = 'e9541f6b-60ec-49a9-b779-81b12ce974c3';
-- update lead_processes  set lead_id = '7d073d69-d2a3-4f8d-a382-fd2b300f8943' where case_id = '734683f8-124a-4651-9bdc-f6057b7eb62d' and id <> '0f6cd950-f420-4b2e-9299-cb85cf241c40';
-- update lead_processes  set case_id = 'e9541f6b-60ec-49a9-b779-81b12ce974c3' where id = '0f6cd950-f420-4b2e-9299-cb85cf241c40';
-- update lead_activities a set lead_id = (b.linha->>'lead_id')::uuid, case_id = (b.linha->>'case_id')::uuid
--   from zz_caso398_bkp_20260908 b where b.tabela = 'lead_activities' and b.pk = a.id::text;
-- update process_updates   set lead_id = '7d073d69-d2a3-4f8d-a382-fd2b300f8943' where case_id = '734683f8-124a-4651-9bdc-f6057b7eb62d';
-- update process_movements set lead_id = '7d073d69-d2a3-4f8d-a382-fd2b300f8943' where case_id = '734683f8-124a-4651-9bdc-f6057b7eb62d';
-- update hearings          set lead_id = '7d073d69-d2a3-4f8d-a382-fd2b300f8943' where id = 'd977bed4-4477-4bd5-8288-5ad3f1dad59b';
-- update contact_leads     set lead_id = '7d073d69-d2a3-4f8d-a382-fd2b300f8943' where lead_id = '9d81291f-5e01-4d34-8ea4-e7b282591da6' and contact_id in ('8605eb76-e9b3-4746-9222-05ae05d93721','87c7aa01-2e11-45e1-8203-a17a12235749');
-- update leads l set lead_name = b.linha->>'lead_name', lead_phone = b.linha->>'lead_phone', cpf = b.linha->>'cpf'
--   from zz_caso398_bkp_20260908 b where b.tabela = 'leads' and b.pk = l.id::text;
-- commit;
