-- =============================================================================
-- Duas fichas no grupo, UM processo só — o Dom parava por ambiguidade que não
-- existia, e a resposta saiu sem uma linha dos autos.
--
-- O QUE FOI VISTO (08/09/2026, grupo "✅ Caso 335 | Eduardo x Fazenda Santa
-- Rita | Juaguaré - ES")
-- O painel de conferência mostrou "Movimentação (0)", "Documento lido (0)",
-- "Atividade anterior — não entrou", e o aviso "2 fichas de cliente apontam
-- para este grupo. O sistema não escolhe uma — seria sortear de quem é o
-- processo". A resposta sugerida ao cliente dizia:
--     "Agora, o processo está com o juiz para análise."
-- Não estava. Rodando na mão, no mesmo instante:
--     leads apontando para 120363404820441854 ................ 2
--       ccb3e8eb "Eduardo"             processo 0001723-93.2025.5.17.0191
--       0c4ad372 "EDUARDO SANTOS COSTA" processo 0001723-93.2025.5.17.0191
--     jm_documentos do CNJ, lidos com resumo ................. 8
--       o mais recente, 06/08/2026: "Despacho que designa audiência de
--       instrução presencial para 15/10/2026 às 12:00 horas"
--     process_pop_marcos .................................... 3
--     lead_activities das duas fichas ....................... 35 (20 + 15)
--     inss_admin_processes ................................... 1
-- Havia audiência marcada e laudo pericial atrasado. O assessor disse "com o
-- juiz para análise" porque não recebeu NADA — e o painel mostrou "(0)".
--
-- A CAUSA
-- A migration 20260907230000 acertou ao recusar sortear ficha: com 2+ fichas
-- vivas no mesmo jid, escolher "a mais recente" seria contar a um cliente a
-- movimentação de outro. Mas ela mediu a ambiguidade no lugar errado — contou
-- FICHAS, e o que o assessor precisa é do PROCESSO. Aqui as duas fichas são a
-- mesma pessoa duplicada e apontam para o MESMO CNJ. Não havia de quem sortear:
-- só existe um processo na órbita do grupo.
--
-- A METÁFORA. Duas etiquetas na mesma mala, com nomes escritos diferente. O
-- sistema se recusava a entregar a mala por não saber qual etiqueta valia —
-- sendo que as duas dão no mesmo dono e na mesma mala.
--
-- MEDIDO em 08/09/2026, sobre dom_grupos_piloto ativo:
--     1.149 grupos no piloto
--       993 com ponte ....................... o Dom já enxerga
--         0 sem ponte com 1 ficha ........... (os 167 de 07/09 já foram ligados)
--        40 sem ponte com 2+ fichas ........ TRAVADOS hoje, e destes:
--             10  todas as fichas com processo caem no MESMO CNJ  → destrava
--              4  CNJs realmente diferentes                       → continua
--             26  nenhuma ficha tem processo                      → continua
--       116 sem ficha nenhuma ............... continua, não há o que inventar
--
-- O QUE MUDA
-- 1. `candidatas` ganha o DEGRAU 3, "fichas_do_mesmo_processo": quando há 2+
--    fichas e o conjunto de CNJ distintos na órbita do grupo tem TAMANHO 1,
--    entram as fichas que têm processo. Não é sorteio: não existe segundo
--    processo para confundir.
-- 2. `gs` é o conjunto de fichas do degrau vencedor, e SÓ o degrau 3 agrega.
--    Isso não é preciosismo: 401 grupos COM ponte têm 2+ lead_id na ponte, e
--    agregar no degrau 1 mudaria os 401 de uma vez. Degraus 1 e 2 continuam
--    com uma ficha só, byte a byte como hoje.
-- 3. `proc` deduplica por CNJ (`distinct on`). Achado de brinde na conferência:
--    havia grupo mandando o MESMO processo 3x no prompt, com os 6 documentos e
--    os 8 andamentos repetidos junto — ficha com linhas duplicadas em
--    lead_processes. O `coalesce(..., 'lp:'||id)` mantém separadas as linhas de
--    número inválido, que o nullif() transforma em NULL: sem ele, três fichas
--    com process_number "." colapsariam numa só.
-- 4. `vinculo` ganha `fichas_usadas`. Sem isso o painel diria "resolvido" sem
--    dizer que 2 fichas apontam para o grupo e quantas entraram — que é
--    exatamente a informação que o revisor precisa para desconfiar.
--
-- O QUE NÃO MUDA (de propósito)
--   * A ponte continua mandando. Degrau 2 (ficha única no cadastro) idem.
--   * `grupo_processo_detectado` NÃO é usada como fonte de vínculo. O CNJ que
--     ela guarda para este grupo tem status `eco_da_casa`: foi a nossa própria
--     equipe/robô que escreveu o número no grupo. Vincular por ali é o sistema
--     lendo a saída dele mesmo como entrada — a migration 20260907112738 já
--     documentou e proibiu, e continua proibido.
--   * Nada é escrito. A RPC resolve na leitura.
--   * As fichas duplicadas CONTINUAM duplicadas. Isto aqui faz o Dom parar de
--     errar; o conserto do dado (fundir as fichas) é outra esteira, é escrita
--     em produção e é Modo Leopardo — só com aval explícito.
--
-- CONFERIDO EM DADOS REAIS (08/09/2026, com a função paralela _v2)
--   Caso 335, antes:  tem_vinculo false, ambiguo true, 0 processos, 0 docs
--   Caso 335, depois: tem_vinculo true, fonte fichas_do_mesmo_processo,
--                     fichas_usadas 2/2, 1 processo, 6 peças lidas,
--                     fase "Alvará expedido", atividade "RECURSO ORDINÁRIO"
--   Não-regressão em 75 grupos do piloto (offsets 0, 100, 400 e 900):
--     0 perderam vínculo · 0 perderam processo distinto ·
--     0 mudaram atividade em grupo que já resolvia ·
--     4 destravaram pelo degrau 3 (false→true) ·
--     2 tiveram processo repetido colapsado (3→2 e 3→1), sem perder nenhum CNJ
--
-- ROTA DE FUGA. `dom_contexto_processual_antes_do_degrau_3` guarda a versão de
-- agora, criada por este mesmo arquivo antes de qualquer alteração.
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
                   'FUNCTION public.dom_contexto_processual_antes_do_degrau_3(');
  if copia = def then raise exception 'não achei o nome da função para copiar'; end if;
  execute copia;
