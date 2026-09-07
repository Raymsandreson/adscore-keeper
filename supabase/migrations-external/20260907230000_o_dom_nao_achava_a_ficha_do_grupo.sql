-- =============================================================================
-- O Dom não achava a ficha do cliente — e dizia "(0)" como se não houvesse nada
--
-- O QUE FOI VISTO (07/09/2026, grupo "Caso 09 - SÓ RAIMUNDA")
-- O painel de conferência mostrou "Movimentação (0)", "Documento lido (0)" e
-- "Nenhuma atividade anterior". Não era verdade. Rodando na mão, com o lead
-- certo na mão:
--     process_updates do processo 0000369-39.2018.8.10.0121 ....  3
--     jm_documentos ................................. 53 (18 com resumo lido)
--     jm_decisoes .................................................  4
--     lead_activities do lead ..................................... 36
-- Estava tudo lá. O contexto veio vazio porque
-- dom_contexto_processual('120363405106042327@g.us') devolve
-- tem_vinculo=false: ela não encontrou o CLIENTE do grupo.
--
-- A CAUSA
-- A CTE `g` procura o vínculo grupo→lead em UMA tabela só,
-- `lead_whatsapp_groups`. Mas há um segundo lugar onde esse vínculo mora, e é
-- o do cadastro: `leads.whatsapp_group_id`. O Caso 09 tem o grupo lá
-- (120363405106042327@g.us) e NÃO tem linha na ponte. Para a RPC, o grupo não
-- pertence a ninguém.
--
-- NÃO É UM CASO ISOLADO. Medido em 07/09/2026 sobre `dom_grupos_piloto` ativo:
--     1.149 grupos no piloto do Dom
--       826 com linha na ponte ............. o Dom enxerga
--       167 sem ponte, com 1 ficha viva .... dá para resolver com segurança
--        40 sem ponte, com 2+ fichas ....... ambíguo, não dá para adivinhar
--       116 sem ponte e sem ficha nenhuma .. não há o que resolver
-- Ou seja: 323 grupos (28% do piloto) hoje geram rascunho SEM UM DADO do
-- processo — e o painel não avisa. Mostra "(0)", que a pessoa lê como "não
-- houve movimentação", quando o certo seria "não achei a ficha deste grupo".
-- Um número errado dito com confiança é pior que número nenhum.
--
-- O QUE MUDA
-- 1. `g` ganha uma SEGUNDA fonte, em ordem de prioridade:
--       1º  lead_whatsapp_groups  (a ponte explícita — continua mandando)
--       2º  leads.whatsapp_group_id, e SÓ quando existe EXATAMENTE UMA ficha
--           viva apontando para aquele grupo.
--    O "exatamente uma" é a trava do vazamento, e não é teórica: 904 jids do
--    cadastro apontam para mais de uma ficha (um chega a 18). Escolher "a mais
--    recente" ali seria contar a um cliente a movimentação de outro. Onde é
--    ambíguo, a resposta certa continua sendo não saber.
--
-- 2. O jsonb passa a devolver `vinculo`, para o painel poder dizer a verdade
--    em vez de "(0)":
--       fonte           'ponte' | 'cadastro_do_lead' | null
--       fichas_no_grupo quantas fichas vivas apontam para o grupo
--       ambiguo         true quando não resolveu POR HAVER MAIS DE UMA
--    Chave nova, nada removido: quem já lê tem_vinculo/grupo/lead_id continua
--    igual.
--
-- O QUE NÃO MUDA (de propósito)
--   * A ponte continua sendo a fonte preferida — o cadastro é só o degrau 2.
--   * Nada é escrito: a RPC resolve na leitura. Um backfill de
--     lead_whatsapp_groups congelaria hoje um vínculo que amanhã muda, e
--     precisaria de um segundo processo para não envelhecer.
--   * Ficha com deleted_at fica de fora dos dois degraus.
--   * Os 116 grupos sem ficha nenhuma continuam sem contexto — não há o que
--     inventar. Passam a aparecer com fichas_no_grupo = 0, que é o pedido de
--     cadastro, não um erro do Dom.
--
-- CUSTO. `dom_jid_curto(l.whatsapp_group_id)` não tem índice: EXPLAIN ANALYZE
-- em 07/09/2026 deu 18 ms varrendo 19.866 linhas de `leads` (23.984 no total).
-- São duas dessas varreduras por chamada, e a RPC roda uma vez por grupo por
-- rodada — ~40 ms x 1.149 grupos = ~45 s a mais por varredura completa. O
-- índice de expressão que zera isso está no fim do arquivo, SEPARADO e
-- comentado, porque criar índice em tabela grande é decisão do dono e pede
-- CONCURRENTLY fora de transação.
--
-- ROTA DE FUGA. `dom_contexto_processual_antes_vinculo_por_cadastro` guarda a
-- versão de agora, criada por este mesmo arquivo antes de qualquer alteração.
-- Rollback: ler o def dela, trocar o nome de volta e executar.
-- =============================================================================

