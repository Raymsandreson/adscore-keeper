-- =============================================================================
-- A data da última movimentação passa a se atualizar sozinha.
--
-- O DEFEITO
-- `lead_processes.data_ultima_movimentacao` é escrita SÓ quando alguém cadastra
-- ou edita o processo na mão (AddProcessDialog, ProcessDetailSheet). É uma foto
-- tirada uma vez. Nada a atualiza quando chega movimentação nova — e chega
-- muita: 1691 movimentações ingeridas nos últimos 7 dias.
--
-- Resultado, medido em 05/09/2026 nos 1731 processos com CNJ:
--    597  coluna NULA, com movimentação gravada no feed
--    329  coluna ATRASADA (pior caso: 1363 dias)
--    926  total a corrigir
--   1136  invisíveis no "Relatório de processos parados", que filtra
--         `data_ultima_movimentacao is not null` — a tela feita para achar
--         processo esquecido não enxerga 2 em cada 3.
--
-- O histórico sempre esteve certo: `process_updates` e `jm_decisoes` guardam
-- cada movimentação, uma linha por evento, e nada é sobrescrito. O que faltava
-- era o PONTEIRO — o campo que diz "a mais recente é esta" — andar junto.
-- É isso que o gatilho abaixo faz. O histórico continua intocado.
--
-- TRÊS COISAS, NESTA ORDEM
--   1. Destravar o UPDATE em lead_processes (senão o backfill aborta)
--   2. Encher o que falta, guardando o valor antigo
--   3. Ligar o gatilho para não faltar de novo
--
-- ROLLBACK (menos de 1 minuto, sem perda):
--   drop trigger if exists trg_pu_avanca_ult_mov on public.process_updates;
--   drop trigger if exists trg_jd_avanca_ult_mov on public.jm_decisoes;
--   update public.lead_processes lp
--      set data_ultima_movimentacao = b.valor_antigo
--     from public.lead_processes_ult_mov_backup_20260905 b
--    where b.process_id = lp.id;
-- =============================================================================

-- Cast que não explode com texto fora do formato. A coluna é TEXT; hoje toda
-- ela é ISO ou nula, mas o dia em que não for não pode derrubar o gatilho.
create or replace function public.data_iso_ou_nulo(p_txt text)
returns date
language sql
immutable
as $function$
  select case
           when p_txt ~ '^\s*\d{4}-\d{2}-\d{2}'
           then left(btrim(p_txt), 10)::date
         end;
$function$;

-- -----------------------------------------------------------------------------
-- 1. O gatilho anti-duplicata só olha o que pode CRIAR duplicata
-- -----------------------------------------------------------------------------
-- Ele roda BEFORE INSERT OR UPDATE e refaz a checagem inteira em toda edição.
-- Como 100 fichas da base já eram duplicatas ANTES do gatilho existir, hoje
-- elas estão congeladas: mudar o telefone, o título ou qualquer campo levanta
-- 23505 e o salvamento falha. Ninguém percebeu porque o erro sai como "Processo
-- já cadastrado", que parece explicação e não é.
--
-- Duplicata só nasce de CNJ ou de cliente. Uma edição que não mexe em nenhum
-- dos dois não pode criar duplicata nenhuma — então passa direto. O gatilho
-- continua barrando exatamente o que sempre barrou: cadastro novo e troca de
-- CNJ/cliente.
create or replace function public.lead_processes_sem_duplicata()
returns trigger
language plpgsql
as $function$
declare
  v_cnj    text;
  v_existe uuid;
  v_motivo text;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  -- Edição que não toca em CNJ nem em cliente não pode criar duplicata.
  if tg_op = 'UPDATE'
     and new.process_number is not distinct from old.process_number
     and new.lead_id        is not distinct from old.lead_id then
    return new;
  end if;

  v_cnj := public.cnj_digitos(new.process_number);

  if v_cnj is null or length(v_cnj) <> 20 then
    return new;
  end if;

  if new.lead_id is null then
    select id into v_existe
      from public.lead_processes
     where id <> new.id and deleted_at is null
       and public.cnj_digitos(process_number) = v_cnj
     limit 1;
    v_motivo := 'Ficha sem cliente nao pode dividir CNJ com outra ficha: sem cliente ela nao e uma unidade (processo x cliente), e cadastro solto.';
  else
    select id into v_existe
      from public.lead_processes
     where id <> new.id and deleted_at is null
       and public.cnj_digitos(process_number) = v_cnj
       and (lead_id = new.lead_id or lead_id is null)
     limit 1;
    v_motivo := 'Mesmo CNJ em cliente DIFERENTE e litisconsorcio e e permitido; mesmo cliente, ou ficha sem cliente, e duplicata.';
  end if;

  if v_existe is not null then
    raise exception using
      errcode = '23505',
      message = format('Processo %s ja cadastrado.', new.process_number),
      detail  = format('Ficha existente: %s. Abra ela em vez de criar outra.', v_existe),
      hint    = v_motivo;
  end if;

  return new;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 2. Backfill, com o valor antigo guardado
