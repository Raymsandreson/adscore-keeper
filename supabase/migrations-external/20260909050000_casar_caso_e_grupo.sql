-- =============================================================================
-- Passo 1 de "o grupo é o caso": casar caso ↔ grupo pelo número, e listar o
-- que sobra numa fila com evidência.
--
-- O QUE O RAYM PEDIU (09/09/2026): a palavra "caso" tem que sumir; o nome do
-- caso é o nome do grupo do WhatsApp; unificar. Antes de tirar qualquer coisa,
-- os dois lados precisam apontar para o mesmo lead (grupo → lead ← caso).
--
-- O QUE A LEITURA MOSTROU (09/09/2026, banco real)
--   * legal_cases.case_number tem DUAS numerações misturadas:
--       "PREV 1939", "CASO 231", "Família 304", "516"  → o número do grupo;
--       "CASO-0465", "DG-0017", "SM-0001"              → sequência interna,
--         criada pelo sistema (400 de 501 sem criador), com o nome do lead como
--         título, 3 por lead; CASO-0465/0466/0467 apontam todos para o grupo
--         "LEAD 0001". Casar isso pelo número é colisão falsa (93 dos 107
--         "duplicados" eram isso). Fica FORA da chave.
--   * "Família 231" (grupo) e "CASO 231" (caso) são a mesma numeração: 83 de
--     90 batem. CASO ≡ FAMÍLIA na chave. "516" (caso sem prefixo) casa com o
--     grupo de qualquer família, desde que só um grupo de caso tenha o número.
--   * Onde o grupo tem ponte para o lead X e o caso com o mesmo número está no
--     lead Y (268 grupos, 256 PREV): Y tem os processos (255 de 268) e X é quem
--     fala no grupo (41 vs 1). É o mesmo caso rachado em dois leads — o mesmo
--     defeito do CASO 398. Não se automatiza: vai para a fila com a evidência.
--
-- O QUE ESTE ARQUIVO CRIA
--   1. caso_chave(texto, estrito) — a chave (fam, numero, sufixo) normalizada:
--      CASO/FAMÍLIA → 'CASO'; formato "XXX-0000" → nenhuma chave.
--   2. vw_caso_grupo_conciliacao — uma linha por grupo de caso (PREV/CASO/
--      FAMÍLIA com número no nome) e uma por caso sem grupo com a chave, com a
--      classe e a evidência (lead de cada lado, processos, cadastro).
--   3. casar_caso_grupo(grupo?) — cria a ponte grupo → lead do caso nas classes
--      'casavel_*' (um caso com a chave, lead vivo, nenhum outro lead no grupo,
--      lead sem outro grupo). auto_linked = true, audit source 'casar_caso_grupo'.
--      NÃO roda sozinha nesta migration: o Raym vê a contagem e diz "pode".
--   4. resolver_caso_grupo(grupo, decisao) — a fila com 1 clique:
--      'ligar_ao_lead_do_caso' cria a ponte (auto_linked = false, source
--      'fila_caso_grupo'). A ponte mais nova é a que vale (é assim que o Dom, o
--      resolver_processo_citado e a tela do grupo já leem). A antiga fica, e o
--      grupo passa a mostrar "2 leads no grupo" — que é a verdade até alguém
--      juntar os leads.
--
-- O QUE NÃO MUDA
--   * Nenhuma linha de legal_cases, leads ou lead_processes. Só pontes novas.
--   * Nenhuma ponte apagada. A tela do grupo continua lendo a mais nova.
--   * Não existe "não é" aqui ainda: sem tabela de decisão (o Raym não quer
--     objeto novo), a linha só sai da fila quando a cadeia fecha.
--
-- CUSTO. A view anda por whatsapp_groups_index (30k linhas → 6.7k grupos); a
-- regex cara só roda nos nomes que passam por '(prev|caso|fam|lead)'. Medido
-- 09/09 (explain analyze): 1,67 s, 2.603 linhas. Carrega ao abrir a fila e uma
-- contagem ao abrir a aba Grupos.
--
-- ESTADO EM 09/09/2026 (estrutura APLICADA com aval). casar_caso_grupo() RODOU
-- às 15:45 UTC com aval do Raym: 125 pontes (log casar_caso_grupo = 125, todas
-- auto_linked, reversíveis pelo delete do rodapé); 928 linhas ficam na fila.
-- Depois: casado 896, casável 0, nenhuma outra classe mudou. O Dom acha o lead
-- pela ponte nos 125; traz processo em 31 e INSS em 3 — os outros 91 têm lead
-- sem processo com número cadastrado (52 leads só com linha administrativa
-- sem número). Isso é cadastro de processo, não vínculo.
-- Contagem antes de rodar:
--   lado grupo (2.477 grupos PREV/CASO/FAMÍLIA com número)
--     casado 771 · lead_sem_caso 779 · leads_diferentes 272 · grupo_sem_lead 270
--     grupo_com_varios_leads_sem_caso 101 · casavel_cadastro_bate 99
--     numero_divergente 63 · grupo_com_varios_leads 44 · caso_duplicado 26
--     casavel_sem_cadastro 26 · lead_do_caso_tem_outro_grupo 12
--     caso_sem_lead 8 · leads_diferentes_no_cadastro 6
--   lado caso (126 casos com chave e sem grupo)
--     caso_sem_grupo_lead_tem_outro 67 · grupo_ainda_lead 50 · caso_sem_grupo 9
--   casar_caso_grupo() em transação com rollback: 125 pontes (99 + 26), todas
--   viraram 'casado'; nenhuma outra classe mudou.
--   resolver_caso_grupo em 'leads_diferentes' (rollback): classe → casado,
--   2 pontes no grupo, log fila_caso_grupo, auto_linked = false.
--
-- ROTA DE FUGA
--   delete from lead_whatsapp_groups w
--    where w.auto_linked and exists (select 1 from lead_group_audit_log a
--            where a.source = 'casar_caso_grupo' and a.lead_id = w.lead_id
--              and jid_chave(a.group_jid) = jid_chave(w.group_jid));
--   (idem com source = 'fila_caso_grupo' para as decisões de gente)
--   drop function resolver_caso_grupo(text, text); drop function casar_caso_grupo(text);
--   drop view vw_caso_grupo_conciliacao; drop function caso_chave(text, boolean);
-- =============================================================================

