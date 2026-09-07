-- =============================================================================
-- Cada movimentação passa a dizer DE ONDE veio.
--
-- POR QUE. O painel de conferência precisa mostrar ao revisor as fontes que
-- geraram a resposta, e "movimentação" não é uma fonte só:
--
--   * no processo JUDICIAL, o e-mail do tribunal é o GATILHO — ele avisa que
--     mexeu, e a partir dele se vai buscar a peça no Escavador;
--   * no processo ADMINISTRATIVO (INSS), o e-mail é a ÚNICA fonte. Não há
--     Escavador, não há peça. Se o revisor não souber disso, vai procurar um
--     documento que nunca existiu.
--
-- Medido em 07/09/2026, `process_updates`:
--     escavador    2.968
--     email_push   2.907  (1.481 com o e-mail rastreável em email_message_id)
--
-- Quase meio a meio. Mostrar as duas como "movimentação" sem distinguir esconde
-- justamente a informação que diz se havia ou não onde conferir.
--
-- O QUE MUDA. `dom_contexto_processual` passa a devolver, em cada andamento:
--     origem     'escavador' | 'email_push'
--     esfera     judicial | administrativa
--     do_email   true quando existe o e-mail de origem guardado
--     email_em   quando o e-mail chegou
-- Chaves NOVAS, nada removido: quem já lê `data/titulo/resumo/categoria`
-- continua igual. E como `contexto_usado` é gravado como veio, o rascunho novo
-- já nasce com a origem registrada.
--
-- POR QUE O PATCH É CIRÚRGICO e não um CREATE OR REPLACE inteiro: a função tem
-- 239 linhas, e reescrevê-la à mão para acrescentar quatro chaves é mais
-- arriscado do que trocar o trecho exato. A âncora é única (conferido) e o
-- bloco ABORTA com mensagem clara se ela não for encontrada — falha alto em vez
-- de aplicar pela metade.
--
-- ROLLBACK: reaplicar a migration que criou a versão anterior da
-- dom_contexto_processual (20260905203000_dom_ultima_movimentacao_real.sql e
-- sucessoras), ou remover as quatro chaves pelo mesmo caminho.
-- =============================================================================

do $patch$
declare
  v_def   text;
  v_velho text := $a$'resumo',    dom_texto_limpo(coalesce(u.resumo_ia, left(u.descricao, 400)))$a$;
  v_novo  text := $b$'resumo',    dom_texto_limpo(coalesce(u.resumo_ia, left(u.descricao, 400))),
                       'origem',    u.origem,
                       'esfera',    u.esfera,
                       'do_email',  (u.email_message_id is not null),
                       'email_em',  u.email_recebido_em$b$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';

  if v_def is null then
    raise exception 'dom_contexto_processual nao existe';
  end if;

  if position(v_velho in v_def) = 0 then
    -- Ja aplicado, ou a funcao mudou. Nos dois casos e para parar e olhar.
    if position($c$'origem',    u.origem$c$ in v_def) > 0 then
      raise notice 'origem ja presente nos andamentos — nada a fazer';
      return;
    end if;
    raise exception 'ancora do bloco andamentos nao encontrada — a funcao mudou, reveja o patch';
  end if;

  execute replace(v_def, v_velho, v_novo);
end $patch$;
