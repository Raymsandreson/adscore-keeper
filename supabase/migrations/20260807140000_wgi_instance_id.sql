-- whatsapp_groups_index: passa a guardar o ID da instância, não só o nome
-- ============================================================================
-- O índice de grupos identifica a instância que viu cada grupo por TEXTO
-- (`instance_name`, parte da PK). Nome de instância morta ou renomeada continua
-- ali para sempre: em 07/08/2026 eram 504 de 27.924 linhas apontando para
-- "BRUNO DANTAS" (345, congeladas em 24/05) e "Auxílio Maternidade" (159, ainda
-- sendo regravadas pelo webhook) — nomes que não existem em whatsapp_instances.
-- Quem consumia o índice e ia buscar a instância pelo nome batia em
-- "instance not found" e ficava sem roster do grupo.
--
-- `instance_id` é preenchido por trigger (a partir do nome, case-insensitive),
-- então nem a sync (sync-all-whatsapp-groups) nem o webhook precisam mudar —
-- ambos continuam gravando só o nome. NULL passa a ser o sinal explícito de
-- "instância não existe mais", em vez de um erro descoberto na hora do uso.
--
-- Rollback: drop trigger + drop function + drop column (a coluna é aditiva,
-- nada lê ela como obrigatória).

alter table public.whatsapp_groups_index
  add column if not exists instance_id uuid
  references public.whatsapp_instances(id) on delete set null;

-- 27.924 linhas: índice comum resolve em milissegundos. CONCURRENTLY não roda
-- dentro da transação da migration e aqui não se paga o custo de tabela grande.
create index if not exists idx_wgi_instance_id
  on public.whatsapp_groups_index(instance_id);

create or replace function public.whatsapp_groups_index_fill_instance_id()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Só recalcula quando o nome mudou (ou é insert): update de last_seen /
  -- message_count, que é o caminho quente do webhook, sai sem consulta extra.
  if tg_op = 'UPDATE'
     and new.instance_name is not distinct from old.instance_name
     and new.instance_id is not null then
    return new;
  end if;

  select w.id into new.instance_id
  from public.whatsapp_instances w
  where lower(w.instance_name) = lower(new.instance_name)
  limit 1;

  return new;
end;
$$;

drop trigger if exists trg_wgi_fill_instance_id on public.whatsapp_groups_index;
create trigger trg_wgi_fill_instance_id
  before insert or update on public.whatsapp_groups_index
  for each row execute function public.whatsapp_groups_index_fill_instance_id();

-- Backfill: 27.420 das 27.924 linhas casam por nome; as 504 restantes ficam
-- NULL de propósito — é o fóssil que a coluna existe para tornar visível.
update public.whatsapp_groups_index i
set instance_id = w.id
from public.whatsapp_instances w
where lower(w.instance_name) = lower(i.instance_name)
  and i.instance_id is null;

-- A busca de grupos passa a devolver o nome VIVO da instância quando o id
-- resolve, e só cai no texto histórico quando a instância sumiu do cadastro.
-- Assim o consumidor recebe um nome que ele consegue procurar.
create or replace function public.search_whatsapp_groups_by_tokens(
  p_tokens text[],
  p_instance_names text[] default null::text[],
  p_preferred_instance text default null::text,
  p_limit integer default 200
)
returns table(group_jid text, contact_name text, instance_name text, score real)
language sql
stable
as $function$
  WITH base AS (
    SELECT g.group_jid, g.contact_name,
           COALESCE(w.instance_name, g.instance_name) AS instance_name,
           1.0::real AS score
    FROM whatsapp_groups_index g
    LEFT JOIN whatsapp_instances w ON w.id = g.instance_id
    WHERE g.contact_name IS NOT NULL
      AND (p_instance_names IS NULL OR lower(COALESCE(w.instance_name, g.instance_name)) = ANY(SELECT lower(x) FROM unnest(p_instance_names) x))
      AND NOT EXISTS (
        SELECT 1 FROM unnest(p_tokens) t
        WHERE unaccent(lower(g.contact_name)) NOT ILIKE '%' || unaccent(lower(t)) || '%'
      )
  ),
  ranked AS (
    SELECT DISTINCT ON (group_jid) group_jid, contact_name, instance_name, score
    FROM base
    ORDER BY group_jid, (CASE WHEN p_preferred_instance IS NOT NULL AND lower(instance_name) = lower(p_preferred_instance) THEN 0 ELSE 1 END)
  )
  SELECT * FROM ranked ORDER BY contact_name LIMIT p_limit;
$function$;
