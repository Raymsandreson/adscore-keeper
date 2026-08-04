-- =============================================================================
-- marco_ordem passa a usar UMA escala só: a régua canônica de 10 estações.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Problema (evidência de 03/08/2026): a coluna carregava DUAS escalas.
--   - escavadorMarcos.ts (parser de decisões) usava uma régua própria de 7:
--       peticao 1, sentenca 2, acordo 3, acordao_2grau 4, superior 5, transito 6, pagamento 7
--   - sync-process-compromissos (estações) usava a posição na régua de 10:
--       audiencia_conciliacao 2, pericia 3, audiencia_instrucao 4
--   Resultado: sentenca_1grau empatava com audiencia_conciliacao (ambos 2),
--   acordo com pericia (3) e acordao_2grau com audiencia_instrucao (4).
--   Como "marco atual" = maior marco_ordem, a audiência mascarava o marco de
--   decisão. Medido antes do fix: 4 processos com status atual atrasado
--   (2 audiencia_instrucao que eram acordo, 1 pericia que era sentença,
--    1 audiencia_instrucao que era sentença).
--
-- Régua canônica (mesma de src/lib/processStations.ts, do TeamProcessGoals.tsx
-- e da ordem da CHECK constraint process_movements_tipo_movimentacao_check):
--   1 peticao_inicial · 2 audiencia_conciliacao · 3 pericia · 4 audiencia_instrucao
--   5 sentenca_1grau  · 6 acordo · 7 acordao_2grau · 8 acordao_superior
--   9 transito_julgado · 10 pagamento
--
-- Consumidores de marco_ordem que herdam a correção sem alteração:
--   view lead_process_current_status, RPCs team_process_marco_baseline e
--   team_process_marco_processos, ProcessMovementsTimeline.tsx (modo "só atual").
--
-- Além do remapeamento, a ordem passa a ser CARIMBADA PELO BANCO a partir do
-- tipo (trigger abaixo) — nenhum produtor futuro consegue reintroduzir uma
-- escala divergente. process_movements segue append-only: nada é apagado.
--
-- Rollback (reverte os dois passos):
--   drop trigger if exists trg_process_movements_marco_ordem on public.process_movements;
--   drop function if exists public.process_movements_set_marco_ordem();
--   update public.process_movements set marco_ordem = case tipo_movimentacao
--     when 'peticao_inicial' then 1 when 'sentenca_1grau' then 2 when 'acordo' then 3
--     when 'acordao_2grau' then 4 when 'acordao_superior' then 5
--     when 'transito_julgado' then 6 when 'pagamento' then 7
--     when 'audiencia_conciliacao' then 2 when 'pericia' then 3
--     when 'audiencia_instrucao' then 4 end;
-- =============================================================================

-- Fonte da verdade da régua, em SQL.
create or replace function public.marco_ordem_canonica(p_tipo text)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case p_tipo
    when 'peticao_inicial'       then 1
    when 'audiencia_conciliacao' then 2
    when 'pericia'               then 3
    when 'audiencia_instrucao'   then 4
    when 'sentenca_1grau'        then 5
    when 'acordo'                then 6
    when 'acordao_2grau'         then 7
    when 'acordao_superior'      then 8
    when 'transito_julgado'      then 9
    when 'pagamento'             then 10
  end::smallint;
$$;

comment on function public.marco_ordem_canonica(text) is
  'Posição do marco na régua canônica de 10 estações. Fonte única da ordem — espelha src/lib/processStations.ts.';

-- 1) Remapeia o que já está gravado (345 linhas em 03/08/2026; idempotente).
update public.process_movements pm
set marco_ordem = public.marco_ordem_canonica(pm.tipo_movimentacao)
where pm.marco_ordem is distinct from public.marco_ordem_canonica(pm.tipo_movimentacao);

-- 2) Trava: daqui pra frente o banco carimba a ordem pelo tipo, ignorando o que
--    o cliente mandar. Foi a divergência entre dois produtores que criou o bug.
create or replace function public.process_movements_set_marco_ordem()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.marco_ordem := public.marco_ordem_canonica(new.tipo_movimentacao);
  return new;
end;
$$;

drop trigger if exists trg_process_movements_marco_ordem on public.process_movements;
create trigger trg_process_movements_marco_ordem
  before insert or update of tipo_movimentacao, marco_ordem
  on public.process_movements
  for each row
  execute function public.process_movements_set_marco_ordem();

comment on column public.process_movements.marco_ordem is
  'Posição na régua canônica de 10 estações (1 petição inicial … 10 pagamento). Carimbada pelo trigger trg_process_movements_marco_ordem a partir do tipo — não confie no valor enviado pelo cliente.';
