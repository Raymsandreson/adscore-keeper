-- =============================================================================
-- Processo citado pela equipe entra sozinho no lead do grupo — e vai ao Escavador
-- assim que é ligado.
--
-- O QUE O RAYM VIU (09/09/2026, grupo "Família 50-Rosilei"): a mensagem de
-- atividade da equipe traz o CNJ 1003088-73.2020.8.26.0666 (13 vezes, última
-- em 02/09). O grupo tem UM lead (ponte automática de 02/09), o lead tem UM
-- caso ("caso 50"). Mesmo assim a coluna Processo estava "—", a página Casos
-- dizia "Processos (0)" e a ficha do processo "Nunca buscado".
--
-- CAUSA, COM EVIDÊNCIA
--   1. lead_processes tinha a linha do CNJ, criada em 18/08 pela conferência
--      Tab.Aux × financeiro, com lead_id NULO e case_id NULO (ficha órfã).
--   2. O detector marcou a citação (origem = equipe, status = eco_da_casa,
--      lead_id = o lead do grupo). O vinculador (20260908233000) só resolve
--      citação cujo processo TEM dono e cujo número de caso bate; processo
--      sem dono ele nem olha — cai na fila humana como "processo_orfao". A
--      fila tinha 110 citações assim em grupos com um lead só: 26 com linha
--      órfã, 84 sem linha nenhuma.
--   3. Escavador: quem busca é o botão da ficha, o backfill por POP
--      (02/09) e o cron do push do e-mail. Processo sem lead não entra em
--      nenhum. 60 processos COM lead nunca foram buscados; 113 sem lead.
--
-- REGRA NOVA (a que o Raym pediu em 08/09: "processo citado pela equipe no
-- grupo é processo do grupo")
--   Citação da equipe, CNJ válido, grupo com exatamente UM lead (ponte),
--   e nenhum lead dono do processo:
--     · há linha órfã em lead_processes → o lead do grupo adota
--       (lead_id; case_id = o caso do lead, se ele tiver um só);
--     · não há linha → cadastra no lead do grupo (título da jurimetria quando
--       houver; senão "Citado no grupo X"); mesmo case_id.
--   Nos dois casos a citação vira processo_do_grupo e lead_processes.notes
--   ganha a marca "(vincular_processos_citados_no_grupo)" — é por ela que se
--   desfaz. Grupo com 2+ leads ou sem lead continua na fila (sortear é o que
--   não se faz). Número citado pelo CLIENTE continua fora (decisão 09/09).
--
-- ESCAVADOR AO LIGAR
--   cron `escavador-recem-vinculados` (*/5 min): pega até 10 processos
--   judiciais com lead, CNJ no formato do tribunal e NUNCA buscados
--   (data_ultima_verificacao e escavador_raw nulos) e chama a edge
--   backfill-process-marcos (mode backfill, process_ids, apenas_nunca_buscados)
--   — a mesma chamada do backfill de 02/09. A edge traz movimentações e capa e
--   carimba data_ultima_verificacao.
--   TRAVA: a edge só carimba quando o Escavador responde; em erro (404, saldo)
--   o processo continuaria "nunca buscado" e um cron ingênuo pagaria por ele a
--   cada 5 min. Por isso `escavador_busca_tentativas` (infra, não objeto do
--   domínio): no máximo 3 tentativas por processo, 1 h entre elas.
--   CUSTO: ~R$ 0,10 por consulta de movimentações + capa quando falta data de
--   início (preço de referência da API; o valor real vem no header
--   Creditos-Utilizados). Fila hoje: 60 → ordem de R$ 6–20 uma vez; depois
--   ~12 processos novos/semana → ~R$ 1–4/semana. Fora isso o cron não gasta:
--   sem processo elegível ele não chama a edge.
--
-- O QUE NÃO MUDA
--   * Citação do cliente, grupo sem lead, grupo com 2+ leads: fila, como antes.
--   * Processo que já tem dono em outro lead: fila (a regra do número de caso
--     continua a mesma).
--   * Nada é apagado. resolver_processo_citado ganha só o case_id.
--
-- APLICADO em 09/09/2026 com aval do Raym. vincular_processos_citados_no_grupo()
-- rodou em seguida: 110 processos_do_grupo (26 adoções, 84 cadastros, 89 com
-- case_id), fila de citados 304 → 194. Família 50: citação processo_do_grupo,
-- ficha com lead e caso 50, Dom devolve 3 processos. Cron jobid 5104 ativo;
-- primeiro disparo manual: 10 processos, request 951997. Elegíveis no momento:
-- 145 (os 60 de antes + os 84 cadastrados agora + adoções) — custo de uma vez
-- na ordem de R$ 15–45, acima da estimativa de R$ 6–20 feita antes de rodar.
--
-- ROTA DE FUGA
--   vincular_processos_citados_no_grupo_antes_da_adocao (cópia)
--   resolver_processo_citado_antes_do_case_id (cópia)
--   desfazer adoções:  update lead_processes set lead_id = null, case_id = null
--       where notes like '%(vincular_processos_citados_no_grupo)%' and created_by is null
--         and notes like '%adotad%';
--   desfazer cadastros: delete from lead_processes
--       where notes like '%(vincular_processos_citados_no_grupo)%' and notes like '%cadastrad%'
--         and not exists (select 1 from process_updates u where u.process_id = lead_processes.id);
--   citações: update grupo_processo_detectado set status = 'eco_da_casa' where ... (atualizado_em);
--   cron: select cron.unschedule('escavador-recem-vinculados');
--         drop function escavador_buscar_recem_vinculados(integer); drop table escavador_busca_tentativas;
-- =============================================================================

-- ── 0. Rota de fuga ──────────────────────────────────────────────────────────
do $mig$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'vincular_processos_citados_no_grupo';
  execute replace(def, 'FUNCTION public.vincular_processos_citados_no_grupo(', 'FUNCTION public.vincular_processos_citados_no_grupo_antes_da_adocao(');
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolver_processo_citado';
  execute replace(def, 'FUNCTION public.resolver_processo_citado(', 'FUNCTION public.resolver_processo_citado_antes_do_case_id(');
end $mig$;

-- ── 1. O vinculador: dono bate (como antes) + sem dono, grupo com um lead ────
create or replace function public.vincular_processos_citados_no_grupo(p_group_jid text default null)
returns table(pontes_criadas integer, processos_do_grupo integer, deixados_na_fila integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pontes   integer := 0;
  v_marcados integer := 0;
  v_fila     integer := 0;
  v_n        integer := 0;
  v_caso     uuid;
  v_marca    text;
  r record;
begin
  -- ── 1a. Processo com dono: o número do caso do grupo tem que bater (20260908233000) ──
  for r in
    with cit as (
      select d.group_jid, d.cnj, d.tipo, g.group_name,
             (select array_agg(distinct x.lead_id) from (
                select p.lead_id from lead_processes p
                 where p.deleted_at is null and p.lead_id is not null
                   and cnj_digitos(p.process_number) = d.cnj
                union
                select i.lead_id from inss_admin_processes i
                  join leads l on l.id = i.lead_id and l.deleted_at is null
                 where i.deleted_at is null and d.tipo = 'inss'
                   and (regexp_replace(i.requerimento_number, '\D', '', 'g') = d.cnj
                        or regexp_replace(i.benefit_number, '\D', '', 'g') = d.cnj)
              ) x) as donos,
             exists (select 1 from lead_whatsapp_groups lg
                      where jid_chave(lg.group_jid) = d.group_jid
                        and lg.lead_id is not null) as tem_ponte,
             exists (select 1 from leads l
                      where l.deleted_at is null and l.whatsapp_group_id is not null
                        and jid_chave(l.whatsapp_group_id) = d.group_jid) as tem_cadastro,
             (select kg.numero from busca_chave_caso(g.group_name, false) kg limit 1) as numero_grupo
        from grupo_processo_detectado d
        join dom_grupos_piloto g on g.group_jid = d.group_jid and (g.ativo or g.so_varredura)
       where d.status = 'eco_da_casa'
         and d.origem = 'equipe'
         and ((d.tipo = 'cnj' and cnj_valido(d.cnj)) or d.tipo = 'inss')
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
    if r.numero_grupo is null or not coalesce(r.numero_bate, false) then
      v_fila := v_fila + 1;
      continue;
    end if;

    if not r.tem_ponte and not r.tem_cadastro then
      if r.n_donos <> 1 then
        v_fila := v_fila + 1;
        continue;
      end if;
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

    update grupo_processo_detectado
       set status = 'processo_do_grupo',
           lead_id = case when r.n_donos = 1 then r.donos[1] else lead_id end,
           atualizado_em = now()
     where group_jid = r.group_jid and cnj = r.cnj;
    v_marcados := v_marcados + 1;
  end loop;

  -- ── 1b. Processo SEM dono, citado pela equipe, grupo com UM lead: adota ou cadastra ──
  for r in
    with lg as (
      select jid_chave(w.group_jid) as chave,
             count(distinct w.lead_id) as leads,
             (array_agg(distinct w.lead_id))[1] as lead_id
        from lead_whatsapp_groups w
       where w.lead_id is not null
       group by 1
    )
    select d.group_jid, d.cnj, g.group_name, lg.lead_id,
           (select count(*) from lead_processes p
             where p.deleted_at is null and cnj_digitos(p.process_number) = d.cnj) as linhas
      from grupo_processo_detectado d
      join dom_grupos_piloto g on g.group_jid = d.group_jid and (g.ativo or g.so_varredura)
      join lg on lg.chave = d.group_jid and lg.leads = 1
      join leads l on l.id = lg.lead_id and l.deleted_at is null
     where d.status = 'eco_da_casa'
       and d.origem = 'equipe'
       and d.tipo = 'cnj'
       and cnj_valido(d.cnj)
       and (p_group_jid is null or d.group_jid = jid_chave(p_group_jid))
       and not exists (select 1 from lead_processes p
                        where p.deleted_at is null and p.lead_id is not null
                          and cnj_digitos(p.process_number) = d.cnj)
  loop
    select case when count(*) = 1 then (array_agg(c.id))[1] end into v_caso
      from legal_cases c where c.deleted_at is null and c.lead_id = r.lead_id;

    if r.linhas > 0 then
      v_marca := 'Ficha órfã adotada pelo lead do grupo "' || coalesce(r.group_name, r.group_jid)
              || '" em ' || to_char(now(), 'DD/MM/YYYY') || ': a equipe citou o processo no grupo (vincular_processos_citados_no_grupo).';
      update lead_processes
         set lead_id = r.lead_id,
             case_id = coalesce(case_id, v_caso),
             notes   = concat_ws(E'\n', nullif(notes, ''), v_marca)
       where deleted_at is null and lead_id is null and cnj_digitos(process_number) = r.cnj;
    else
      v_marca := 'Cadastrado no lead do grupo "' || coalesce(r.group_name, r.group_jid)
              || '" em ' || to_char(now(), 'DD/MM/YYYY') || ': a equipe citou o processo no grupo (vincular_processos_citados_no_grupo).';
      insert into lead_processes (lead_id, case_id, process_number, process_type, status, title, notes)
      select r.lead_id, v_caso, cnj_formatado(r.cnj), 'judicial', 'em_andamento',
             coalesce(nullif(btrim(jp.natureza || ' — ' || coalesce(jp.empresa, '')), '— '),
                      'Citado no grupo ' || coalesce(r.group_name, r.group_jid)),
             v_marca
        from (select 1) x
        left join jm_processos jp on cnj_digitos(jp.processo_cnj) = r.cnj
       limit 1;
    end if;

    update grupo_processo_detectado
       set status = 'processo_do_grupo', lead_id = r.lead_id, atualizado_em = now()
     where group_jid = r.group_jid and cnj = r.cnj;
    v_marcados := v_marcados + 1;
  end loop;

  return query select v_pontes, v_marcados, v_fila;
end $function$;

comment on function public.vincular_processos_citados_no_grupo(text) is
  'Citação da equipe (grupo_processo_detectado.origem = equipe, status eco_da_casa): '
  '(a) processo com dono → processo_do_grupo quando o nº do caso do grupo bate com o do dono; '
  '(b) processo sem dono e grupo com UM lead → o lead adota a ficha órfã ou cadastra o processo '
  '(case_id = o caso do lead se ele tiver um só) e vira processo_do_grupo. Marca em lead_processes.notes. '
  'Grupo sem lead ou com 2+ leads fica na fila (vw_grupo_processo_desalinhado).';

-- ── 2. O 1 clique da fila também preenche case_id ────────────────────────────
do $mig$
declare def text; v1 text; n1 text; v2 text; n2 text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resolver_processo_citado';

  -- (a versão em produção é a de 20260909030000, que já trata tipo = 'inss' na linha seguinte)
  v1 := $a$insert into lead_processes (lead_id, process_number, process_type, status, title)
    select v_lead,
$a$;
  n1 := $b$insert into lead_processes (lead_id, case_id, process_number, process_type, status, title)
    select v_lead,
           (select case when count(*) = 1 then (array_agg(c.id))[1] end from legal_cases c where c.deleted_at is null and c.lead_id = v_lead),
$b$;
  v2 := $c$update lead_processes set lead_id = v_lead
     where deleted_at is null and lead_id is null and cnj_digitos(process_number) = v_cnj;$c$;
  n2 := $d$update lead_processes
       set lead_id = v_lead,
           case_id = coalesce(case_id, (select case when count(*) = 1 then (array_agg(c.id))[1] end from legal_cases c where c.deleted_at is null and c.lead_id = v_lead))
     where deleted_at is null and lead_id is null and cnj_digitos(process_number) = v_cnj;$d$;

  if position(v1 in def) = 0 or position(v2 in def) = 0 then
    raise exception 'resolver_processo_citado: âncora não encontrada — NADA alterado';
  end if;
  execute replace(replace(def, v1, n1), v2, n2);
end $mig$;

-- ── 3. Escavador assim que o processo é ligado ───────────────────────────────
create table if not exists public.escavador_busca_tentativas (
  process_id        uuid primary key references public.lead_processes(id) on delete cascade,
  tentativas        integer not null default 0,
  primeira_em       timestamptz not null default now(),
  ultima_em         timestamptz not null default now(),
  ultimo_request_id bigint
);
comment on table public.escavador_busca_tentativas is
  'Infra do cron escavador-recem-vinculados: quantas vezes cada processo nunca buscado já foi mandado à edge. '
  'Trava de custo — a edge só carimba data_ultima_verificacao quando o Escavador responde; sem isto um CNJ '
  'que dá erro seria pago a cada 5 min para sempre. Máx. 3 tentativas, 1 h entre elas.';
alter table public.escavador_busca_tentativas enable row level security;
-- sem policy: só service_role e as funções security definer leem/escrevem.

create or replace function public.escavador_buscar_recem_vinculados(p_limite integer default 10)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_ids uuid[];
  v_req bigint;
begin
  select array_agg(s.id) into v_ids
    from (
      select p.id
        from lead_processes p
        left join escavador_busca_tentativas t on t.process_id = p.id
       where p.deleted_at is null
         and p.process_type = 'judicial'
         and p.lead_id is not null
         and p.data_ultima_verificacao is null
         and p.escavador_raw is null
         and p.process_number ~ '^\d{7}-?\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'
         and (t.process_id is null
              or (t.tentativas < 3 and t.ultima_em < now() - interval '1 hour'))
       order by p.created_at desc
       limit greatest(coalesce(p_limite, 10), 1)
    ) s;

  if v_ids is null then
    return jsonb_build_object('enviados', 0);
  end if;

  select net.http_post(
    url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/backfill-process-marcos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttZWRsZGxlcHdpaXR5anNkYWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTExOTAsImV4cCI6MjA5MDQ2NzE5MH0.s51bWtABFjJGfGyuPFWr5Tp8CzbxPD5eieFUqUVuQTs'
    ),
    body := jsonb_build_object(
      'mode', 'backfill', 'confirm', 'BACKFILL',
      'limit', cardinality(v_ids), 'process_ids', to_jsonb(v_ids),
      'apenas_nunca_buscados', true
    ),
    timeout_milliseconds := 300000
  ) into v_req;

  insert into escavador_busca_tentativas (process_id, tentativas, ultima_em, ultimo_request_id)
  select unnest(v_ids), 1, now(), v_req
  on conflict (process_id) do update
     set tentativas = escavador_busca_tentativas.tentativas + 1,
         ultima_em = now(),
         ultimo_request_id = excluded.ultimo_request_id;

  return jsonb_build_object('enviados', cardinality(v_ids), 'request_id', v_req);
end $fn$;

comment on function public.escavador_buscar_recem_vinculados(integer) is
  'Manda à edge backfill-process-marcos (mode backfill, process_ids) até N processos judiciais com lead, CNJ no '
  'formato do tribunal e nunca buscados. Cron escavador-recem-vinculados a cada 5 min. Custa ~R$ 0,10 por processo '
  '(+ capa quando falta data de início). Não chama a edge quando não há elegível.';

select cron.schedule('escavador-recem-vinculados', '*/5 * * * *',
                     $$select public.escavador_buscar_recem_vinculados(10)$$);
