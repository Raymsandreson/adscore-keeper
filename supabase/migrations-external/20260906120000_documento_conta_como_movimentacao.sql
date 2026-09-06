-- =============================================================================
-- A peça do processo passa a contar como movimentação.
--
-- POR QUE
-- A consulta ao Escavador (modo PUBLICOS) traz PEÇAS, não movimentações: dos
-- 191 processos consultados em 06/09, 182 trouxeram documento e ZERO
-- trouxeram linha em `process_updates`. Como o gatilho de 05/09 só escutava
-- `process_updates` e `jm_decisoes`, esses processos continuavam com
-- `data_ultima_movimentacao` nula — e o assessor seguia dizendo "não teve
-- movimentação registrada" para casos onde a gente acabara de pagar para
-- descobrir que teve.
--
-- A DATA É CONFIÁVEL? MEDIDO ANTES DE MEXER, EM 06/09/2026
-- `jm_documentos`: 9.523 linhas, ZERO sem data, ZERO no futuro, ZERO antes de
-- 2000. Faixa de 10/12/2013 a 04/09/2026.
--
-- E o teste que decidiu — nos 359 processos que têm peça E movimentação:
--     22  datas idênticas
--    113  dentro de ±7 dias
--    240  peça MAIS VELHA que a movimentação (média −55 dias)
--      3  peça mais nova por mais de 7 dias (máximo +54)
--
-- Se `data_documento` fosse a data em que o robô capturou a peça, todas
-- estariam amontoadas em "baixado agora". Estão espalhadas no passado, quase
-- sempre atrás da movimentação. É a data do ATO. Pode ir para o cliente.
--
-- E o efeito colateral é bom: como a peça costuma ser mais velha, o
-- `greatest()` raramente sobrepõe uma data boa — ele preenche buraco, que é
-- exatamente o que se quer.
--
-- IMPACTO MEDIDO: 920 processos alcançados
--    399 ganham data do ZERO
--    104 têm a data avançada
--    417 não mudam (a peça é mais velha do que já se sabia)
--
-- DUAS VERDADES NÃO, UMA SÓ
-- A definição de "última movimentação" muda nos DOIS lugares que a calculam:
-- o gatilho (que escreve a coluna) e `dom_contexto_processual` (que monta o
-- prompt). Deixar só um saber de documentos criaria a mesma doença desta
-- sessão — duas regras discordando sobre o mesmo fato, e alguém desempatando
-- sozinho.
--
-- ROLLBACK:
--   drop trigger if exists trg_doc_avanca_ult_mov on public.jm_documentos;
--   update public.lead_processes lp set data_ultima_movimentacao = b.valor_antigo
--     from public.lead_processes_ult_mov_doc_backup_20260906 b where b.process_id = lp.id;
--   (e reaplicar 20260905203000 para a versão anterior de dom_contexto_processual)
-- =============================================================================

-- 1. O gatilho passa a entender três origens ---------------------------------
create or replace function public.lead_processes_avanca_ultima_movimentacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_data date;
  v_cnj  text;
  v_pid  uuid;
begin
  if tg_table_name = 'process_updates' then
    -- Data presumida é chute do parser quando o e-mail não trazia data.
    -- Chute não define "última movimentação".
    if coalesce(new.data_presumida, false) then
      return new;
    end if;
    v_data := new.data_movimentacao;
    v_cnj  := nullif(dom_so_digitos(new.numero_cnj), '');
    v_pid  := new.process_id;

  elsif tg_table_name = 'jm_documentos' then
    -- Peça oculta foi tirada de vista por alguém; não fala pelo processo.
    if new.oculta_em is not null then
      return new;
    end if;
    v_data := new.data_documento;
    v_cnj  := nullif(dom_so_digitos(new.processo_cnj), '');
    v_pid  := null;

  else  -- jm_decisoes
    v_data := new.data_decisao;
    v_cnj  := nullif(dom_so_digitos(new.processo_cnj), '');
    v_pid  := null;
  end if;

  if v_data is null or v_data > current_date then
    return new;
  end if;

  update public.lead_processes lp
     set data_ultima_movimentacao = to_char(v_data, 'YYYY-MM-DD')
   where lp.deleted_at is null
     and (
       (v_cnj is not null and dom_so_digitos(lp.process_number) = v_cnj)
       or (v_pid is not null and lp.id = v_pid)
     )
     and coalesce(public.data_iso_ou_nulo(lp.data_ultima_movimentacao), '-infinity'::date) < v_data;

  return new;
end $function$;

drop trigger if exists trg_doc_avanca_ult_mov on public.jm_documentos;
create trigger trg_doc_avanca_ult_mov
  after insert on public.jm_documentos
  for each row
  execute function public.lead_processes_avanca_ultima_movimentacao();

-- 2. Backfill do que já está na base -----------------------------------------
create table if not exists public.lead_processes_ult_mov_doc_backup_20260906 (
  process_id   uuid primary key,
  valor_antigo text,
  valor_novo   text,
  feito_em     timestamptz not null default now()
);

comment on table public.lead_processes_ult_mov_doc_backup_20260906 is
  'Foto de data_ultima_movimentacao antes do backfill por data_documento, em 06/09/2026.';

with doc as (
  select dom_so_digitos(processo_cnj) as cnj, max(data_documento) as doc_max
    from public.jm_documentos
   where oculta_em is null and data_documento <= current_date
   group by 1
)
insert into public.lead_processes_ult_mov_doc_backup_20260906 (process_id, valor_antigo, valor_novo)
select lp.id,
       lp.data_ultima_movimentacao,
       to_char(doc.doc_max, 'YYYY-MM-DD')
  from public.lead_processes lp
  join doc on doc.cnj = dom_so_digitos(lp.process_number)
 where lp.deleted_at is null
   and lp.process_number is not null
   and coalesce(public.data_iso_ou_nulo(lp.data_ultima_movimentacao), '-infinity'::date) < doc.doc_max
on conflict (process_id) do nothing;

update public.lead_processes lp
   set data_ultima_movimentacao = b.valor_novo
  from public.lead_processes_ult_mov_doc_backup_20260906 b
 where b.process_id = lp.id
   and lp.data_ultima_movimentacao is distinct from b.valor_novo;
