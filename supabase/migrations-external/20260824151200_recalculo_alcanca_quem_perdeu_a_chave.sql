-- =============================================================================
-- O RECÁLCULO PRECISA ALCANÇAR QUEM PERDEU A CHAVE
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
-- Depende de: 20260824151100_regua_administrativa_bpc_por_email.sql
--
-- Bug encontrado no teste ponta a ponta, minutos depois de aplicar a migration
-- anterior. `alvo` seleciona processo COM CNJ ou COM protocolo. Quem PERDE a
-- chave — protocolo desvinculado, CNJ corrigido — sai do alvo, e o DELETE de
-- recálculo é `delete ... using alvo`. Resultado: os marcos que ele já tinha
-- ficam gravados para sempre, sem nenhuma fonte que os sustente, e
-- refresh_process_pop_marcos devolve 0 sem reclamar de nada.
--
-- Medido: desvincular o protocolo de teste deixou 3 marcos órfãos
-- (process_pop_marcos foi de 2.982 para 2.985).
--
-- É o mesmo buraco que o cabeçalho de 20260824151100 já previa para o caso de
-- entrada — e que passou despercebido no caso de SAÍDA.
--
-- Correção: quem JÁ TEM marco gravado entra no alvo por isso mesmo. O
-- recálculo passa por ele e, não achando fonte, o marco sai limpo.
--
-- Conferido depois da correção: 2.982 marcos, 823 processos, 143 no POP
-- administrativo, 780 fases escritas por marco — todos idênticos ao retrato
-- anterior à mudança do e-mail.
--
-- REVERSÃO: recriar a função com a definição de 20260824151100.
-- =============================================================================
create or replace function public.refresh_process_pop_marcos(p_process_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
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
        -- quem já tem marco entra pelo marco: sem isso o DELETE não o alcança
        -- e o marco de uma fonte que sumiu nunca mais sai.
        or exists (select 1 from public.process_pop_marcos m where m.process_id = lp.id)
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
end $fn$;

grant execute on function public.refresh_process_pop_marcos(uuid) to authenticated, anon, service_role;

comment on function public.refresh_process_pop_marcos(uuid) is
  'Materializa as cinco fontes de marco em process_pop_marcos: regua por CNJ (DataJud, documento, Escavador, capa) e e-mail por protocolo. Alcanca tambem quem ja tem marco gravado, para que marco de fonte que sumiu seja removido. Sem argumento, recalcula a base inteira.';
