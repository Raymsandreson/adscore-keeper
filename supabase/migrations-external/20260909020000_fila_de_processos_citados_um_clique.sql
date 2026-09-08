-- =============================================================================
-- A fila dos processos citados que o vinculador não resolveu — com 1 clique.
--
-- O vinculador (20260908233000) resolve sozinho quando o número do caso do
-- grupo bate com o do lead dono do processo. O que sobra vai para a
-- vw_grupo_processo_desalinhado, que até hoje era só leitura — a pessoa via o
-- problema e não tinha o que clicar. Em 08/09/2026, 191 citações em 4 tipos:
--
--     processo_orfao     108   número que não existe em lead_processes
--     grupo_sem_cliente   34   grupo sem lead; processo tem dono
--     a_conferir          28   sem número de caso de um dos lados
--     caso_diferente      21   o número do caso não bate ("188" ↔ "29")
--
-- O QUE MUDA
-- 1. Status 'nao_e_do_grupo': a pessoa disse que não. Sai da fila e a
--    re-varredura não o traz de volta (o detector preserva os dois status
--    decididos).
-- 2. resolver_processo_citado(grupo, cnj, decisao) — a única escrita da tela:
--      'nao_e_do_grupo' → marca e pronto.
--      'e_do_grupo'     → o processo passa a ser do grupo, e o que faltar na
--                         cadeia lead·grupo·processo é preenchido:
--        · processo não cadastrado + grupo com lead → cadastra em
--          lead_processes no lead do grupo (título vindo da jurimetria quando
--          houver). Entra na cadeia normal; "Atualizar Escavador" completa.
--        · processo órfão (lead nulo) + grupo com lead → o lead do grupo adota.
--        · grupo sem lead + processo com UM dono → a ponte é criada
--          (auto_linked = false: foi uma pessoa). Com 2+ donos, recusa e diz
--          para ligar o lead do grupo antes — sortear é o que não se faz.
--        · grupo com lead + processo em outro lead → só marca; juntar leads é
--          outra esteira.
--    Toda ponte vai para lead_group_audit_log com source =
--    'fila_processos_citados'.
--
-- O QUE NÃO MUDA
--   * A view continua a mesma; linha decidida some porque o status muda.
--   * Nada toca lead_processes de outro lead.
--
-- APLICADO em 08/09/2026 com aval do Raym. Fila no momento: 191 citações
-- (108 processo_orfao, 34 grupo_sem_cliente, 28 a_conferir, 21 caso_diferente).
-- Testado antes em transação com rollback, um caso real de cada tipo.
--
-- ROTA DE FUGA
--   update grupo_processo_detectado set status = 'eco_da_casa'
--    where status in ('nao_e_do_grupo') ...;  (as decisões ficam no atualizado_em)
--   pontes: auto_linked=false + source='fila_processos_citados' no log.
--   processos cadastrados aqui: title começa por 'Citado no grupo' quando não
--   veio da jurimetria; lead_processes.created_by nulo.
-- =============================================================================

-- ── 1. O status ──────────────────────────────────────────────────────────────
alter table public.grupo_processo_detectado
  drop constraint if exists grupo_processo_detectado_status_ck;
alter table public.grupo_processo_detectado
  add constraint grupo_processo_detectado_status_ck check (status in (
    'sugerido', 'eco_da_casa', 'ignorado', 'divergente', 'ambiguo_cnj',
    'ambiguo_lead', 'sem_lead',
    'processo_do_grupo',   -- automático (número bate) ou decidido por gente
    'nao_e_do_grupo'       -- gente disse que não; não volta para a fila
  ));

-- ── 2. O detector preserva as duas decisões ──────────────────────────────────
do $mig$
declare def text; velho text; novo text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'detectar_processos_em_grupos';
  velho := $a$d.status = 'processo_do_grupo'$a$;
  novo  := $b$d.status in ('processo_do_grupo', 'nao_e_do_grupo')$b$;
  if position(velho in def) = 0 then
    raise exception 'detector: âncora do status preservado não encontrada — NADA alterado';
  end if;
  execute replace(def, velho, novo);
end $mig$;