-- ── 1. A chave ───────────────────────────────────────────────────────────────
create or replace function public.caso_chave(p_txt text, p_estrito boolean default false)
returns table(fam text, numero integer, sufixo text)
language sql
immutable
as $$
  select case when k.familia in ('CASO', 'FAMILIA') then 'CASO' else k.familia end,
         k.numero,
         nullif(k.sufixo, '')
    from public.busca_chave_caso(p_txt, p_estrito) k
   where coalesce(p_txt, '') !~ '^[^A-Za-z0-9]*[A-Za-z]+-[0-9]{3,4}[[:space:]]*$';
$$;

comment on function public.caso_chave(text, boolean) is
  'Chave do caso a partir de um texto (nome do grupo ou legal_cases.case_number): '
  '(fam, numero, sufixo). CASO e FAMÍLIA viram CASO; fam nulo = sem prefixo. '
  'Formato "CASO-0465" (sequência interna do sistema) não gera chave.';

-- ── 2. A conciliação ─────────────────────────────────────────────────────────
create or replace view public.vw_caso_grupo_conciliacao as
with grupo_bruto as (
  select distinct on (jid_chave(g.group_jid))
         g.group_jid, jid_chave(g.group_jid) as chave, g.contact_name as group_name
    from whatsapp_groups_index g
   order by jid_chave(g.group_jid), g.last_seen desc nulls last, g.updated_at desc nulls last
),
-- a chave (regex cara) só nos nomes que podem ter uma: a regex barata vem antes.
-- Medido 09/09: com a chave em todas as 30k linhas do índice, 5,4 s; assim, ver rodapé.
grupo as (
  select b.*, k.fam, k.numero, k.sufixo
    from grupo_bruto b
    left join lateral caso_chave(case when b.group_name ~* '(prev|caso|fam|lead)' then b.group_name end, false) k on true
),
grupo_de_caso as (
  select * from grupo where fam in ('PREV', 'CASO') and numero is not null
),
ponte as (
  select distinct on (jid_chave(group_jid)) jid_chave(group_jid) as chave, lead_id
    from lead_whatsapp_groups
   where lead_id is not null
   order by jid_chave(group_jid), created_at desc
),
cadastro as (
  select jid_chave(whatsapp_group_id) as chave,
         case when count(*) = 1 then (array_agg(id))[1] end as lead_id,
         count(*) as n
    from leads
   where deleted_at is null and whatsapp_group_id is not null
   group by 1
),
caso as (
  select c.id, c.lead_id, c.case_number, k.fam, k.numero, k.sufixo
    from legal_cases c
    join lateral caso_chave(c.case_number, true) k on true
   where c.deleted_at is null and k.numero is not null
),
-- cada par (grupo de caso, caso com a mesma chave). Caso sem prefixo casa com
-- qualquer família, desde que só um grupo de caso tenha aquele número.
par as (
  select g.chave, c.id as caso_id, c.lead_id, c.case_number
    from grupo_de_caso g
    join caso c on c.numero = g.numero and c.sufixo is not distinct from g.sufixo
              and (c.fam = g.fam
                   or (c.fam is null and (select count(*) from grupo_de_caso x
                                            where x.numero = g.numero and x.sufixo is not distinct from g.sufixo) = 1))
),
-- um agregado por grupo, em vez de quatro subconsultas correlacionadas por linha
par_agg as (
  select chave, count(*) as n_casos,
         (array_agg(caso_id     order by case_number))[1] as caso_id,
         (array_agg(case_number order by case_number))[1] as case_number,
         (array_agg(lead_id     order by case_number))[1] as lead_caso
    from par
   group by chave
),
g2 as (
  select g.*,
         p.lead_id as lead_ponte, cd.lead_id as lead_cadastro, coalesce(cd.n, 0) as n_cadastro,
         coalesce(p.lead_id, cd.lead_id) as lead_grupo,
         coalesce(pa.n_casos, 0) as n_casos, pa.caso_id, pa.case_number, pa.lead_caso
    from grupo_de_caso g
    left join ponte p on p.chave = g.chave
    left join cadastro cd on cd.chave = g.chave
    left join par_agg pa on pa.chave = g.chave
),
lado_grupo as (
  select g2.*,
    case
      when n_casos = 0 and lead_grupo is null and n_cadastro > 1 then 'grupo_com_varios_leads_sem_caso'
      when n_casos = 0 and lead_grupo is null then 'grupo_sem_lead'
      when n_casos = 0 and not exists (select 1 from caso c where c.lead_id = g2.lead_grupo) then 'lead_sem_caso'
      when n_casos = 0 then 'numero_divergente'
      when n_casos > 1 then 'caso_duplicado'
      when lead_caso is null then 'caso_sem_lead'
      when lead_ponte = lead_caso then 'casado'
      when lead_ponte is not null then 'leads_diferentes'
      when not exists (select 1 from leads l where l.id = lead_caso and l.deleted_at is null) then 'lead_do_caso_apagado'
      when lead_cadastro is not null and lead_cadastro <> lead_caso then 'leads_diferentes_no_cadastro'
      when n_cadastro > 1 then 'grupo_com_varios_leads'
      when exists (select 1 from lead_whatsapp_groups w
                    where w.lead_id = lead_caso and jid_chave(w.group_jid) <> g2.chave) then 'lead_do_caso_tem_outro_grupo'
      when lead_cadastro = lead_caso then 'casavel_cadastro_bate'
      else 'casavel_sem_cadastro'
    end as classe
  from g2
),
lado_caso as (
  select c.*,
         lg.chave as chave_grupo_do_lead, lg.group_name as grupo_do_lead, lg.fam as fam_grupo_do_lead, lg.numero as numero_grupo_do_lead,
    case
      when c.lead_id is null then 'caso_sem_lead'
      when lg.fam = 'LEAD' and lg.numero = c.numero then 'grupo_ainda_lead'
      when lg.chave is not null then 'caso_sem_grupo_lead_tem_outro'
      else 'caso_sem_grupo'
    end as classe
    from caso c
    left join lateral (select g.chave, g.group_name, g.fam, g.numero
                         from lead_whatsapp_groups w
                         join grupo g on g.chave = jid_chave(w.group_jid)
                        where w.lead_id = c.lead_id
                        order by w.created_at desc limit 1) lg on true
   where not exists (select 1 from par x where x.caso_id = c.id)
),
tudo as (
  select 'grupo'::text as lado, g.group_jid, g.chave, g.group_name, g.fam, g.numero, g.sufixo,
         g.caso_id, g.case_number, g.n_casos, g.n_cadastro,
         g.lead_grupo as lead_grupo_id,
         case when g.lead_ponte is not null then 'ponte' when g.lead_cadastro is not null then 'cadastro' end as lead_grupo_via,
         g.lead_caso as lead_caso_id, g.classe
    from lado_grupo g
  union all
  select 'caso', null, c.chave_grupo_do_lead, c.grupo_do_lead, c.fam, c.numero, c.sufixo,
         c.id, c.case_number, 0, 0,
         null, null, c.lead_id, c.classe
    from lado_caso c
)
select t.lado, t.group_jid, t.chave, t.group_name, t.fam, t.numero, t.sufixo,
       coalesce(t.fam, '?') || ' ' || t.numero || coalesce('.' || t.sufixo, '') as chave_txt,
       t.caso_id, t.case_number, t.n_casos, t.n_cadastro as n_leads_cadastrados,
       t.lead_grupo_id, lg.lead_name as lead_grupo_nome, t.lead_grupo_via, lg.case_number as lead_grupo_case_number,
       (select count(*) from lead_processes p where p.lead_id = t.lead_grupo_id and p.deleted_at is null) as lead_grupo_processos,
       t.lead_caso_id, lc.lead_name as lead_caso_nome, lc.case_number as lead_caso_case_number,
       (select count(*) from lead_processes p where p.lead_id = t.lead_caso_id and p.deleted_at is null) as lead_caso_processos,
       t.classe,
       case t.classe
         when 'casado'                          then 'Nada a fazer: grupo e caso apontam para o mesmo lead.'
         when 'casavel_cadastro_bate'           then 'Um caso com o número, e o lead dele já cadastra este grupo. Só falta a ponte — "Ligar" ou casar_caso_grupo().'
         when 'casavel_sem_cadastro'            then 'Um caso com o número, lead vivo, nada contradiz. "Ligar" cria a ponte.'
         when 'leads_diferentes'                then 'A ponte do grupo aponta para um lead; o caso com o número está em outro. Veja quem tem os processos e decida "Ligar ao lead do caso" — ou junte os leads.'
         when 'leads_diferentes_no_cadastro'    then 'Sem ponte; outro lead cadastra este grupo; o caso está num terceiro. Confira antes de ligar.'
         when 'grupo_com_varios_leads'          then 'Mais de um lead cadastra este grupo. Escolha o lead do grupo (Vincular) antes de ligar.'
         when 'lead_do_caso_tem_outro_grupo'    then 'O lead do caso já tem ponte com outro grupo. Se este é o grupo certo, "Ligar" — o grupo mais novo passa a valer.'
         when 'caso_duplicado'                  then 'Mais de um caso vivo com este número. Apague ou renumere o errado em Casos.'
         when 'caso_sem_lead'                   then 'O caso existe sem lead. Ligue o caso a um lead em Casos.'
         when 'lead_do_caso_apagado'            then 'O lead do caso foi apagado. Reaponte o caso para um lead vivo.'
         when 'numero_divergente'               then 'O lead do grupo tem caso com OUTRO número. Renomeie o grupo ou corrija o nº do caso.'
         when 'lead_sem_caso'                   then 'O lead do grupo não tem legal_case. Sob "grupo é o caso", não é pendência.'
         when 'grupo_sem_lead'                  then 'Grupo de caso sem lead nenhum. Vincular (botão do grupo).'
         when 'grupo_com_varios_leads_sem_caso' then 'Vários leads cadastram este grupo e nenhum tem caso com o número. Escolha o lead (Vincular).'
         when 'grupo_ainda_lead'                then 'O grupo do lead ainda se chama "LEAD N" com o mesmo número do caso. Renomeie o grupo para PREV N.'
         when 'caso_sem_grupo_lead_tem_outro'   then 'Nenhum grupo com este número; o lead do caso está noutro grupo. Renomeie o grupo ou corrija o nº do caso.'
         when 'caso_sem_grupo'                  then 'Nenhum grupo com este número e o lead não tem grupo. Crie/vincule o grupo do caso.'
       end as o_que_fazer
  from tudo t
  left join leads lg on lg.id = t.lead_grupo_id
  left join leads lc on lc.id = t.lead_caso_id;

