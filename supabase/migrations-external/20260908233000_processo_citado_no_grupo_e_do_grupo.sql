-- =============================================================================
-- Processo citado no grupo PELA EQUIPE é processo do grupo.
--
-- DEPENDE de 20260908183000_duas_fichas_um_processo_so.sql (o degrau 3):
-- os patches da RPC abaixo ancoram no texto que aquela migration deixa.
-- Aplicar na ordem. Se a âncora não bater, o bloco aborta sem alterar nada.
--
-- A DECISÃO (Raym, 08/09/2026)
-- "Se o processo está no grupo é porque faz parte do caso — principalmente
-- nas mensagens de notificação, de como está, o que foi feito e o próximo
-- passo, que informam o número do processo e o assunto."
-- Conferido no código: a frase "Referente ao processo n° X de Y" sai SÓ do
-- front (buildActivityMessage.ts), quando UMA PESSOA conclui a atividade e
-- clica em notificar. Nenhum cron, nenhuma edge function manda isso. Cada
-- citação da equipe é uma pessoa dizendo "este processo é deste grupo", no
-- momento em que trabalhou nele. No CASO 398 a pessoa notificou o grupo
-- certo mesmo com o lead errado — a citação foi melhor evidência que o lead.
--
-- A objeção de 20260907112738 ("eco da casa") valia para número inventado.
-- Hoje, das 295 citações da equipe ainda não vinculadas, 295 passam no
-- dígito verificador (cnj_valido). Zero inventadas.
--
-- MAS "citado pela equipe" sozinho NÃO basta. Nas divergências há citação
-- errada: grupo "Caso 188 – Elias" cita o processo de "Caso 29 – Ivanilde".
-- A trava é a convenção que a própria equipe usa: o NÚMERO DO CASO no nome
-- do grupo tem que bater com o do lead dono do processo (busca_chave_caso).
-- "Caso 223.1 – filho" ↔ "Caso 223 – Antônio" bate; "188" ↔ "29" não.
--
-- MEDIDO em 08/09/2026, citações da equipe válidas com dono conhecido:
--   A. grupo SEM lead, 1 dono, número bate ....... 32 cit / 27 grupos → liga
--   B. grupo SEM lead, número não bate/sem número .  3 /  3 → fila
--   C. grupo COM lead, número bate (paralela) .... 122 / 98 → processo do grupo
--   D. grupo COM lead, número NÃO bate ............ 27 / 22 → fila
--   E. sem lead, 2+ donos ..........................  2 /  2 → fila
--   + 34 citações de processo ÓRFÃO (lead nulo, importação de agosto) e
--     81 de processo que não existe em lugar nenhum → fila (processo_orfao)
--
-- O QUE MUDA
-- 1. Status novo em grupo_processo_detectado: 'processo_do_grupo'. A tabela
--    do detector passa a ser a memória "este processo é deste grupo". Não é
--    tabela nova — é a que já existe, com um estado a mais.
-- 2. vincular_processos_citados_no_grupo(): aplica A e C. Em A grava a
--    ponte (lead_whatsapp_groups, auto_linked) e o log de auditoria. Em C
--    não toca na ponte: o grupo já tem lead; quem decide juntar leads é gente.
-- 3. detectar_processos_em_grupos: a re-varredura não apaga
--    'processo_do_grupo' (o ON CONFLICT preservava só datas).
-- 4. dom_contexto_processual: `proc` = processos do lead ∪ processos
--    'processo_do_grupo' deste grupo. Cada processo diz de onde veio
--    (origem_vinculo: 'lead' | 'citado_no_grupo'); vinculo.processos_citados
--    conta. Tudo o que pende do CNJ (peças, movimentações, decisões,
--    audiências) flui sozinho.
-- 5. vw_grupo_processo_conciliacao: casava group_jid por texto exato — ponte
--    sem @g.us, índice com @g.us → a coluna "Processo" da lista de grupos
--    ficava "—" (CASO 398). Passa a casar por jid_chave e inclui os
--    processos do grupo.
-- 6. rodar_processos_citados_no_grupo(): re-varre só grupos com mensagem
--    nova que parece CNJ (dirigido pelo índice de created_at, não por grupo),
--    roda o detector e o vinculador. Cron de hora em hora.
--
-- O QUE NÃO MUDA (de propósito)
--   * Citação do CLIENTE continua sugestão (status sugerido/divergente...).
--   * Ponte existente nunca é trocada nem apagada por aqui.
--   * Nada em lead_processes: processo órfão continua órfão até gente olhar.
--
-- ROTA DE FUGA
--   * dom_contexto_processual_antes_do_processo_do_grupo guarda a RPC de antes.
--   * detectar_processos_em_grupos_antes_do_processo_do_grupo idem.
--   * select cron.unschedule('processos-citados-no-grupo');
--   * Desfazer os vínculos automáticos: as pontes têm auto_linked = true e o
--     log tem source = 'vincular_processos_citados_no_grupo';
--       delete from lead_whatsapp_groups where id in (select ... por log);
--       update grupo_processo_detectado set status = 'eco_da_casa'
--        where status = 'processo_do_grupo';
-- =============================================================================

