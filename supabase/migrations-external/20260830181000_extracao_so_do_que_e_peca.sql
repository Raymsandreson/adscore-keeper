-- ============================================================================
-- Ajuste do gatilho de extração (medido logo após ligar, 30/08/2026):
-- o backfill capturou 1.727 anexos, mas 1.449 são IMAGENS PEQUENAS — logo e
-- assinatura de e-mail (image0.jpeg de poucos KB). Extrair assinatura no
-- Gemini é custo sem ganho, e pior: com lote 8/30min elas na frente da fila
-- atrasariam as peças de verdade em dias.
--
-- O que é peça, medido: 247 PDFs (213 de MTE/MPT/economia — os relatórios de
-- acidente e despachos que motivaram a Fase 2) + 31 imagens >= 100 KB
-- (documento escaneado). Total elegível: 278.
--
-- Mudanças:
--   - só entra na fila application/pdf ou imagem >= 100 KB;
--   - PDF na frente de imagem (a peça do MTE é PDF);
--   - lote 8 -> 12 (~278 elegíveis terminam em ~12h; teto diário ~576).
--
-- ROLLBACK: reaplicar a versão de 20260830180000 e voltar o cron para lote 8.
-- ============================================================================

create or replace function public.jm_anexos_extrair_disparar(p_lote integer default 12)
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
      -- Assinatura/logo fica fora: só PDF ou imagem grande (peça escaneada).
      and (mime_type = 'application/pdf'
           or (mime_type ~ '^image/' and coalesce(size_bytes, 0) >= 100000))
    order by (mime_type = 'application/pdf') desc, created_at
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

  delete from public.email_push_processados p
   using public.processual_email_anexos a
   where a.gmail_message_id = p.message_id
     and a.texto_extraido_at is not null
     and a.texto_extraido_at > p.processado_em;

  return v_disparados;
end $$;

-- Cron novo com o lote maior (unschedule + schedule: alter_job não troca o comando).
select cron.unschedule('jm-anexos-extrair');
select cron.schedule(
  'jm-anexos-extrair',
  '*/30 * * * *',
  $cmd$ select public.jm_anexos_extrair_disparar(12); $cmd$
);