-- ── 3. A decisão de 1 clique ─────────────────────────────────────────────────
create or replace function public.resolver_processo_citado(
  p_group_jid text, p_cnj text, p_decisao text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_jid   text := jid_chave(p_group_jid);
  v_cnj   text := cnj_digitos(p_cnj);
  v_row   grupo_processo_detectado%rowtype;
  v_nome  text;
  v_lead  uuid;           -- lead do grupo (ponte, senão cadastro único)
  v_donos uuid[];         -- leads que têm o processo
  v_orfaos integer;       -- linhas de lead_processes com o CNJ e lead nulo
  v_existe boolean;
  v_acao  text;
  v_n     integer;
begin
  if p_decisao not in ('e_do_grupo', 'nao_e_do_grupo') then
    raise exception 'decisão inválida: %', p_decisao;
  end if;

  select * into v_row from grupo_processo_detectado where group_jid = v_jid and cnj = v_cnj;
  if not found then
    raise exception 'citação não encontrada para este grupo e processo';
  end if;

  if p_decisao = 'nao_e_do_grupo' then
    update grupo_processo_detectado
       set status = 'nao_e_do_grupo', atualizado_em = now()
     where group_jid = v_jid and cnj = v_cnj;
    return jsonb_build_object('ok', true, 'acao', 'nao_e_do_grupo');
  end if;

  -- ── é do grupo ──
  select g.group_name into v_nome from dom_grupos_piloto g where g.group_jid = v_jid;

  -- lead do grupo: a ponte manda; sem ponte, o cadastro se for um só
  select lg.lead_id into v_lead
    from lead_whatsapp_groups lg
   where jid_chave(lg.group_jid) = v_jid and lg.lead_id is not null
   order by lg.created_at desc limit 1;
  if v_lead is null then
    select case when count(*) = 1 then (array_agg(l.id))[1] end into v_lead
      from leads l
     where l.deleted_at is null and l.whatsapp_group_id is not null
       and jid_chave(l.whatsapp_group_id) = v_jid;
  end if;

  -- O filter importa: sem ele o array_agg guarda o NULL das linhas órfãs como
  -- se fosse um dono, e "1 dono" viraria "2 donos".
  select array_agg(distinct p.lead_id) filter (where p.lead_id is not null),
         count(*) filter (where p.lead_id is null)
    into v_donos, v_orfaos
    from lead_processes p
   where p.deleted_at is null and cnj_digitos(p.process_number) = v_cnj;
  v_existe := (cardinality(coalesce(v_donos, '{}')) > 0) or (v_orfaos > 0);

  if not v_existe then
    -- processo que não existe em lugar nenhum: cadastra no lead do grupo
    if v_lead is null then
      raise exception 'O processo não está cadastrado e o grupo não tem lead. Ligue o grupo a um lead primeiro (botão Vincular).';
    end if;
    insert into lead_processes (lead_id, process_number, process_type, status, title)
    select v_lead, cnj_formatado(v_cnj), 'judicial', 'em_andamento',
           coalesce(nullif(btrim(jp.natureza || ' — ' || coalesce(jp.empresa, '')), '— '), 'Citado no grupo ' || coalesce(v_nome, v_jid))
      from (select 1) x
      left join jm_processos jp on cnj_digitos(jp.processo_cnj) = v_cnj
     limit 1;
    v_acao := 'cadastrado_no_lead_do_grupo';

  elsif cardinality(coalesce(v_donos, '{}')) = 0 then
    -- só linhas órfãs: o lead do grupo adota
    if v_lead is null then
      raise exception 'O processo está sem lead e o grupo também. Ligue o grupo a um lead primeiro (botão Vincular).';
    end if;
    update lead_processes set lead_id = v_lead
     where deleted_at is null and lead_id is null and cnj_digitos(process_number) = v_cnj;
    v_acao := 'adotado_pelo_lead_do_grupo';

  elsif v_lead is null then
    -- grupo sem lead, processo com dono(s)
    if cardinality(v_donos) <> 1 then
      raise exception 'O grupo não tem lead e o processo está em % leads. Escolha o lead do grupo primeiro (botão Vincular).', cardinality(v_donos);
    end if;
    v_lead := v_donos[1];
    insert into lead_whatsapp_groups (lead_id, group_jid, group_name, auto_linked)
    values (v_lead, v_jid || '@g.us', v_nome, false)
    on conflict do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into lead_group_audit_log (action, group_jid, group_name, lead_id, lead_name, result, source)
      select 'link', v_jid || '@g.us', v_nome, l.id, l.lead_name, 'success', 'fila_processos_citados'
        from leads l where l.id = v_lead;
    end if;
    v_acao := 'grupo_ligado_ao_lead_do_processo';

  else
    -- grupo com lead; processo em outro lead (ou no mesmo): só marca
    v_acao := 'processo_do_grupo';
  end if;

  update grupo_processo_detectado
     set status = 'processo_do_grupo',
         lead_id = case when cardinality(coalesce(v_donos, '{}')) = 1 then v_donos[1] else v_lead end,
         atualizado_em = now()
   where group_jid = v_jid and cnj = v_cnj;

  return jsonb_build_object('ok', true, 'acao', v_acao, 'lead_id', v_lead);
end $fn$;

comment on function public.resolver_processo_citado(text, text, text) is
  'Fila de processos citados (vw_grupo_processo_desalinhado), 1 clique. '
  'nao_e_do_grupo: marca. e_do_grupo: marca processo_do_grupo e completa a cadeia — '
  'cadastra no lead do grupo se o processo não existe, adota se está órfão, cria a ponte se o grupo '
  'não tem lead e o processo tem UM dono. Com 2+ donos e grupo sem lead, recusa.';

grant execute on function public.resolver_processo_citado(text, text, text) to authenticated, service_role;
