-- Fase 3: libera 'campaigns' na whitelist e torna o snapshot em notes CONDICIONAL
-- (campaigns não tem coluna notes). Campaigns não tem FK apontando pra ela e o vínculo
-- crm_campaign_id está 100% nulo hoje, então o merge é só preencher+soft-delete.
-- Se um dia crm_campaign_id (leads/lead_activities/ad_briefings/promoted_posts) for usado,
-- será preciso re-vincular esses também (não há FK declarada — a walk genérica não os pega).

create or replace function public.merge_relink_and_softdelete(
  p_table  text,
  p_winner uuid,
  p_losers uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fk              record;
  ctids           tid[];
  ct              tid;
  moved           bigint;
  total           bigint := 0;
  summary         jsonb := '{}'::jsonb;
  v_winner_del    timestamptz;
  v_winner_found  boolean;
  v_has_notes     boolean;
begin
  if p_table not in ('leads', 'contacts', 'legal_cases', 'lead_processes', 'campaigns') then
    raise exception 'merge_relink_and_softdelete: tabela % nao permitida', p_table;
  end if;
  if p_winner is null or p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'merge_relink_and_softdelete: winner e losers sao obrigatorios';
  end if;
  if p_winner = any(p_losers) then
    raise exception 'merge_relink_and_softdelete: winner nao pode estar entre os losers';
  end if;

  execute format('select true, deleted_at from public.%I where id = $1', p_table)
    into v_winner_found, v_winner_del using p_winner;
  if v_winner_found is null then
    raise exception 'merge_relink_and_softdelete: vencedor % nao existe em %', p_winner, p_table;
  end if;
  if v_winner_del is not null then
    raise exception 'merge_relink_and_softdelete: vencedor % ja esta excluido (deleted_at=%)', p_winner, v_winner_del;
  end if;

  for fk in
    select tc.table_name as tbl, kcu.column_name as col
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema    = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
     and tc.table_schema    = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema    = 'public'
      and ccu.table_name     = p_table
      and ccu.column_name    = 'id'
  loop
    execute format('select array_agg(ctid) from public.%I where %I = any($1)', fk.tbl, fk.col)
      into ctids using p_losers;

    moved := 0;
    if ctids is not null then
      foreach ct in array ctids loop
        begin
          execute format('update public.%I set %I = $1 where ctid = $2', fk.tbl, fk.col)
            using p_winner, ct;
          moved := moved + 1;
        exception when unique_violation then
          execute format('delete from public.%I where ctid = $1', fk.tbl) using ct;
        end;
      end loop;
    end if;

    if moved > 0 then
      summary := summary || jsonb_build_object(fk.tbl || '.' || fk.col, moved);
    end if;
    total := total + moved;
  end loop;

  -- soft-delete dos perdedores; snapshot em notes só se a tabela tiver a coluna
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name=p_table and column_name='notes'
  ) into v_has_notes;

  if v_has_notes then
    execute format(
      'update public.%I set deleted_at = now(), '
      || 'notes = trim(both from concat(coalesce(notes, ''''), '' [merged_into:%s]'')) '
      || 'where id = any($1) and deleted_at is null',
      p_table, p_winner
    ) using p_losers;
  else
    execute format(
      'update public.%I set deleted_at = now() where id = any($1) and deleted_at is null',
      p_table
    ) using p_losers;
  end if;

  return jsonb_build_object(
    'winner',      p_winner,
    'losers',      p_losers,
    'relinked',    summary,
    'moved_total', total
  );
end;
$$;