-- ── 0. Rota de fuga, antes de mexer ──────────────────────────────────────────
do $mig$
declare def text; copia text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';
  if def is null then raise exception 'dom_contexto_processual não existe'; end if;

  copia := replace(def,
                   'FUNCTION public.dom_contexto_processual(',
                   'FUNCTION public.dom_contexto_processual_antes_vinculo_por_cadastro(');
  if copia = def then raise exception 'não achei o nome da função para copiar'; end if;
  execute copia;
end $mig$;

-- ── 1. A CTE `g` passa a ter dois degraus ────────────────────────────────────
do $mig$
declare
  def   text;
  velho text := $a$  with g as (
    select lg.lead_id, lg.group_name
    from lead_whatsapp_groups lg
    where dom_jid_curto(lg.group_jid) = dom_jid_curto(p_group_jid)
      and lg.lead_id is not null
    order by lg.created_at desc
    limit 1
  ),$a$;
  novo  text := $b$  with fichas as (
    -- Quantas fichas VIVAS apontam para este grupo. É a conta que decide se dá
    -- para resolver pelo cadastro ou se a resposta honesta é "não sei de quem
    -- é este grupo".
    select count(*) as n
    from leads l
    where l.deleted_at is null
      -- `whatsapp_group_id is not null` NAO e redundante: e o predicado do
      -- indice parcial idx_leads_jid_curto_do_grupo. Sem esta linha o planner
      -- nao prova que o indice cobre a consulta e volta para a varredura de
      -- 19.865 linhas. Medido em 07/09/2026, mesma consulta:
      --   sem a linha  18,064 ms  2.089 buffers
      --   com a linha   0,145 ms      3 buffers
      and l.whatsapp_group_id is not null
      and dom_jid_curto(l.whatsapp_group_id) = dom_jid_curto(p_group_jid)
  ),
  g as (
    select s.lead_id, s.group_name, s.fonte
    from (
      -- Degrau 1: a ponte explícita. Alguém ligou grupo e ficha de propósito.
      select lg.lead_id, lg.group_name, 'ponte'::text as fonte,
             1 as prioridade, lg.created_at as quando
      from lead_whatsapp_groups lg
      where dom_jid_curto(lg.group_jid) = dom_jid_curto(p_group_jid)
        and lg.lead_id is not null
      union all
      -- Degrau 2: o cadastro da ficha, e SÓ quando ela é a única. Com duas ou
      -- mais, escolher uma é sortear de quem é o processo — o vazamento que a
      -- trava do nullif() logo abaixo já evita do outro lado.
      select l.id, l.lead_name, 'cadastro_do_lead'::text,
             2, l.created_at
      from leads l
      where l.deleted_at is null
        and l.whatsapp_group_id is not null   -- idem: predicado do indice
        and dom_jid_curto(l.whatsapp_group_id) = dom_jid_curto(p_group_jid)
        and (select n from fichas) = 1
    ) s
    order by s.prioridade, s.quando desc
    limit 1
  ),$b$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';

  if position(velho in def) = 0 then
    raise exception 'não achei a CTE g original — NADA alterado';
  end if;

  execute replace(def, velho, novo);