comment on view public.vw_caso_grupo_conciliacao is
  'Passo 1 de "o grupo é o caso" (09/09/2026): cada grupo de caso (PREV/CASO/FAMÍLIA com número) '
  'contra o legal_case com a mesma chave, e cada caso sem grupo. Classe + evidência dos dois lados. '
  'Chave: caso_chave(). "CASO-0465" (sequência interna) fica fora.';

grant select on public.vw_caso_grupo_conciliacao to authenticated, service_role;

-- ── 3. Casar o que bate ──────────────────────────────────────────────────────
create or replace function public.casar_caso_grupo(p_group_jid text default null)
returns table(pontes_criadas integer, deixados_na_fila integer)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  r     record;
  v_n   integer := 0;
  v_ins integer;
  v_fila integer;
begin
  for r in
    select v.chave, v.group_name, v.lead_caso_id
      from vw_caso_grupo_conciliacao v
     where v.lado = 'grupo'
       and (p_group_jid is null or v.chave = jid_chave(p_group_jid))
       and v.classe in ('casavel_cadastro_bate', 'casavel_sem_cadastro')
  loop
    insert into lead_whatsapp_groups (lead_id, group_jid, group_name, auto_linked)
    values (r.lead_caso_id, r.chave || '@g.us', r.group_name, true)
    on conflict do nothing;
    get diagnostics v_ins = row_count;
    if v_ins > 0 then
      insert into lead_group_audit_log (action, group_jid, group_name, lead_id, lead_name, result, source)
      select 'link', r.chave || '@g.us', r.group_name, l.id, l.lead_name, 'success', 'casar_caso_grupo'
        from leads l where l.id = r.lead_caso_id;
      v_n := v_n + 1;
    end if;
  end loop;

  select count(*) into v_fila
    from vw_caso_grupo_conciliacao v
   where (p_group_jid is null or v.chave = jid_chave(p_group_jid))
     and v.classe not in ('casado', 'lead_sem_caso');

  return query select v_n, v_fila;
