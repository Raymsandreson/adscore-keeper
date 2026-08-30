-- ============================================================================
-- Fase 2, pendência (b) — o GATILHO da extração de texto dos anexos.
-- Banco alvo: Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- O modo {anexo_id} da jm-ler-peca existe desde 30/08/2026, mas ninguém o
-- chamava: anexo entrava no bucket e ficava lá, sem texto — e sem texto a
-- sync-email-push não tem onde varrer identificador. Aqui nasce o laço
-- completo:
--
--   1. jm_anexos_extrair_disparar(p_lote): pega até p_lote anexos SEM texto,
--      dispara a jm-ler-peca (mesmo desenho do jm_ler_documento: chave em
--      jm_config, pg_net) e carimba extracao_disparada_at — é o carimbo que
--      impede pagar o Gemini duas vezes pelo mesmo anexo quando o cron gira
--      antes de a extração terminar. Falhou? Depois de 2h sem texto o carimbo
--      expira e o anexo volta à fila.
--
--   2. A MESMA função re-enfileira no parser o e-mail cujo anexo GANHOU texto
--      depois de o e-mail já ter sido processado: apaga a marca de
--      email_push_processados quando texto_extraido_at > processado_em. Na
--      rodada seguinte do cron horário a sync-email-push relê o e-mail, agora
--      COM o texto do PDF, e o identificador do MTE que só existe lá dentro
--      ("Saudações, para ciência" + Despacho_2688783.pdf) finalmente aparece.
--      Auto-terminante: reprocessado, processado_em passa à frente do texto e
--      a condição para de casar.
--
--   3. Cron a cada 30 min, lote 8 — teto de ~384 extrações/dia. Cada extração
--      custa uma chamada Gemini; o lote é o freio de custo.
--
-- ROLLBACK:
--   select cron.unschedule('jm-anexos-extrair');
--   drop function if exists public.jm_anexos_extrair_disparar(integer);
--   alter table public.processual_email_anexos drop column if exists extracao_disparada_at;
-- ============================================================================

alter table public.processual_email_anexos
  add column if not exists extracao_disparada_at timestamptz;

comment on column public.processual_email_anexos.extracao_disparada_at is
  'Quando a extração foi disparada pela última vez. Null = nunca. Com texto_extraido null e carimbo de mais de 2h, o cron re-tenta.';

create or replace function public.jm_anexos_extrair_disparar(p_lote integer default 8)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_anexo record;
  v_disparados integer := 0;
begin
  select valor into v_key from public.jm_config where chave = 'jm_ler_peca_key';
  if v_key is null then raise exception 'jm_ler_peca_key nao configurada'; end if;

  for v_anexo in
    select id from public.processual_email_anexos
    where texto_extraido is null
      and (extracao_disparada_at is null or extracao_disparada_at < now() - interval '2 hours')
    order by created_at
    limit greatest(p_lote, 0)
  loop
    perform net.http_post(
      'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/jm-ler-peca',
      headers := jsonb_build_object('Content-Type','application/json','x-jm-key', v_key),
      body := jsonb_build_object('anexo_id', v_anexo.id),
      timeout_milliseconds := 120000);
    update public.processual_email_anexos
       set extracao_disparada_at = now()
     where id = v_anexo.id;
    v_disparados := v_disparados + 1;
  end loop;

  -- E-mail já processado cujo anexo ganhou texto DEPOIS: volta à fila do
  -- parser para a varredura de identificadores enxergar o conteúdo do PDF.
  delete from public.email_push_processados p
   using public.processual_email_anexos a
   where a.gmail_message_id = p.message_id
     and a.texto_extraido_at is not null
     and a.texto_extraido_at > p.processado_em;

  return v_disparados;
end $$;

revoke all on function public.jm_anexos_extrair_disparar(integer) from public, anon, authenticated;

comment on function public.jm_anexos_extrair_disparar(integer) is
  'Cron: dispara a extração de texto (jm-ler-peca modo anexo) para anexos sem texto e re-enfileira no parser os e-mails cujos anexos acabaram de ganhar texto. Lote pequeno de propósito — cada disparo custa Gemini.';

select cron.schedule(
  'jm-anexos-extrair',
  '*/30 * * * *',
  $cmd$ select public.jm_anexos_extrair_disparar(8); $cmd$
);
