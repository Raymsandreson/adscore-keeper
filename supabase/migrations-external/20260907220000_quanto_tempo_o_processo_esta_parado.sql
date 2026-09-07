-- ============================================================================
-- Quanto tempo o processo está parado — em dias, e ignorando despacho
--
-- POR QUE
-- "A última movimentação foi em 28 de agosto" não responde a pergunta que o
-- cliente realmente faz, que é "há quanto tempo isso está parado?". A data
-- obriga a pessoa a fazer a conta; o número de dias já é a resposta.
--
-- DUAS CONTAS, DE PROPÓSITO
--   parado_dias         → desde QUALQUER movimento (o feed inteiro)
--   parado_dias_efetivo → ignorando `categoria = 'despacho'`
--
-- Despacho é ordem de andamento do juiz e, sozinho, não move o caso: o
-- processo "andou" no papel e continua exatamente onde estava. Medido em
-- 07/09/2026: 383 despachos em 180 dias, contra 396 decisões de mérito, 252
-- audiências e 131 perícias — volumoso o bastante para mascarar uma parada.
--
-- HONESTIDADE SOBRE O EFEITO DE HOJE: nos 30 processos do piloto nenhum passa
-- de 90 dias (a maior parada é de 83), e as duas contas dão o mesmo resultado
-- no agregado. A regra nasce dormente. No Caso 341, porém, a diferença já
-- aparece: 15 dias contando tudo, 17 ignorando o despacho.
--
-- POR QUE process_updates E NÃO O jsonb `movimentacoes`
-- As duas fontes discordam: pelo jsonb (retrato do Escavador) a maior parada
-- do piloto é de 173 dias; por process_updates, 83. process_updates recebe o
-- e-mail do tribunal, que chega antes da próxima consulta ao Escavador — é a
-- fonte mais atual, e é a que `feed_em` já usava.
--
-- POR QUE NÃO `workflow_stage_em` (a data da fase)
-- Porque ela é NOVA: a mais antiga do piloto é de 13/08/2026, 25 dias. Ela
-- registra quando o NOSSO sistema detectou a fase, não quando o processo
-- entrou nela. Usá-la faria o Dom dizer "parado há 25 dias" para um caso
-- parado há meses — número errado dito com confiança, pior que número nenhum.
--
-- ROTA DE FUGA: `dom_contexto_processual_antes_dias_parado` guarda a versão
-- anterior. Rollback é ler o def dela, trocar o nome de volta e executar.
-- ============================================================================

do $mig$
declare def text; copia text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';
  if def is null then raise exception 'dom_contexto_processual não existe'; end if;

  copia := replace(def,
                   'FUNCTION public.dom_contexto_processual(',
                   'FUNCTION public.dom_contexto_processual_antes_dias_parado(');
  if copia = def then raise exception 'não achei o nome da função para copiar'; end if;
  execute copia;
end $mig$;

do $mig$
declare def text; novo text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';

  novo := regexp_replace(
    def,
    '(\)\s*as feed_em)(\s*from proc pr)',
    E'\\1,\n           (select max(u.data_movimentacao)\n              from process_updates u\n             where ((pr.cnj_digitos is not null\n                     and dom_so_digitos(u.numero_cnj) = pr.cnj_digitos)\n                    or u.process_id = pr.id)\n               and coalesce(u.categoria, '''') <> ''despacho'') as feed_efetivo_em\\2'
  );
  if novo = def then raise exception 'não achei o fim da CTE mov — NADA alterado'; end if;
  execute novo;
end $mig$;

do $mig$
declare def text; novo text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';

  novo := regexp_replace(
    def,
    '(''ultima_movimentacao_cadastro'',\s*mv\.cadastro_em,)',
    E'\\1\n            ''parado_dias'',         (current_date - coalesce(mv.feed_em, mv.cadastro_em)::date),\n            ''parado_dias_efetivo'', (current_date - mv.feed_efetivo_em::date),'
  );
  if novo = def then raise exception 'não achei ultima_movimentacao_cadastro — NADA alterado'; end if;
  execute novo;
end $mig$;

comment on function public.dom_contexto_processual(text) is
  'Contexto do Dom. parado_dias / parado_dias_efetivo = dias desde o último movimento (o segundo ignora categoria despacho). ultima_atividade.prazo_contato = deadline da atividade, só quando ainda não venceu. Ignora atividade com deleted_at.';
