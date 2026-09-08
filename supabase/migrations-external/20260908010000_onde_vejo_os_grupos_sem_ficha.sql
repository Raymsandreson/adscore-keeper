-- =============================================================================
-- Os grupos que o Dom atende sem saber de quem são — consertar e VER
--
-- DE ONDE VEIO
-- A correção de 07/09 (20260907230000) fez a RPC achar a ficha em dois
-- degraus. Resultado medido logo depois, sobre `dom_grupos_piloto` ativo:
--     827  com ponte em lead_whatsapp_groups
--     166  sem ponte, mas com UMA ÚNICA ficha viva no cadastro
--      40  sem ponte e com 2+ fichas  → ambíguo
--     116  sem ponte e sem ficha nenhuma
-- Os 166 funcionavam por CONTORNO: a RPC lia `leads.whatsapp_group_id` na
-- hora. Funciona, mas é frágil — no dia em que uma segunda ficha apontar para
-- um desses grupos, ele apaga de novo, e corretamente (a regra se recusa a
-- sortear de quem é o processo).
--
-- PARTE 1 — os 166 viram ponte de verdade
-- Não é heurística de nome. O `useAutoLinkGroupByName` casa por NOME e erra:
-- 815 vínculos criados assim, 101 com número de caso divergente (~12%). Aqui
-- não há palpite: materializa-se o que o PRÓPRIO CADASTRO já afirma em
-- `leads.whatsapp_group_id`, e só quando há exatamente uma ficha viva.
-- Conferido antes de aplicar: 166 grupos → 166 fichas DISTINTAS, nenhuma
-- colisão, nenhum lead_id nulo, nenhum grupo de teste.
-- Marcados `auto_linked = true` — é vínculo de automação, e é o que torna o
-- rollback uma linha só.
--
-- PARTE 2 — os 156 que sobram ganham um lugar para serem vistos
-- Ambíguo e sem-ficha não têm conserto automático: exigem uma pessoa dizendo
-- de quem é o grupo. Sem um lugar na tela eles ficariam como estavam — o
-- assessor respondendo no escuro e ninguém sabendo. `vw_dom_grupo_sem_ficha`
-- é esse lugar, e a aba "Sem ficha" do AtendenteVirtualPanel a consome.
--
-- A view devolve `o_que_fazer` em português e `rascunhos_no_escuro` (quantas
-- respostas já saíram sem contexto por causa daquele grupo). O segundo é de
-- propósito: é o custo de adiar, e sem ele a lista vira só mais uma lista.
--
-- O QUE NÃO ENTRA NA VIEW
-- Grupo com ponte. Se tem ponte, está resolvido, e uma lista que mistura o
-- resolvido com o pendente deixa de ser fila de trabalho.
--
-- ACHADO QUE CONTRARIA A PRIMEIRA LEITURA
-- 41 dos 116 sem-ficha têm `group_jid` que não parece jid de grupo (não casa
-- `^1203[0-9]{14}$`) — parecem telefone+timestamp. A tentação é descartar como
-- lixo. Não são: somam 8.744 mensagens e a mais recente é de 07/09/2026
-- 10:58. São grupos ativos em formato antigo de jid, com clientes falando.
-- Precisam de cadastro como qualquer outro.
--
-- ROLLBACK
--   delete from lead_whatsapp_groups
--    where auto_linked and created_at >= '2026-09-08'::date;   -- desfaz a parte 1
--   drop view public.vw_dom_grupo_sem_ficha;                    -- desfaz a parte 2
-- =============================================================================

