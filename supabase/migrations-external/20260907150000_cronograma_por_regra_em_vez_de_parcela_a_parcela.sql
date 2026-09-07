-- =============================================================================
-- O cronograma passa a poder vir como REGRA, e o banco expande.
--
-- O PROBLEMA
-- A peça 110 é uma pensão mensal com mais de 464 parcelas. O prompt manda gerar
-- uma entrada por parcela ("GERE as N entradas com as datas calculadas"), então
-- o modelo enumera as 464 — cerca de 28 mil tokens só de `cronograma`. A peça
-- estoura o teto e não é lida. Nenhuma.
--
-- E subir o teto é corrida perdida. Medido em 07/09/2026, depois de subir de
-- 8.192 para 32.768:
--     finishReason=MAX_TOKENS  pensamento=22917  saida=9835  entrada=9576
-- O raciocínio cresce junto com a complexidade da peça e disputa o mesmo
-- orçamento. Não existe teto que ganhe dessa corrida.
--
-- O ERRO NÃO É DE LIMITE, É DE DESENHO. Um cronograma definido por regra —
-- "464 parcelas de R$ 1.736,57, mensais, a partir de 05/06/2025" — está sendo
-- materializado linha a linha por um LLM, que é o lugar mais caro e mais frágil
-- possível para expandir uma progressão aritmética. É como pedir a alguém que
-- escreva "1, 2, 3, ... 464" à mão em vez de dizer "de 1 a 464".
--
-- A SOLUÇÃO: o modelo devolve a REGRA, o banco conta. `generate_series` e
-- `+ interval` fazem isso sem errar e sem custo.
--
-- POR QUE NO BANCO E NÃO NA EDGE FUNCTION
-- Porque assim NADA que hoje lê `cronograma` precisa mudar. A coluna continua
-- guardando a mesma lista de parcelas, no mesmo formato; muda só quem a escreve.
-- `cronogramaParcelas.ts`, a tela de mudanças da peça, o financeiro e as 179
-- leituras que já têm cronograma seguem exatamente como estão.
--
-- O QUE O CAMPO NOVO NÃO FAZ
-- Não substitui o `cronograma`. Parcela irregular — valores diferentes, datas
-- salteadas, uma entrada por parte — continua sendo enumerada como sempre. A
-- regra serve para a série regular, que é justamente a que fica grande.
-- Se vierem os dois, o enumerado vence: o gatilho só preenche quando o
-- `cronograma` está vazio. A peça manda mais que a regra.
--
-- TETO DE SEGURANÇA: 1.200 parcelas (100 anos de pensão mensal). Acima disso a
-- regra é recusada com aviso em vez de gerar lista absurda — número improvável
-- é detector, não licença para materializar.
--
-- MEDIDO ANTES (07/09/2026): das 9.142 leituras, 8.963 não têm cronograma
-- nenhum, 178 têm até 60 parcelas e UMA tem 241. Ou seja: isto não é economia
-- geral de token, é o que torna a peça longa LEGÍVEL. Dizer que "economiza"
-- seria vender o que não entrega.
--
-- ROLLBACK:
--   drop trigger if exists jm_leitura_expande_cronograma on public.jm_documento_leitura;
--   drop function if exists public.jm_leitura_expande_cronograma();
--   drop function if exists public.jm_expandir_cronograma_regra(jsonb);
--   alter table public.jm_documento_leitura drop column if exists cronograma_regra;
--   (e redeploy da versão anterior da jm-ler-peca)
-- =============================================================================

alter table public.jm_documento_leitura
  add column if not exists cronograma_regra jsonb;

comment on column public.jm_documento_leitura.cronograma_regra is
  'Regra do cronograma quando a serie e REGULAR: {n_parcelas, valor_parcela, primeira_data, periodicidade, beneficiario}. O gatilho expande em `cronograma` — o modelo diz "464 parcelas mensais de X a partir de Y" em vez de escrever as 464. Parcela irregular continua enumerada em `cronograma`; se vierem os dois, o enumerado vence.';

