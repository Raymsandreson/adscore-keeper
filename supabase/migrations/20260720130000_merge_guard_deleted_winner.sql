-- Guarda contra fusão degenerada: o vencedor NÃO pode ser um registro já soft-deletado.
-- (Incidente: busca não filtrava deleted_at + soft-delete bumpa updated_at, então um
--  perdedor já excluído reaparecia como "mais novo" e virava vencedor, matando os dois.)

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
begin
  if p_table not in ('leads', 'contacts') then
    raise exception 'merge_relink_and_softdelete: tabela % nao permitida', p_table;
  end if;
  if p_winner is null or p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'merge_relink_and_softdelete: winner e losers sao obrigatorios';
  end if;
  if p_winner = any(p_losers) then
    raise exception 'merge_relink_and_softdelete: winner nao pode estar entre os losers';
  end if;

  -- vencedor precisa existir e estar ATIVO
  execute format('select deleted_at from public.%I where id = $1', p_table)
    into v_winner_del using p_winner;
  if not found then
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

  execute format(
    'update public.%I set deleted_at = now(), '
    || 'notes = trim(both from concat(coalesce(notes, ''''), '' [merged_into:%s]'')) '
    || 'where id = any($1) and deleted_at is null',
    p_table, p_winner
  ) using p_losers;

  return jsonb_build_object(
    'winner',      p_winner,
    'losers',      p_losers,
    'relinked',    summary,
    'moved_total', total
  );
end;
$$;
