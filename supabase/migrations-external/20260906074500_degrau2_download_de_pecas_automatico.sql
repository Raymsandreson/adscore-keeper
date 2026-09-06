-- =============================================================================
-- O download das peças passa a ser automático.
--
-- O DEFEITO
-- A corrente que leva uma peça do tribunal até a resposta do cliente tem
-- quatro degraus:
--
--   1. consulta Escavador  → linha em jm_documentos, com link_api    OK
--   2. download do arquivo → storage_path preenchido                 ← ESTE
--   3. leitura pela IA     → jm_documento_leitura.resumo
--   4. entra no prompt     → blocoProcessual só usa doc COM resumo
--
-- O degrau 2 é a ação `arquivar` do edge `esc-autos`. Ela existe, funciona, e
-- **nunca teve cron**. Alguém rodava na mão. A última vez foi em 25/08/2026 às
-- 22:07 — 12 dias antes desta migration.
--
-- Consequência em cascata, medida em 06/09/2026 07h30:
--   4.761 documentos com link_api e sem arquivo baixado
--   3.246 documentos só com metadado
--       0 leituras em 24h (o degrau 3 exige storage_path, então roda a cada 2
--         minutos, reporta "succeeded" e seleciona zero linhas)
--       0 documentos chegando ao prompt do assessor
--
-- É o mesmo padrão dos outros defeitos desta sessão: a etapa devolve sucesso
-- por ter rodado, não por ter feito. Três crons verdes em fila, nenhum
-- trabalho acontecendo.
--
-- O CONSERTO
--
--   1. `jm_esc_arquivar_tick()` + cron de 5 em 5 minutos. A ação `arquivar` já
--      é auto-limitada (orçamento de 110s, lotes de 60, concorrência 8) e
--      repete até esvaziar a fila ou estourar o tempo. 5 minutos > 110s, então
--      não há sobreposição de rodadas.
--
--   2. Erro passageiro deixa de ser sentença. Hoje `storage_error` exclui a
--      linha PARA SEMPRE — a seleção do `arquivar` é
--      `storage_path is null and storage_error is null`. Entre os 139
--      excluídos, 138 são HTTP_404 (a peça não existe mais no Escavador:
--      permanente, exclusão correta) e 1 é falha do NOSSO storage, que é
--      passageira e mesmo assim estava condenada.
--
--      O tick passa a limpar o erro das famílias passageiras depois de 6h,
--      devolvendo a linha para a fila. 404 e NAO_PDF continuam permanentes:
--      documento que não existe não passa a existir por insistência.
--
-- CUSTO: nenhum crédito do Escavador. `arquivar` só baixa o que a consulta já
-- pagou. O gasto é storage e banda.
--
-- ROLLBACK (imediato):
--   select cron.unschedule('jm-esc-arquivar');
-- =============================================================================

-- 1. O tique do degrau 2 -----------------------------------------------------
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
  -- HTTP_404  = a peça não existe mais no Escavador
  -- NAO_PDF   = o que veio no link não é um PDF
  -- O resto (5xx do servidor deles, UPLOAD do nosso storage, timeout) é
  -- tropeço, não veredito.
  with volta as (
    update public.jm_documentos
       set storage_error = null
     where storage_path is null
       and storage_error is not null
       and storage_error !~* '^(HTTP_4|NAO_PDF)'
       and coalesce(stored_at, '-infinity'::timestamptz) < now() - interval '6 hours'
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
    -- Maior que o orçamento da função, senão o pg_net desiste antes dela.
    timeout_milliseconds := 130000);

  return format('disparado: fila=%s devolvidos=%s', v_fila, v_devolvidos);
end $function$;

comment on function public.jm_esc_arquivar_tick() is
  'Degrau 2 da corrente do documento: baixa a peca do link_api para o bucket. A acao arquivar existia desde sempre e nunca teve cron — a ultima execucao foi manual, em 25/08/2026.';

-- 2. De 5 em 5 minutos. O orcamento da funcao e 110s, entao nao sobrepoe.
select cron.schedule('jm-esc-arquivar', '*/5 * * * *', $$select public.jm_esc_arquivar_tick()$$);

-- 3. O unico erro passageiro que estava condenado volta para a fila agora.
update public.jm_documentos
   set storage_error = null
 where storage_path is null
   and storage_error is not null
   and storage_error !~* '^(HTTP_4|NAO_PDF)';
