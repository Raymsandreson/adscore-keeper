-- =============================================================================
-- A régua de marcos deixa de ler o DataJud e passa a ler o feed contínuo
--
-- Decisão do usuário (02/09/2026): "retire o DataJud, ele só atrapalha, é mais
-- informação só fazendo zoada. Agora deixe todos os processos atualizados pelo
-- Escavador."
--
-- Medido antes de aplicar (trabalhista, 1.290 processos): sem o DataJud 73
-- ficariam sem régua e 126 voltariam de marco; 39 avançariam. O usuário aceitou
-- o custo. Para reduzir a perda, junto entra uma fonte que ainda não era lida:
-- o feed `process_updates` (monitoramento do Escavador em 218 processos + push
-- por e-mail do tribunal em 722), que é append-only e não tem o teto de 20
-- movimentações de `lead_processes.movimentacoes`. Medido: 73 processos
-- trabalhistas ganham marco pelo feed, 15 avançam de marco só por isso.
--
-- O que muda:
--   1. vw_pop_marcos_detectados: só documento (jm_documentos). A parte
--      `por_movimento` (jm_movimentos = DataJud, sinal tipo 'tpu') sai.
--   2. vw_pop_marcos_feed (nova): sinais tipo 'texto' contra process_updates,
--      por process_id. Fonte 'escavador_texto' quando a linha veio do
--      monitoramento, 'email_push' quando veio do e-mail do tribunal.
--   3. refresh_process_pop_marcos: passa a unir o feed (prioridade 2, como o
--      e-mail do INSS).
--
-- O que NÃO muda: jm_movimentos continua sendo alimentado (jurimetria lê de
-- lá: prazos em vw_jm_*); os sinais 'tpu' ficam na tabela, inertes; a fase do
-- POP não regride (aplicar_fase_por_marco só avança). `pop_marco_evidencia`
-- continua mostrando o que o DataJud diria — é a seção "o que as outras fontes
-- dizem", informativa.
--
-- Rollback: recriar as duas views a partir de
--   20260812191000_process_pop_marcos_e_fase_automatica.sql (detectados) e
--   20260824151000_email_vira_fonte_de_marco.sql (refresh), depois
--   `select public.refresh_process_pop_marcos();`. Ou restaurar a foto:
--   zz_process_pop_marcos_bkp_20260902 (criada abaixo).
-- =============================================================================

-- 0. Foto do que a régua dizia antes.
create table if not exists public.zz_process_pop_marcos_bkp_20260902 as
  select * from public.process_pop_marcos;
alter table public.zz_process_pop_marcos_bkp_20260902 enable row level security;

-- 1. Detectados = só documento. Mesmas colunas, mesma ordem, mesmos tipos —
--    `create or replace view` exige isso.
create or replace view public.vw_pop_marcos_detectados as
with docs_casados as (
  select pm.board_id, pm.chave, pm.ordem, pm.rotulo, pm.stage_id,
         d.processo_cnj, d.data_documento, d.id
  from public.pop_marcos pm
  join public.pop_marco_sinais s on s.pop_marco_id = pm.id and s.tipo = 'documento'
  join public.jm_documentos d
    on lower(coalesce(d.titulo, '')) ~ s.padrao
   and (s.padrao_excluir is null or lower(coalesce(d.titulo, '')) !~ s.padrao_excluir)
  where d.data_documento is not null and d.marco_chave is null
  union all
  select pm.board_id, pm.chave, pm.ordem, pm.rotulo, pm.stage_id,
         d.processo_cnj, d.data_documento, d.id
  from public.pop_marcos pm
  join public.jm_documentos d on d.marco_chave = pm.chave
  where d.data_documento is not null and d.oculta_em is null
),
por_documento as (
  select board_id, chave as marco_chave, ordem, rotulo, stage_id, processo_cnj,
         min(data_documento) as data_detectada,
         count(*) as itens,
         (array_agg(id order by data_documento))[1] as documento_id
  from docs_casados
  group by board_id, chave, ordem, rotulo, stage_id, processo_cnj
)
select board_id, marco_chave, ordem, rotulo, stage_id, processo_cnj,
       null::date              as data_por_movimento,
       data_detectada          as data_por_documento,
       documento_id,
       itens,
       data_detectada,
       'documento'::text       as fonte_deteccao,
       (documento_id is not null) as tem_prova_documental
from por_documento;

comment on view public.vw_pop_marcos_detectados is
  'Marcos por documento (jm_documentos). Desde 02/09/2026 NÃO lê o DataJud: decisão do usuário, a régua anda só por Escavador/e-mail/documento.';

