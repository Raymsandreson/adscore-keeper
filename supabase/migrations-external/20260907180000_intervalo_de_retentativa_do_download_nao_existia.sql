-- =============================================================================
-- O intervalo de 6h entre retentativas de download nunca existiu.
--
-- O QUE ESTAVA ESCRITO em jm_esc_arquivar_tick:
--     and coalesce(stored_at, '-infinity'::timestamptz) < now() - interval '6 hours'
--
-- A intenção é clara: só devolver à fila quem já esperou 6 horas. Mas `stored_at`
-- só é preenchido quando o download DÁ CERTO. Para a peça que nunca baixou —
-- exatamente a população que esta cláusula existe para tratar — `stored_at` é
-- nulo, o coalesce vira `-infinity`, e a condição é SEMPRE verdadeira.
--
-- Resultado: retentativa a cada 5 minutos, não a cada 6 horas. 288 tentativas
-- por dia por peça, não 4. O relógio media o tempo do sucesso que nunca houve.
--
-- COMO APARECEU. Em 07/09/2026 zerei `download_tentativas` de 11 peças às 12:05
-- e reabri a consulta ao Escavador para elas ganharem link novo. A consulta
-- terminou às 12:40 e renovou os links (medido: processados 10, 22, 35, 54, 65,
-- 100). Só que entre 12:05 e 12:40 o tick já tinha gasto as TRÊS tentativas do
-- teto novo batendo nos links VELHOS. Quando o link bom chegou, a peça já
-- estava parqueada.
--
-- O teto que eu pus ontem estava certo; o relógio ao lado dele é que estava
-- quebrado desde sempre — e sem o teto, o defeito seria um laço de 5 em 5
-- minutos, muito pior do que os "4x por dia" que eu estimei.
--
-- O CONSERTO: uma coluna que marca QUANDO se tentou, e não quando deu certo.
--
-- ROLLBACK:
--   alter table public.jm_documentos drop column if exists download_ultima_tentativa;
--   (e recriar jm_esc_arquivar_tick da migration 20260907170000)
-- =============================================================================

alter table public.jm_documentos
  add column if not exists download_ultima_tentativa timestamptz;

comment on column public.jm_documentos.download_ultima_tentativa is
  'Quando a peca foi devolvida a fila de download pela ultima vez. Existe porque o intervalo de 6h era medido por `stored_at`, que so e preenchido quando o download DA CERTO: para quem nunca baixou o coalesce virava -infinity e a retentativa acontecia a cada 5 minutos.';

create or replace function public.jm_esc_arquivar_tick()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_devolvidos int;
  v_fila       int;
begin
  -- Erro passageiro volta para a fila; erro permanente fica de fora.
  -- HTTP_404 = a peca nao existe mais no Escavador
  -- NAO_PDF  = o que veio no link nao e um PDF
  -- O resto (5xx deles, UPLOAD do nosso storage, timeout, PDF_SEM_FIM) e
  -- tropeco -- mas tropeco COM TETO e COM RELOGIO.
  --
  -- O relogio agora e `download_ultima_tentativa`, e nao `stored_at`. stored_at
  -- so e preenchido quando o download da certo: para a peca que nunca baixou
  -- ele e nulo, o coalesce virava -infinity e a condicao passava sempre. O
  -- intervalo de 6 horas nunca existiu na pratica -- eram 5 minutos.
  with volta as (
    update public.jm_documentos
       set storage_error             = null,
           download_tentativas       = coalesce(download_tentativas, 0) + 1,
           download_ultima_tentativa = now()
     where storage_path is null
       and storage_error is not null
       and storage_error !~* '^(HTTP_4|NAO_PDF)'
       and coalesce(download_tentativas, 0) < 3
       and coalesce(download_ultima_tentativa, '-infinity'::timestamptz) < now() - interval '6 hours'
    returning 1
  ) select count(*) into v_devolvidos from volta;

  select count(*) into v_fila
    from public.jm_documentos
   where storage_path is null and storage_error is null and link_api is not null;

  if v_fila = 0 then
    return format('nada a baixar (devolvidos=%s)', v_devolvidos);
  end if;

  perform net.http_post(
    'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/esc-autos?k=lp-esc-2026-df3',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := jsonb_build_object('acao','arquivar','limite',60,'concorrencia',8,'orcamento_ms',110000),
    timeout_milliseconds := 130000);

  return format('disparado: fila=%s devolvidos=%s', v_fila, v_devolvidos);
end $function$;

comment on function public.jm_esc_arquivar_tick() is
  'Devolve a fila o erro passageiro (ate 3 vezes, respeitando 6h entre tentativas) e dispara a acao arquivar do esc-autos. HTTP_4xx e NAO_PDF sao veredito permanente e nao voltam.';

-- As 11 pecas gastaram as tres tentativas nos links velhos, entre o zeramento
-- e a chegada dos links novos. Ganham o teto de volta uma vez, agora que o
-- link e bom -- e desta vez o relogio segura o intervalo.
update public.jm_documentos
   set download_tentativas = 0,
       download_ultima_tentativa = null,
       storage_error = null
 where id in (select documento_id from public.zz_pdf_sem_pagina_bkp_20260907)
   and storage_path is null;