-- ---------------------------------------------------------------------------
-- A expansao. Pura: mesma regra, mesma lista, sempre.
-- ---------------------------------------------------------------------------
create or replace function public.jm_expandir_cronograma_regra(p_regra jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
as $function$
declare
  v_n            integer;
  v_valor        numeric;
  v_primeira     date;
  v_periodo      text;
  v_intervalo    interval;
  v_beneficiario text;
begin
  if p_regra is null or jsonb_typeof(p_regra) <> 'object' then
    return '[]'::jsonb;
  end if;

  begin
    v_n := nullif(p_regra->>'n_parcelas', '')::integer;
  exception when others then
    return '[]'::jsonb;
  end;

  -- Sem quantidade nao ha serie. Teto de 1.200 (100 anos de pensao mensal):
  -- acima disso o numero e improvavel, e improvavel se conferre, nao se
  -- materializa.
  if v_n is null or v_n < 1 or v_n > 1200 then
    return '[]'::jsonb;
  end if;

  begin
    v_valor := nullif(p_regra->>'valor_parcela', '')::numeric;
  exception when others then
    v_valor := null;
  end;

  begin
    v_primeira := nullif(p_regra->>'primeira_data', '')::date;
  exception when others then
    v_primeira := null;
  end;

  v_beneficiario := nullif(btrim(coalesce(p_regra->>'beneficiario', '')), '');

  v_periodo := upper(coalesce(nullif(btrim(p_regra->>'periodicidade'), ''), 'MENSAL'));
  v_intervalo := case v_periodo
                   when 'SEMANAL'   then interval '7 days'
                   when 'QUINZENAL' then interval '15 days'
                   when 'MENSAL'    then interval '1 month'
                   when 'BIMESTRAL' then interval '2 months'
                   when 'TRIMESTRAL' then interval '3 months'
                   when 'SEMESTRAL' then interval '6 months'
                   when 'ANUAL'     then interval '1 year'
                   else null
                 end;

  -- Periodicidade que nao reconhecemos nao vira chute de data: sem intervalo,
  -- a serie sai com valor e sem data. Data errada em parcela e pior que data
  -- ausente — uma some do radar, a outra cobra no dia errado.
  return (
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'n_parcela',     i,
               'data_prevista', case
                                  when v_primeira is null or v_intervalo is null then null
                                  else to_char(v_primeira + (i - 1) * v_intervalo, 'YYYY-MM-DD')
                                end,
               'valor',         v_valor,
               'beneficiario',  v_beneficiario
             ) order by i
           ), '[]'::jsonb)
      from generate_series(1, v_n) as i
  );
end $function$;

comment on function public.jm_expandir_cronograma_regra(jsonb) is
  'Expande a regra do cronograma na lista de parcelas que `jm_documento_leitura.cronograma` sempre guardou. Devolve [] quando a regra nao tem n_parcelas utilizavel ou passa de 1.200 parcelas. Periodicidade desconhecida gera parcelas SEM data em vez de data chutada.';

-- ---------------------------------------------------------------------------
-- O gatilho. So preenche o que esta vazio — a peca manda mais que a regra.
-- ---------------------------------------------------------------------------
create or replace function public.jm_leitura_expande_cronograma()
returns trigger
language plpgsql
as $function$
begin
  if new.cronograma_regra is not null
     and coalesce(jsonb_array_length(coalesce(new.cronograma, '[]'::jsonb)), 0) = 0 then
    new.cronograma := public.jm_expandir_cronograma_regra(new.cronograma_regra);
  end if;
  return new;
end $function$;

drop trigger if exists jm_leitura_expande_cronograma on public.jm_documento_leitura;
create trigger jm_leitura_expande_cronograma
  before insert or update on public.jm_documento_leitura
  for each row
  execute function public.jm_leitura_expande_cronograma();