end $mig$;

-- ── 1. O degrau 3 e o conjunto de fichas ─────────────────────────────────────
do $mig$
declare
  def text; ini int; fim int; novo text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';

  ini := position('  with fichas as (' in def);
  fim := position('  proc as (' in def);
  if ini = 0 or fim = 0 or fim <= ini then
    raise exception 'âncoras do cabeçalho não encontradas — NADA alterado';
  end if;

  novo := $h$  with fichas as (
    -- Todas as fichas VIVAS que apontam para este grupo pelo cadastro.
    -- `whatsapp_group_id is not null` NAO e redundante: e o predicado do indice
    -- parcial idx_leads_jid_curto_do_grupo (0,145 ms contra 18 ms sem ele).
    select l.id as lead_id, l.lead_name, l.created_at
    from leads l
    where l.deleted_at is null
      and l.whatsapp_group_id is not null
      and dom_jid_curto(l.whatsapp_group_id) = dom_jid_curto(p_group_jid)
  ),
  n_fichas as (select count(*) as n from fichas),
  cnjs_do_grupo as (
    -- Quantos processos DISTINTOS existem na orbita deste grupo.
    select distinct nullif(dom_so_digitos(lp.process_number), '') as cnj
    from fichas f
    join lead_processes lp on lp.lead_id = f.lead_id and lp.deleted_at is null
    where nullif(dom_so_digitos(lp.process_number), '') is not null
  ),
  candidatas as (
    select lg.lead_id, lg.group_name, 'ponte'::text as fonte,
           1 as prioridade, lg.created_at as quando
    from lead_whatsapp_groups lg
    where dom_jid_curto(lg.group_jid) = dom_jid_curto(p_group_jid)
      and lg.lead_id is not null
    union all
    select f.lead_id, f.lead_name, 'cadastro_do_lead'::text, 2, f.created_at
    from fichas f
    where (select n from n_fichas) = 1
    union all
    -- Degrau 3: varias fichas, UM processo so. Nao ha o que sortear.
    select f.lead_id, f.lead_name, 'fichas_do_mesmo_processo'::text, 3, f.created_at
    from fichas f
    where (select n from n_fichas) > 1
      and (select count(*) from cnjs_do_grupo) = 1
      and exists (select 1 from lead_processes lp
                   where lp.lead_id = f.lead_id and lp.deleted_at is null
                     and nullif(dom_so_digitos(lp.process_number), '') is not null)
  ),
  degrau as (select min(prioridade) as p from candidatas),
  g as (
    select c.lead_id, c.group_name, c.fonte
    from candidatas c
    order by c.prioridade, c.quando desc
    limit 1
  ),
  gs as (
    -- SO o degrau 3 agrega. Degraus 1 e 2 continuam com uma ficha so.
    select c.lead_id from candidatas c, degrau d where c.prioridade = d.p and d.p = 3
    union
    select g.lead_id from g
  ),