-- 2. Feed contínuo (process_updates) como fonte de texto.
create or replace view public.vw_pop_marcos_feed as
with feed as (
  select u.process_id,
         p.workflow_id::uuid as board_id,
         u.data_movimentacao::date as data_mov,
         u.origem,
         lower(trim(t)) as txt
  from public.process_updates u
  join public.lead_processes p on p.id = u.process_id
  cross join lateral regexp_split_to_table(
    coalesce(u.descricao, '') || ' · ' || coalesce(u.titulo, ''), ' · ') t
  where p.deleted_at is null and p.workflow_id is not null
    and u.data_movimentacao is not null
)
select pm.board_id,
       pm.chave      as marco_chave,
       pm.ordem, pm.rotulo, pm.stage_id,
       f.process_id,
       min(f.data_mov) as data_detectada,
       count(*)        as itens,
       case when bool_or(f.origem = 'escavador') then 'escavador_texto' else 'email_push' end as fonte_deteccao
from public.pop_marcos pm
join public.pop_marco_sinais s on s.pop_marco_id = pm.id and s.tipo = 'texto'
join feed f on f.board_id = pm.board_id
           and f.txt ~ s.padrao
           and (s.padrao_excluir is null or f.txt !~ s.padrao_excluir)
group by pm.board_id, pm.chave, pm.ordem, pm.rotulo, pm.stage_id, f.process_id;

comment on view public.vw_pop_marcos_feed is
  'Marcos detectados no feed process_updates (monitoramento Escavador + push do tribunal) pelos sinais de texto. Sem teto de 20 movimentações.';

-- 3. Materialização: regua (documento + escavador + capa) ∪ e-mail do INSS ∪ feed.
create or replace function public.refresh_process_pop_marcos(p_process_id uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_linhas integer;
begin
  with alvo as (
    select lp.id as process_id,
           lp.workflow_id::uuid as board_id,
           regexp_replace(coalesce(lp.process_number, ''), '[^0-9]', '', 'g') as cnj_num
    from public.lead_processes lp
    where lp.deleted_at is null
      and lp.workflow_id is not null
      and (
        length(regexp_replace(coalesce(lp.process_number, ''), '[^0-9]', '', 'g')) >= 15
        or coalesce(lp.protocolo_administrativo, '') <> ''
        or exists (select 1 from public.process_pop_marcos m where m.process_id = lp.id)
        or exists (select 1 from public.process_updates u where u.process_id = lp.id)
      )
      and (p_process_id is null or lp.id = p_process_id)
  ),
  candidatos as (
    select a.process_id, r.board_id, r.marco_chave, r.ordem, r.rotulo, r.stage_id,
           r.data_detectada, r.fonte_deteccao, r.tem_prova_documental, 1 as prioridade
    from alvo a
    join public.vw_pop_marcos_regua r
      on r.cnj_num = a.cnj_num and r.board_id = a.board_id
    where length(a.cnj_num) >= 15
    union all
    select e.process_id, e.board_id, e.marco_chave, e.ordem, e.rotulo, e.stage_id,
           e.data_detectada, e.fonte_deteccao, false, 2
    from public.vw_pop_marcos_email e
    join alvo a on a.process_id = e.process_id
    union all
    select f.process_id, f.board_id, f.marco_chave, f.ordem, f.rotulo, f.stage_id,
           f.data_detectada, f.fonte_deteccao, false, 2
    from public.vw_pop_marcos_feed f
    join alvo a on a.process_id = f.process_id and a.board_id = f.board_id
  ),
  novos as (
    select distinct on (process_id, marco_chave)
           process_id, board_id, marco_chave, ordem, rotulo, stage_id,
           data_detectada, fonte_deteccao, tem_prova_documental
    from candidatos
    order by process_id, marco_chave, prioridade, data_detectada
  ),
  apagados as (
    delete from public.process_pop_marcos m
    using alvo a
    where m.process_id = a.process_id
    returning 1
  )
  insert into public.process_pop_marcos
    (process_id, board_id, marco_chave, ordem, rotulo, stage_id,
     data_detectada, fonte, tem_prova_documental, atualizado_em)
  select process_id, board_id, marco_chave, ordem, rotulo, stage_id,
         data_detectada, fonte_deteccao, tem_prova_documental, now()
  from novos
  on conflict (process_id, marco_chave) do update
    set ordem = excluded.ordem,
        rotulo = excluded.rotulo,
        stage_id = excluded.stage_id,
        data_detectada = excluded.data_detectada,
        fonte = excluded.fonte,
        tem_prova_documental = excluded.tem_prova_documental,
        atualizado_em = now();

  get diagnostics v_linhas = row_count;
  return v_linhas;
end $function$;

-- 4. Rematerializa a base inteira e move as fases que avançaram.
select public.refresh_process_pop_marcos();
select count(*) as fases_movidas from public.aplicar_fase_por_marco();
