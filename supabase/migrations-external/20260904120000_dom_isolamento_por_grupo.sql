-- Dom — isolamento do acervo por grupo
--
-- APLICAR no projeto EXTERNO (kmedldlepwiityjsdahz).
--
-- O QUE MUDA
-- `dom_respostas_parecidas` nasceu (21/08/2026) varrendo o acervo INTEIRO: os
-- 4.546 pares dos 481 grupos. A intenção era boa — pegar o TOM que a equipe usa
-- — e o texto vem com PII mascarada e com a instrução explícita de nunca copiar
-- dado factual de exemplo. Mas "instrução explícita" é promessa, não garantia:
-- basta o modelo copiar uma data ou um valor de exemplo para o cliente de um
-- grupo receber informação do processo de outro.
--
-- A regra do atendimento é que cada grupo é uma caixa fechada. As outras duas
-- fontes já respeitavam isso por construção:
--   - histórico da conversa: whatsapp-ai-agent-reply filtra por phone+instance
--   - andamento processual: dom_contexto_processual parte do JID → lead → autos
-- O acervo era a única porta aberta entre grupos. Esta migration fecha.
--
-- CONSEQUÊNCIA ACEITA
-- Grupo novo, com pouco ou nenhum par no acervo, passa a rodar sem exemplos.
-- O tom, nesse caso, vem só do bloco de linguagem do prompt. É o preço de não
-- ter vazamento — e é o lado certo para errar.
--
-- ROLLBACK
--   drop function if exists public.dom_respostas_parecidas(text, integer, text);
--   e recriar a versão de 20260821180030 (2 argumentos).

-- A assinatura muda (ganha p_group_jid), então não dá para usar CREATE OR
-- REPLACE: seria um overload, e a versão antiga de 2 argumentos continuaria
-- viva e chamável — justamente a que vaza. Derrubar é parte do conserto.
drop function if exists public.dom_respostas_parecidas(text, integer);

create or replace function public.dom_respostas_parecidas(
  p_pergunta  text,
  p_limit     int  default 6,
  p_group_jid text default null)
returns table (pergunta text, resposta text, respondido_em timestamptz, score real)
language sql stable security definer set search_path = public, extensions
as $$
  with termos as (
    select lex
    from unnest(tsvector_to_array(
           to_tsvector('portuguese', unaccent(coalesce(p_pergunta, ''))))) as lex
    where lex not in (select lexema from dom_lexemas_comuns)
      and length(lex) > 2
  ),
  q as (
    select nullif(string_agg(quote_literal(lex), ' | '), '')::tsquery as tsq
    from termos
  )
  select dom_mascarar_pii(p.pergunta),
         dom_mascarar_pii(p.resposta),
         p.respondido_em,
         ts_rank(p.busca, q.tsq) as score
  from dom_qa_pares p, q
  where q.tsq is not null
    -- Sem grupo informado NÃO devolve nada. Falhar calado é o comportamento
    -- certo aqui: um chamador que esqueceu de passar o grupo receberia, na
    -- versão antiga, exemplos do acervo inteiro sem perceber.
    and p_group_jid is not null
    and p.group_jid = dom_jid_curto(p_group_jid)
    and p.busca @@ q.tsq
    and ts_rank(p.busca, q.tsq) >= 0.02
  order by
    case p.origem
      when 'dom_corrigido' then 0
      when 'equipe'        then 1
      when 'dom_aprovado'  then 2
      else 3
    end,
    ts_rank(p.busca, q.tsq) desc,
    p.respondido_em desc
  limit greatest(1, least(coalesce(p_limit, 6), 20))
$$;

comment on function public.dom_respostas_parecidas is
  'Respostas que a equipe já deu NAQUELE MESMO grupo para perguntas parecidas. Sem p_group_jid não devolve nada — o acervo nunca cruza grupos.';