end $fn$;

comment on function public.casar_caso_grupo(text) is
  'Cria a ponte grupo → lead do caso onde a chave bate sem contradição (classes casavel_*). '
  'auto_linked = true; lead_group_audit_log.source = casar_caso_grupo. Sem argumento: todos os grupos.';

grant execute on function public.casar_caso_grupo(text) to authenticated, service_role;

-- ── 4. A fila, com 1 clique ──────────────────────────────────────────────────
create or replace function public.resolver_caso_grupo(p_group_jid text, p_decisao text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_jid text := jid_chave(p_group_jid);
  v     record;
  v_ins integer;
begin
  if p_decisao <> 'ligar_ao_lead_do_caso' then
    raise exception 'decisão inválida: %', p_decisao;
  end if;

  select * into v from vw_caso_grupo_conciliacao x where x.lado = 'grupo' and x.chave = v_jid;
  if not found then
    raise exception 'Este grupo não está na conciliação (sem número de caso no nome?).';
  end if;
  if v.classe not in ('casavel_cadastro_bate', 'casavel_sem_cadastro', 'leads_diferentes',
                      'leads_diferentes_no_cadastro', 'lead_do_caso_tem_outro_grupo') then
    raise exception 'Não dá para ligar daqui: %', v.o_que_fazer;
  end if;
  if v.lead_caso_id is null then
    raise exception 'O caso não tem lead. Ligue o caso a um lead primeiro.';
  end if;

  insert into lead_whatsapp_groups (lead_id, group_jid, group_name, auto_linked)
  values (v.lead_caso_id, v_jid || '@g.us', v.group_name, false)
  on conflict do nothing;
  get diagnostics v_ins = row_count;
  if v_ins > 0 then
    insert into lead_group_audit_log (action, group_jid, group_name, lead_id, lead_name, result, source)
    values ('link', v_jid || '@g.us', v.group_name, v.lead_caso_id, v.lead_caso_nome, 'success', 'fila_caso_grupo');
  end if;

  return jsonb_build_object('ok', true, 'acao', 'grupo_ligado_ao_lead_do_caso',
                            'lead_id', v.lead_caso_id, 'ponte_nova', v_ins > 0,
                            'tinha_outro_lead', v.lead_grupo_id is not null and v.lead_grupo_id <> v.lead_caso_id);
end $fn$;

comment on function public.resolver_caso_grupo(text, text) is
  'Fila caso ↔ grupo, 1 clique. ligar_ao_lead_do_caso: ponte grupo → lead do caso (auto_linked = false, '
  'source fila_caso_grupo). A ponte mais nova passa a valer; a antiga fica — o grupo mostra 2 leads até alguém juntar.';

grant execute on function public.resolver_caso_grupo(text, text) to authenticated, service_role;