-- ── 0. Rotas de fuga ─────────────────────────────────────────────────────────
do $mig$
declare def text; copia text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';
  if def is null then raise exception 'dom_contexto_processual não existe'; end if;
  copia := replace(def, 'FUNCTION public.dom_contexto_processual(',
                        'FUNCTION public.dom_contexto_processual_antes_do_processo_do_grupo(');
  execute copia;

  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'detectar_processos_em_grupos';
  if def is null then raise exception 'detectar_processos_em_grupos não existe'; end if;
  copia := replace(def, 'FUNCTION public.detectar_processos_em_grupos(',
                        'FUNCTION public.detectar_processos_em_grupos_antes_do_processo_do_grupo(');
  execute copia;
end $mig$;

-- ── 1. O status ──────────────────────────────────────────────────────────────
alter table public.grupo_processo_detectado
  drop constraint if exists grupo_processo_detectado_status_ck;
alter table public.grupo_processo_detectado
  add constraint grupo_processo_detectado_status_ck check (status in (
    'sugerido', 'eco_da_casa', 'ignorado', 'divergente', 'ambiguo_cnj',
    'ambiguo_lead', 'sem_lead',
    'processo_do_grupo'   -- citado pela equipe, CNJ válido, número do caso bate
  ));

comment on column public.grupo_processo_detectado.status is
  'sugerido | eco_da_casa | ignorado | divergente | ambiguo_cnj | ambiguo_lead | sem_lead | '
  'processo_do_grupo (citado pela equipe, cnj_valido, número do caso do grupo = do lead dono; '
  'o Dom lê este processo como sendo do grupo).';

-- ── 2. O vinculador ──────────────────────────────────────────────────────────
create or replace function public.vincular_processos_citados_no_grupo(p_group_jid text default null)
returns table(pontes_criadas integer, processos_do_grupo integer, deixados_na_fila integer)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_pontes   integer := 0;
  v_marcados integer := 0;
  v_fila     integer := 0;
  v_n        integer := 0;
  r record;
