-- =============================================================================
-- Atualização da carteira inteira pelo Escavador — fila temporária (02/09/2026)
--
-- Pedido do usuário: "deixe todos os processos atualizados pelo Escavador".
-- Medido antes: dos 1.217 processos judiciais com CNJ (trabalhista + BPC),
-- 532 nunca tinham sido consultados e 217 estavam com consulta > 30 dias.
--
-- Como: uma fila por POP (offset de 25 em 25) e um tick de pg_cron a cada
-- 2 minutos que chama a edge `backfill-process-marcos` (modo backfill,
-- confirm BACKFILL, limit 25) via pg_net — a mesma forma que o cron do radar
-- usa (20260831120000). Um disparo por vez: sem concorrência contra o rate
-- limit do Escavador. Quando a fila acaba o próprio tick se desagenda.
--
-- Custo: 1 consulta /movimentacoes por CNJ (+ 1 consulta de capa nos que não
-- têm data de início). Pelo preço de referência da API (R$ 0,10 por consulta
-- de movimentações) a ordem de grandeza é R$ 150–250 na carteira toda; o valor
-- exato de cada chamada vem no header Creditos-Utilizados da API, que a edge
-- não guarda. `data_ultima_verificacao` fica carimbada em cada processo.
--
-- A régua (pop-marcos-tick, 30 em 30 min) absorve as movimentações novas sem
-- passo extra.
--
-- Acompanhar:  select * from zz_backfill_escavador_fila_20260902;
--              select id, status_code, left(content::text,300) from net._http_response order by id desc limit 5;
-- Parar:       select cron.unschedule('zz-backfill-escavador-20260902');
-- Limpar:      drop function zz_backfill_escavador_tick(); drop table zz_backfill_escavador_fila_20260902;
-- =============================================================================
-- (aplicado direto no Externo em 02/09/2026 — este arquivo é o registro)

create table if not exists public.zz_backfill_escavador_fila_20260902 (
  workflow_id uuid primary key,
  proximo_offset integer not null default 0,
  total integer not null,
  disparos integer not null default 0,
  ultimo_request_id bigint,
  ultimo_em timestamptz
);
alter table public.zz_backfill_escavador_fila_20260902 enable row level security;

insert into public.zz_backfill_escavador_fila_20260902 (workflow_id, total)
select p.workflow_id::uuid, count(*)
from public.lead_processes p
where p.deleted_at is null and p.process_number is not null
  and p.workflow_id in ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15','8377ee1b-97a2-4777-9b51-3af9e630b3c6')
group by p.workflow_id
on conflict (workflow_id) do nothing;

create or replace function public.zz_backfill_escavador_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_req bigint;
begin
  select * into r from public.zz_backfill_escavador_fila_20260902
  where proximo_offset < total order by workflow_id limit 1;
  if not found then
    perform cron.unschedule('zz-backfill-escavador-20260902');
    return jsonb_build_object('fim', true, 'em', now());
  end if;

  select net.http_post(
    url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/backfill-process-marcos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- chave ANON pública do Externo (a mesma do cron do radar)
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttZWRsZGxlcHdpaXR5anNkYWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTExOTAsImV4cCI6MjA5MDQ2NzE5MH0.s51bWtABFjJGfGyuPFWr5Tp8CzbxPD5eieFUqUVuQTs'
    ),
    body := jsonb_build_object(
      'mode', 'backfill', 'confirm', 'BACKFILL', 'limit', 25,
      'offset', r.proximo_offset, 'workflow_id', r.workflow_id::text
    ),
    timeout_milliseconds := 300000
  ) into v_req;

  update public.zz_backfill_escavador_fila_20260902
     set proximo_offset = proximo_offset + 25, disparos = disparos + 1,
         ultimo_request_id = v_req, ultimo_em = now()
   where workflow_id = r.workflow_id;

  return jsonb_build_object('workflow_id', r.workflow_id, 'offset', r.proximo_offset, 'request_id', v_req);
end $$;

select cron.schedule('zz-backfill-escavador-20260902', '*/2 * * * *', $$ select public.zz_backfill_escavador_tick(); $$);
