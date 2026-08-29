-- =============================================================================
-- Resumo por IA nasce junto com a peça (Externo, 29/08/2026).
--
-- Pedido do Raym: "já deveria ter o resumo em todos quando importasse". A
-- leitura (jm_ler_documento → edge jm-ler-peca, Gemini 2.5 Flash) era só sob
-- demanda; 4.314 peças com PDF estavam sem resumo.
--
-- Esteira: jm_ler_documentos_tick(N) dispara a leitura de até N peças sem
-- resumo por rodada (mais recentes primeiro), via pg_cron a cada 2 minutos.
-- Importação nova ganha resumo em minutos; o backfill drena sozinho (~15h).
--
-- leitura_disparada_em: peça cuja leitura falhou não vira loop quente — o tick
-- só re-tenta depois de 24h. jm_ler_documento continua idempotente ("ja lida").
--
-- Rollback (<5min):
--   select cron.unschedule('jm-ler-documentos-tick');
--   drop function public.jm_ler_documentos_tick(integer);
--   alter table public.jm_documentos drop column leitura_disparada_em;
-- =============================================================================

alter table public.jm_documentos
  add column if not exists leitura_disparada_em timestamptz;

comment on column public.jm_documentos.leitura_disparada_em is
  'Última vez que o tick disparou jm_ler_documento para esta peça. Evita '
  're-tentar em loop uma leitura que falha; re-tenta após 24h.';

create or replace function public.jm_ler_documentos_tick(p_limite integer default 10)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_disparadas integer := 0;
  r record;
begin
  for r in
    select d.id
      from public.jm_documentos d
     where d.storage_path is not null
       and d.oculta_em is null
       and (d.leitura_disparada_em is null or d.leitura_disparada_em < now() - interval '24 hours')
       and not exists (select 1 from public.jm_documento_leitura l where l.documento_id = d.id)
     order by d.stored_at desc nulls last, d.id desc
     limit greatest(1, least(coalesce(p_limite, 10), 50))
  loop
    update public.jm_documentos set leitura_disparada_em = now() where id = r.id;
    perform public.jm_ler_documento(r.id);
    v_disparadas := v_disparadas + 1;
  end loop;
  return v_disparadas;
end $$;

-- Só o cron chama; nenhum papel de cliente precisa executar o tick.
revoke execute on function public.jm_ler_documentos_tick(integer) from public, anon, authenticated;

select cron.schedule(
  'jm-ler-documentos-tick',
  '*/2 * * * *',
  $$select public.jm_ler_documentos_tick(10)$$
);