-- -----------------------------------------------------------------------------
create table if not exists public.lead_processes_ult_mov_backup_20260905 (
  process_id    uuid primary key,
  valor_antigo  text,
  valor_novo    text,
  feito_em      timestamptz not null default now()
);

comment on table public.lead_processes_ult_mov_backup_20260905 is
  'Foto de data_ultima_movimentacao antes do backfill de 05/09/2026. Rollback esta no cabecalho da migration.';

with por_cnj as (
  select dom_so_digitos(numero_cnj) as cnj, max(data_movimentacao) as em
    from public.process_updates
   where numero_cnj is not null and coalesce(data_presumida, false) = false
   group by 1
  union all
  select dom_so_digitos(processo_cnj), max(data_decisao)
    from public.jm_decisoes
   where processo_cnj is not null
   group by 1
),
f as (select cnj, max(em) as em from por_cnj group by 1),
por_id as (
  select process_id, max(data_movimentacao) as em
    from public.process_updates
   where process_id is not null and coalesce(data_presumida, false) = false
   group by 1
),
alvo as (
  select pr.id,
         public.data_iso_ou_nulo(pr.data_ultima_movimentacao) as coluna,
         greatest(f.em, pi.em)                                as feed
    from public.lead_processes pr
    left join f      on f.cnj = dom_so_digitos(pr.process_number)
    left join por_id pi on pi.process_id = pr.id
   where pr.deleted_at is null
     and pr.process_number is not null
)
insert into public.lead_processes_ult_mov_backup_20260905 (process_id, valor_antigo, valor_novo)
select id, coluna::text, to_char(feed, 'YYYY-MM-DD')
  from alvo
 where feed is not null
   and (coluna is null or feed > coluna)
on conflict (process_id) do nothing;

update public.lead_processes lp
   set data_ultima_movimentacao = b.valor_novo
  from public.lead_processes_ult_mov_backup_20260905 b
 where b.process_id = lp.id
   and b.valor_novo is not null
   and lp.data_ultima_movimentacao is distinct from b.valor_novo;

-- -----------------------------------------------------------------------------
-- 3. Daqui para frente, o ponteiro anda sozinho
-- -----------------------------------------------------------------------------
-- Cada movimentação nova (process_updates) e cada decisão nova (jm_decisoes)
-- empurram a data para frente, se forem mais recentes. O histórico não é
-- tocado: continua uma linha por evento nas tabelas de origem.
--
-- Só empurra para FRENTE. Reprocessamento que traga movimentação antiga não
-- faz a data andar para trás.
--
-- Data presumida não conta: `data_presumida = true` é chute do parser quando o
-- e-mail não trazia data. Deixar um chute definir "última movimentação" seria
-- trocar uma coluna vazia por uma coluna mentirosa.
create or replace function public.lead_processes_avanca_ultima_movimentacao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_data date;
  v_cnj  text;
  v_pid  uuid;
begin
  if tg_table_name = 'process_updates' then
    if coalesce(new.data_presumida, false) then
      return new;
    end if;
    v_data := new.data_movimentacao;
    v_cnj  := nullif(dom_so_digitos(new.numero_cnj), '');
    v_pid  := new.process_id;
  else
    v_data := new.data_decisao;
    v_cnj  := nullif(dom_so_digitos(new.processo_cnj), '');
    v_pid  := null;
  end if;

  if v_data is null or v_data > current_date then
    return new;
  end if;

  update public.lead_processes lp
     set data_ultima_movimentacao = to_char(v_data, 'YYYY-MM-DD')
   where lp.deleted_at is null
     and (
       (v_cnj is not null and dom_so_digitos(lp.process_number) = v_cnj)
       or (v_pid is not null and lp.id = v_pid)
     )
     and coalesce(public.data_iso_ou_nulo(lp.data_ultima_movimentacao), '-infinity'::date) < v_data;

  return new;
end;
$function$;

drop trigger if exists trg_pu_avanca_ult_mov on public.process_updates;
create trigger trg_pu_avanca_ult_mov
  after insert on public.process_updates
  for each row
  execute function public.lead_processes_avanca_ultima_movimentacao();

drop trigger if exists trg_jd_avanca_ult_mov on public.jm_decisoes;
create trigger trg_jd_avanca_ult_mov
  after insert on public.jm_decisoes
  for each row
  execute function public.lead_processes_avanca_ultima_movimentacao();