begin
  for r in
    with cit as (
      select d.group_jid, d.cnj, g.group_name,
             (select array_agg(distinct p.lead_id)
                from lead_processes p
               where p.deleted_at is null and p.lead_id is not null
                 and cnj_digitos(p.process_number) = d.cnj) as donos,
             exists (select 1 from lead_whatsapp_groups lg
                      where jid_chave(lg.group_jid) = d.group_jid
                        and lg.lead_id is not null) as tem_ponte,
             exists (select 1 from leads l
                      where l.deleted_at is null and l.whatsapp_group_id is not null
                        and jid_chave(l.whatsapp_group_id) = d.group_jid) as tem_cadastro,
             (select kg.numero from busca_chave_caso(g.group_name, false) kg limit 1) as numero_grupo
        from grupo_processo_detectado d
        join dom_grupos_piloto g on g.group_jid = d.group_jid and g.ativo
       where d.status = 'eco_da_casa'
         and d.origem = 'equipe'
         and cnj_valido(d.cnj)
         and (p_group_jid is null or d.group_jid = jid_chave(p_group_jid))
    )
    select c.*,
           cardinality(c.donos) as n_donos,
           (select bool_or(kd.numero = c.numero_grupo)
              from unnest(c.donos) u(lead_id)
              join leads l on l.id = u.lead_id,
              lateral busca_chave_caso(coalesce(l.case_number, l.lead_name, l.victim_name), false) kd
           ) as numero_bate
      from cit c
     where c.donos is not null
  loop
    -- A trava: sem número no grupo, ou número que não bate com o dono → gente decide.
    if r.numero_grupo is null or not coalesce(r.numero_bate, false) then
      v_fila := v_fila + 1;
      continue;
    end if;

    if not r.tem_ponte and not r.tem_cadastro then
      if r.n_donos <> 1 then
        v_fila := v_fila + 1;          -- E: sem lead e 2+ donos
        continue;
      end if;
      -- A: o grupo não tinha lead; ganha o dono do processo. Dois CNJs do
      -- mesmo dono no mesmo grupo geram UMA ponte: conta só o que inseriu.
      insert into lead_whatsapp_groups (lead_id, group_jid, group_name, auto_linked)
      values (r.donos[1], r.group_jid || '@g.us', r.group_name, true)
      on conflict do nothing;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        insert into lead_group_audit_log (action, group_jid, group_name, lead_id, lead_name, result, source)
        select 'link', r.group_jid || '@g.us', r.group_name, l.id, l.lead_name, 'success',
               'vincular_processos_citados_no_grupo'
          from leads l where l.id = r.donos[1];
        v_pontes := v_pontes + 1;
      end if;
    end if;

    -- A e C: o processo é do grupo. Em C a ponte fica como está.
    update grupo_processo_detectado
       set status = 'processo_do_grupo',
           lead_id = case when r.n_donos = 1 then r.donos[1] else lead_id end,
           atualizado_em = now()
     where group_jid = r.group_jid and cnj = r.cnj;
    v_marcados := v_marcados + 1;
  end loop;

  return query select v_pontes, v_marcados, v_fila;
end $fn$;

comment on function public.vincular_processos_citados_no_grupo(text) is
  'Citação da EQUIPE, CNJ válido, número do caso do grupo = do lead dono → processo_do_grupo. '
  'Grupo sem lead ganha a ponte (auto_linked). Grupo com lead: ponte intocada. '
  'Número que não bate, sem número, 2+ donos sem lead, processo órfão → fica na fila (view desalinhado).';

-- ── 3. A re-varredura não apaga o que foi vinculado ──────────────────────────
do $mig$
declare
  def text;
  velho text := $a$     set status = excluded.status,
         origem = excluded.origem,
         lead_id = excluded.lead_id,$a$;
  novo  text := $b$     set status = case when d.status = 'processo_do_grupo' then d.status else excluded.status end,
         origem = excluded.origem,
         lead_id = case when d.status = 'processo_do_grupo' then d.lead_id else excluded.lead_id end,$b$;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'detectar_processos_em_grupos';
  if position(velho in def) = 0 then
    raise exception 'detector: âncora do ON CONFLICT não encontrada — NADA alterado';
  end if;
  execute replace(def, velho, novo);
end $mig$;