$h$;

  def := left(def, ini-1) || novo || substring(def from fim);

  v_old := '    from lead_processes p
    join g on g.lead_id = p.lead_id
    where p.process_number is not null
      and p.deleted_at is null
  ),';
  v_new := '    from lead_processes p
    join gs on gs.lead_id = p.lead_id
    where p.process_number is not null
      and p.deleted_at is null
    order by coalesce(nullif(dom_so_digitos(p.process_number), ''''), ''lp:'' || p.id::text),
             p.updated_at desc nulls last, p.id
  ),';
  if position(v_old in def) = 0 then raise exception 'âncora proc/join g não encontrada'; end if;
  def := replace(def, v_old, v_new);

  v_old := '    select p.id, p.process_number,';
  v_new := '    select distinct on (coalesce(nullif(dom_so_digitos(p.process_number), ''''), ''lp:'' || p.id::text))
           p.id, p.process_number,';
  if position(v_old in def) = 0 then raise exception 'âncora select p.id não encontrada'; end if;
  def := replace(def, v_old, v_new);

  v_old := '      from lead_activities a
      join g on g.lead_id = a.lead_id';
  if position(v_old in def) = 0 then raise exception 'âncora atividade não encontrada'; end if;
  def := replace(def, v_old, '      from lead_activities a
      join gs on gs.lead_id = a.lead_id');

  v_old := '      from inss_admin_processes i
      join g on g.lead_id = i.lead_id';
  if position(v_old in def) = 0 then raise exception 'âncora inss não encontrada'; end if;
  def := replace(def, v_old, '      from inss_admin_processes i
      join gs on gs.lead_id = i.lead_id');

  v_old := '      ''fichas_no_grupo'', (select n from fichas),';
  v_new := '      ''fichas_no_grupo'', (select n from n_fichas),
      ''fichas_usadas'',   (select count(*) from gs),';
  if position(v_old in def) = 0 then raise exception 'âncora fichas_no_grupo não encontrada'; end if;
  def := replace(def, v_old, v_new);

  v_old := 'and (select n from fichas) > 1';
  if position(v_old in def) = 0 then raise exception 'âncora ambiguo não encontrada'; end if;
  def := replace(def, v_old, 'and (select n from n_fichas) > 1');

  execute def;
end $mig$;

comment on function public.dom_contexto_processual(text) is
  'Contexto do Dom. Vínculo grupo→ficha em três degraus: lead_whatsapp_groups; '
  'leads.whatsapp_group_id quando há EXATAMENTE UMA ficha viva; e, com 2+ fichas, '
  'as fichas com processo quando o grupo tem UM ÚNICO CNJ na órbita '
  '(fonte fichas_do_mesmo_processo) — não é sorteio, não existe segundo processo. '
  'Só esse terceiro degrau agrega mais de uma ficha. processos deduplicados por CNJ. '
  'vinculo.fonte/fichas_no_grupo/fichas_usadas/ambiguo dizem como achou (ou por que não). '
  'parado_dias / parado_dias_efetivo = dias desde o último movimento (o segundo '
  'ignora categoria despacho). ultima_atividade.prazo_contato = deadline da '
  'atividade, só quando ainda não venceu. Ignora atividade com deleted_at.';

-- ── 2. Limpeza da função paralela usada na conferência ───────────────────────
drop function if exists public.dom_contexto_processual_v2(text);
