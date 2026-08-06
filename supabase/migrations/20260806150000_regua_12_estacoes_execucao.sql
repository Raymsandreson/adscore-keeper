-- =============================================================================
-- Régua processual: de 10 para 12 estações. Entra a FASE DE EXECUÇÃO.
--
-- POR QUE: decisão jurídica de 06/08/2026. A régua terminava em Pagamento e não
-- tinha onde registrar cumprimento de sentença, impugnação, embargos, penhora,
-- precatório. Consequência medida no banco: 39 movimentações em 11 processos
-- estavam gravadas como sentenca_1grau (estação 5), fazendo o processo parecer
-- parado na sentença quando a execução já corria.
--
-- Escala nova:
--    1 peticao_inicial          7 acordao_2grau
--    2 audiencia_conciliacao    8 acordao_superior
--    3 pericia                  9 transito_julgado
--    4 audiencia_instrucao     10 cumprimento_sentenca   <- NOVA
--    5 sentenca_1grau          11 precatorio_rpv         <- NOVA
--    6 acordo                  12 pagamento              <- era 10
--
-- ONDE MAIS A ESCALA VIVE (tem que andar junto, senão o marco atual mente):
--   supabase/functions/_shared/escavadorMarcos.ts  (MARCO_ORDEM)
--   supabase/functions/_shared/marcosIA.ts         (MARCO_ORDEM_CANONICA)
--   src/lib/processStations.ts                     (front)
-- O banco é a autoridade: o trigger trg_process_movements_marco_ordem recarimba
-- marco_ordem em todo INSERT/UPDATE a partir de marco_ordem_canonica().
--
-- NÃO APAGA NADA. Só reescreve a função, amplia a CHECK e recarimba a ordem das
-- linhas de 'pagamento' que já existem (10 -> 12).
--
-- ROLLBACK (testado, < 1 min):
--   1. alter table public.process_movements drop constraint process_movements_tipo_movimentacao_check;
--      alter table public.process_movements add constraint process_movements_tipo_movimentacao_check
--        check (tipo_movimentacao = any (array['peticao_inicial','audiencia_conciliacao','pericia',
--          'audiencia_instrucao','sentenca_1grau','acordo','acordao_2grau','acordao_superior',
--          'transito_julgado','pagamento']));
--      -- exige que nenhuma linha use os 2 tipos novos; se usar, primeiro:
--      -- update public.process_movements set tipo_movimentacao='sentenca_1grau'
--      --   where tipo_movimentacao='cumprimento_sentenca';
--      -- update public.process_movements set tipo_movimentacao='pagamento'
--      --   where tipo_movimentacao='precatorio_rpv';
--   2. recriar marco_ordem_canonica() com o corpo de 10 estações (pagamento=10).
--   3. update public.process_movements
--        set marco_ordem = public.marco_ordem_canonica(tipo_movimentacao);
-- =============================================================================

-- 1. A escala. IMMUTABLE + search_path fixo, como estava.
create or replace function public.marco_ordem_canonica(p_tipo text)
returns smallint
language sql
immutable
set search_path to 'public'
as $function$
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
    when 'cumprimento_sentenca'  then 10
    when 'precatorio_rpv'        then 11
    when 'pagamento'             then 12
  end::smallint;
$function$;

-- 2. A CHECK precisa aceitar os 2 tipos novos ANTES de qualquer insert deles.
alter table public.process_movements
  drop constraint if exists process_movements_tipo_movimentacao_check;

alter table public.process_movements
  add constraint process_movements_tipo_movimentacao_check
  check (tipo_movimentacao = any (array[
    'peticao_inicial','audiencia_conciliacao','pericia','audiencia_instrucao',
    'sentenca_1grau','acordo','acordao_2grau','acordao_superior',
    'transito_julgado','cumprimento_sentenca','precatorio_rpv','pagamento'
  ]));

-- 3. Recarimba a ordem de quem já está na tabela. Só 'pagamento' muda de valor
--    (10 -> 12); os outros tipos recebem o mesmo número que já tinham. Rodar em
--    todos mesmo assim é a garantia de que não sobra divergência silenciosa.
update public.process_movements
   set marco_ordem = public.marco_ordem_canonica(tipo_movimentacao)
 where marco_ordem is distinct from public.marco_ordem_canonica(tipo_movimentacao);

comment on function public.marco_ordem_canonica(text) is
  'Escala canônica de 12 estações da régua processual. Fonte da verdade para marco_ordem — '
  'espelhada em escavadorMarcos.ts, marcosIA.ts e src/lib/processStations.ts. '
  '06/08/2026: entraram cumprimento_sentenca (10) e precatorio_rpv (11); pagamento foi de 10 para 12.';