-- ── 4. A RPC lê os processos do grupo ────────────────────────────────────────
do $mig$
declare
  def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dom_contexto_processual';

  -- 4a. CTE citados, antes de proc
  v_old := '  proc as (';
  v_new := $c$  citados as (
    -- Processos que a EQUIPE citou neste grupo e o vinculador confirmou
    -- (número do caso bate). São do grupo, esteja o processo no lead que estiver.
    select d.cnj
    from grupo_processo_detectado d
    where d.group_jid = jid_chave(p_group_jid)
      and d.status = 'processo_do_grupo'
  ),
  proc as ($c$;
  if position(v_old in def) = 0 then raise exception 'RPC: âncora "proc as (" não encontrada'; end if;
  def := replace(def, v_old, v_new);

  -- 4b. origem do vínculo por processo
  v_old := '           p.title, p.status, p.situacao,';
  v_new := '           p.title, p.status, p.situacao,
           case when gs.lead_id is not null then ''lead'' else ''citado_no_grupo'' end as origem_vinculo,';
  if position(v_old in def) = 0 then raise exception 'RPC: âncora p.title não encontrada'; end if;
  def := replace(def, v_old, v_new);

  -- 4c. o join: lead OU citado. Texto exato deixado por 20260908183000.
  v_old := '    from lead_processes p
    join gs on gs.lead_id = p.lead_id
    where p.process_number is not null
      and p.deleted_at is null
    order by coalesce(nullif(dom_so_digitos(p.process_number), ''''), ''lp:'' || p.id::text),
             p.updated_at desc nulls last, p.id';
  v_new := '    from lead_processes p
    left join gs on gs.lead_id = p.lead_id
    where p.process_number is not null
      and p.deleted_at is null
      and (gs.lead_id is not null
           or nullif(dom_so_digitos(p.process_number), '''') in (select c.cnj from citados c))
    -- O mesmo CNJ pode estar em dois leads: prefere a linha do lead do grupo.
    order by coalesce(nullif(dom_so_digitos(p.process_number), ''''), ''lp:'' || p.id::text),
             (gs.lead_id is null), p.updated_at desc nulls last, p.id';
  if position(v_old in def) = 0 then
    raise exception 'RPC: âncora do join de proc não encontrada — 20260908183000 foi aplicada? NADA alterado';
  end if;
  def := replace(def, v_old, v_new);

  -- 4d. o jsonb de cada processo diz de onde veio
  v_old := '            ''numero'',              pr.process_number,';
  v_new := '            ''numero'',              pr.process_number,
            ''origem_vinculo'',      pr.origem_vinculo,';
  if position(v_old in def) = 0 then raise exception 'RPC: âncora numero não encontrada'; end if;
  def := replace(def, v_old, v_new);

  -- 4e. e o vinculo conta
  v_old := '      ''fichas_usadas'',   (select count(*) from gs),';
  v_new := '      ''fichas_usadas'',   (select count(*) from gs),
      ''processos_citados'', (select count(*) from citados),';
  if position(v_old in def) = 0 then raise exception 'RPC: âncora fichas_usadas não encontrada'; end if;
  def := replace(def, v_old, v_new);

  execute def;
end $mig$;

comment on function public.dom_contexto_processual(text) is
  'Contexto do Dom. Lead do grupo em três degraus (ponte; cadastro com 1 lead; leads do mesmo processo). '
  'processos = do lead ∪ citados pela equipe no grupo com status processo_do_grupo (origem_vinculo diz qual). '
  'vinculo.fonte/fichas_no_grupo/fichas_usadas/processos_citados/ambiguo dizem como achou. '
  'parado_dias / parado_dias_efetivo = dias desde o último movimento (o segundo ignora despacho). '
  'ultima_atividade.prazo_contato = deadline da atividade, só quando ainda não venceu. Ignora atividade com deleted_at.';

-- ── 5. A coluna "Processo" da lista de grupos ────────────────────────────────
create or replace view public.vw_grupo_processo_conciliacao as
with grupo as (
  select distinct on (jid_chave(g.group_jid))
         g.group_jid, jid_chave(g.group_jid) as chave, g.contact_name as group_name,
         nullif(regexp_replace((regexp_match(g.contact_name, '(?i)caso\s*n?º?\s*([0-9]{1,4})'))[1], '\D', '', 'g'), '') as caso_no_nome
    from whatsapp_groups_index g
   where g.contact_name ~* 'caso'
   order by jid_chave(g.group_jid), g.last_seen desc nulls last, g.updated_at desc nulls last
),
vinculo as (
  select distinct on (jid_chave(group_jid)) jid_chave(group_jid) as chave, lead_id
    from lead_whatsapp_groups
   where lead_id is not null
   order by jid_chave(group_jid), created_at desc
),
do_lead as (
  -- processos do lead do grupo ∪ processos citados pela equipe e confirmados
  select chave, string_agg(distinct numero, ', ') as cnj_do_lead
    from (
      select v.chave, lp.process_number as numero
        from vinculo v
        join lead_processes lp on lp.lead_id = v.lead_id and lp.deleted_at is null
       where coalesce(lp.process_number, '') <> ''
      union
      select d.group_jid, cnj_formatado(d.cnj)
        from grupo_processo_detectado d
       where d.status = 'processo_do_grupo'
    ) x
   group by chave
),
sugerido as (
  select g.chave,
         string_agg(distinct jp.processo_cnj, ', ') as cnj_sugerido,
         count(distinct jp.processo_cnj) as qtd_sugerida,
         string_agg(distinct (jp.processo_cnj || ' · ' || coalesce(jp.empresa, 'sem empresa'))
                             || coalesce(' (' || nullif(jp.cidade_proc, '') || '/' || nullif(jp.uf_proc, '') || ')', ''),
                    E'\n') as sugestao_detalhe
    from grupo g
    join jm_processos jp on nullif(regexp_replace(jp.caso, '\D', '', 'g'), '') = g.caso_no_nome
   where not exists (select 1 from lead_processes lp
                      where regexp_replace(coalesce(lp.process_number, ''), '\D', '', 'g')
                            = regexp_replace(jp.processo_cnj, '\D', '', 'g')
                        and lp.deleted_at is null)
   group by g.chave
)
select g.group_jid, g.group_name, g.caso_no_nome, v.lead_id,
       dl.cnj_do_lead, s.cnj_sugerido, s.sugestao_detalhe,
       coalesce(s.qtd_sugerida, 0::bigint) as qtd_sugerida,
       (dl.cnj_do_lead is null and s.cnj_sugerido is not null) as so_na_jurimetria
  from grupo g
  left join vinculo  v  on v.chave  = g.chave
  left join do_lead  dl on dl.chave = g.chave
  left join sugerido s  on s.chave  = g.chave
 where dl.cnj_do_lead is not null or s.cnj_sugerido is not null;

-- ── 6. Rodar sozinho, de hora em hora ────────────────────────────────────────
create or replace function public.rodar_processos_citados_no_grupo(p_horas integer default 3)
returns table(grupos_revarridos integer, grupos_varridos integer, cnjs_registrados integer,
              pontes_criadas integer, processos_do_grupo integer, deixados_na_fila integer)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_re integer := 0; v_g integer := 0; v_c integer := 0;
  v_p integer := 0;  v_m integer := 0; v_f integer := 0;
begin
  -- Grupos com mensagem NOVA que parece CNJ voltam para a fila do detector.
  -- Dirigido pelo índice de created_at (últimas p_horas), não por grupo:
  -- varrer 1.149 grupos por hora pelo telefone é o que não pode.
  with novas as (
    select distinct m.phone
      from whatsapp_messages m
     where m.created_at > now() - make_interval(hours => greatest(p_horas, 1))
       and m.phone like '1203%'
       and m.message_text ~ '\d{7}[-.]?\d{2}[.]?\d{4}[.]?\d[.]?\d{2}[.]?\d{4}'
  )
  update dom_grupos_piloto g
     set processos_varridos_em = null
    from novas n
   where n.phone = g.group_jid
     and g.ativo and g.escopo_status = 'operacional'
     and g.processos_varridos_em is not null;
  get diagnostics v_re = row_count;

  select t.grupos_varridos, t.cnjs_registrados into v_g, v_c
    from detectar_processos_em_grupos(300) t;
  select t.pontes_criadas, t.processos_do_grupo, t.deixados_na_fila into v_p, v_m, v_f
    from vincular_processos_citados_no_grupo() t;

  return query select v_re, v_g, v_c, v_p, v_m, v_f;
end $fn$;

comment on function public.rodar_processos_citados_no_grupo(integer) is
  'Cron horário: re-varre grupos com mensagem nova que parece CNJ, roda o detector (300 grupos) e o vinculador.';

select cron.schedule('processos-citados-no-grupo', '23 * * * *',
                     'select public.rodar_processos_citados_no_grupo(3);');