-- ── PARTE 1 — materializa o vínculo que o cadastro já afirma ─────────────────
with alvo as (
  select dp.group_jid,
         dp.group_name,
         (select l.id from leads l
           where l.whatsapp_group_id is not null and l.deleted_at is null
             and dom_jid_curto(l.whatsapp_group_id) = dom_jid_curto(dp.group_jid)
           limit 1) as lead_id
  from dom_grupos_piloto dp
  where dp.ativo
    and not exists (select 1 from lead_whatsapp_groups w
                     where dom_jid_curto(w.group_jid) = dom_jid_curto(dp.group_jid)
                       and w.lead_id is not null)
    -- A TRAVA. Com duas ou mais fichas, escolher uma é sortear de quem é o
    -- processo. 904 jids do cadastro apontam para mais de uma; um para 18.
    and (select count(*) from leads l
          where l.whatsapp_group_id is not null and l.deleted_at is null
            and dom_jid_curto(l.whatsapp_group_id) = dom_jid_curto(dp.group_jid)) = 1
)
insert into lead_whatsapp_groups (lead_id, group_jid, group_name, auto_linked)
select a.lead_id, dom_jid_curto(a.group_jid) || '@g.us', a.group_name, true
from alvo a
on conflict do nothing;

-- ── PARTE 2 — o lugar onde se vê quem ainda falta ────────────────────────────
create or replace view public.vw_dom_grupo_sem_ficha as
with g as (
  select dp.group_jid,
         dp.group_name,
         dp.modo,
         (select w.lead_id from lead_whatsapp_groups w
           where dom_jid_curto(w.group_jid) = dom_jid_curto(dp.group_jid)
             and w.lead_id is not null
           order by w.created_at desc limit 1) as lead_da_ponte,
         (select count(*) from leads l
           where l.whatsapp_group_id is not null and l.deleted_at is null
             and dom_jid_curto(l.whatsapp_group_id) = dom_jid_curto(dp.group_jid)) as fichas_no_cadastro
  from dom_grupos_piloto dp
  where dp.ativo
)
select
  g.group_jid,
  g.group_name,
  g.modo,
  g.fichas_no_cadastro,
  case
    when g.lead_da_ponte is not null then 'ok'
    when g.fichas_no_cadastro  > 1   then 'ambiguo'
    else 'sem_ficha'
  end as situacao,
  case
    when g.lead_da_ponte is not null then null
    when g.fichas_no_cadastro > 1 then
      'Este grupo tem ' || g.fichas_no_cadastro || ' fichas apontando para ele. '
      || 'Abra o grupo e ligue-o à ficha certa — o sistema não escolhe, seria sortear de quem é o processo.'
    else
      'Nenhuma ficha aponta para este grupo. Cadastre o cliente, ou ligue o grupo à ficha que já existe.'
  end as o_que_fazer,
  -- O custo de adiar, à vista. Cada um foi uma resposta escrita no escuro.
  (select count(*) from dom_respostas_pendentes p
    where dom_jid_curto(p.group_jid) = dom_jid_curto(g.group_jid)
      and (p.contexto_usado->>'tem_vinculo')::boolean is not true) as rascunhos_no_escuro,
  (select max(p.criado_em) from dom_respostas_pendentes p
    where dom_jid_curto(p.group_jid) = dom_jid_curto(g.group_jid)) as ultimo_rascunho_em
from g
where g.lead_da_ponte is null;

comment on view public.vw_dom_grupo_sem_ficha is
  'Grupos ativos do piloto do Dom cuja ficha de cliente NAO foi encontrada. '
  'situacao: ambiguo (2+ fichas apontam para o grupo, o sistema se recusa a '
  'escolher) ou sem_ficha (nenhuma aponta). o_que_fazer traz o conserto em '
  'portugues. rascunhos_no_escuro conta as respostas ja geradas sem contexto. '
  'Grupo com ponte em lead_whatsapp_groups nao aparece aqui.';

-- ── CONFERIDO EM 08/09/2026, depois de aplicar ───────────────────────────────
--   166 linhas inseridas; grupos do piloto com ponte: 827 → 993; "só no
--   cadastro" caiu a 0. Amostra de 3 dos novos, pela RPC: fonte 'ponte',
--   3 / 2 / 2 processos, todos com atividade.
--   A view devolve 156 grupos: 116 sem_ficha (2 rascunhos no escuro) e
--   40 ambiguo (2 rascunhos no escuro).