end $mig$;

-- ── 2. O jsonb passa a contar COMO achou (ou por que não achou) ──────────────
do $mig$
declare
  def   text;
  velho text := $a$    'lead_id',     (select lead_id from g),$a$;
  novo  text := $b$    'lead_id',     (select lead_id from g),

    -- Sem isto o painel mostra "(0)" para dois casos opostos: "o processo não
    -- andou" e "não sei de quem é este grupo". Quem revisa lê os dois como o
    -- primeiro, e é assim que uma resposta nasce sem contexto sem ninguém ver.
    'vinculo', jsonb_build_object(
      'fonte',           (select fonte from g),
      'fichas_no_grupo', (select n from fichas),
      'ambiguo',         (not exists (select 1 from g)) and (select n from fichas) > 1
    ),$b$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';

  if position(velho in def) = 0 then
    raise exception 'não achei a chave lead_id — NADA alterado';
  end if;

  execute replace(def, velho, novo);
end $mig$;

comment on function public.dom_contexto_processual(text) is
  'Contexto do Dom. Vínculo grupo→ficha em dois degraus: lead_whatsapp_groups e, '
  'só quando há EXATAMENTE UMA ficha viva no grupo, leads.whatsapp_group_id. '
  'vinculo.fonte/fichas_no_grupo/ambiguo dizem como achou (ou por que não achou). '
  'parado_dias / parado_dias_efetivo = dias desde o último movimento (o segundo '
  'ignora categoria despacho). ultima_atividade.prazo_contato = deadline da '
  'atividade, só quando ainda não venceu. Ignora atividade com deleted_at.';

-- ── 3. O índice que paga a varredura ─────────────────────────────────────────
-- Rode À PARTE, fora de migration: CONCURRENTLY não vive dentro de transação.
-- Aplicado em 07/09/2026 com autorização do dono, índice válido (indisvalid).
--
--   create index concurrently if not exists idx_leads_jid_curto_do_grupo
--     on public.leads (dom_jid_curto(whatsapp_group_id))
--     where whatsapp_group_id is not null and deleted_at is null;
--
-- ARMADILHA, e ela mordeu na primeira tentativa: com o índice criado o planner
-- CONTINUOU varrendo — 18,064 ms, 2.089 buffers, `idx_leads_assigned_to`. O
-- índice é PARCIAL, e a consulta não afirmava `whatsapp_group_id is not null`;
-- `dom_jid_curto(x) = 'algo'` não prova `x is not null` para o planner. Com a
-- linha acrescentada (está nas duas consultas a `leads`, acima): 0,145 ms, 3
-- buffers, `Index Scan using idx_leads_jid_curto_do_grupo`. Quem mexer nessas
-- duas consultas e apagar a linha "redundante" devolve a varredura sem
-- perceber — o resultado continua certo, só fica 124x mais lento.
--
-- Rollback do índice: drop index concurrently idx_leads_jid_curto_do_grupo;

-- ── 4. Conferido em dados reais (07/09/2026, depois de aplicar) ──────────────
--   Caso 09 (120363405106042327, sem ponte, 1 ficha)
--     tem_vinculo true, fonte cadastro_do_lead, 1 processo,
--     3 andamentos, 6 documentos, 4 decisões, atividade
--     "Manifestar sobre o não pagamento da pensão", parado_dias 12.
--   Não-regressão: 15 grupos COM ponte, a versão nova contra a
--     dom_contexto_processual_antes_vinculo_por_cadastro — 0 diferenças em
--     lead_id, processos e ultima_atividade; 15/15 resolvendo pela ponte.
--   Sem ponte, por número de fichas:
--     1 ficha  → tem_vinculo true,  fonte cadastro_do_lead, contexto cheio
--     2+ fichas→ tem_vinculo false, ambiguo true,  contexto vazio (correto)
--     0 fichas → tem_vinculo false, ambiguo false, contexto vazio (correto)
