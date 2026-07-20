-- Fusão genérica de registros duplicados (leads, contacts) — re-vincula TODAS as FKs
-- que apontam para <tabela>.id, resolve colisões de UNIQUE e faz soft-delete dos perdedores.
-- Percorre o grafo de FK em runtime, então nunca esquece uma tabela referenciadora nova.
-- Transacional: ou re-vincula tudo e solta os perdedores, ou nada (rollback automático).

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
  fk       record;
  ctids    tid[];
  ct       tid;
  moved    bigint;
  total    bigint := 0;
  summary  jsonb := '{}'::jsonb;
begin
  -- whitelist: só objetos cuja fusão foi validada
  if p_table not in ('leads', 'contacts') then
    raise exception 'merge_relink_and_softdelete: tabela % não permitida', p_table;
  end if;
  if p_winner is null or p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'merge_relink_and_softdelete: winner e losers são obrigatórios';
  end if;
  if p_winner = any(p_losers) then
    raise exception 'merge_relink_and_softdelete: winner não pode estar entre os losers';
  end if;

  -- percorre cada FK que referencia <p_table>.id
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
    -- fotografa as linhas dos perdedores ANTES de mutar (evita reprocessar linhas já movidas)
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
          -- o vencedor já tem o vínculo equivalente: descarta a linha redundante do perdedor
          execute format('delete from public.%I where ctid = $1', fk.tbl) using ct;
        end;
      end loop;
    end if;

    if moved > 0 then
      summary := summary || jsonb_build_object(fk.tbl || '.' || fk.col, moved);
    end if;
    total := total + moved;
  end loop;

  -- soft-delete dos perdedores + marcador de snapshot em notes
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

-- acesso mínimo: sessão anônima do app roda como 'authenticated'
revoke all on function public.merge_relink_and_softdelete(text, uuid, uuid[]) from public;
grant execute on function public.merge_relink_and_softdelete(text, uuid, uuid[]) to authenticated;

comment on function public.merge_relink_and_softdelete(text, uuid, uuid[]) is
  'Funde registros duplicados: re-vincula todas as FKs dos perdedores para o vencedor, resolve colisões de UNIQUE apagando a linha redundante, e soft-deleta os perdedores com marcador [merged_into:<id>] em notes. Whitelist: leads, contacts.';
