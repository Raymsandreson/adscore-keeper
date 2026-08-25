-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- APLICADA em 25/08/2026.
-- ============================================================================
-- O Raym, depois de trocar a peca de um marco: "mudei a documentacao, mas nada
-- mudou. Deveria abrir um popup com as mudancas que vao se suceder dessa — como
-- no caso e os valores."
--
-- Ele estava certo, e o motivo era este: nao havia como ler UMA peca sob
-- demanda. So existia `jm_ler_disparar`, que trabalha pela fila
-- (vw_jm_fila_leitura) e roda por cron — util para varredura, inutil para dar
-- retorno a quem acabou de anexar.
--
-- SECURITY DEFINER porque a chave da edge mora em `jm_config`, tabela com RLS e
-- sem policy: so o service role a alcanca. Sem isso, a alternativa seria expor a
-- chave no front, o que a tornaria publica.
--
-- DUAS GUARDAS, e as duas economizam dinheiro:
--
--   sem arquivo   peca sem storage_path nao tem o que ler.
--   ja lida       leitura existente nao se refaz. Cada chamada custa Gemini, e
--                 reler a mesma peca devolveria o mesmo resultado. Quem quer
--                 reler apaga a leitura antes — deliberado, nao acidental.
--
-- EXECUTE so para `authenticated`; `anon` foi revogado explicitamente.
--
-- PROVADO na hora de criar, com o termo de acordo do caso 88 (documento 15890,
-- "Documento Diverso", 08/04/2024, colhido dos autos em 24/08): a leitura
-- devolveu ACORDO, R$ 625.000, PARCELAMENTO, 11 parcelas e 5 partes com
-- 113.636,36 / 113.636,36 / 56.818,18 / 56.818,18 / 56.818,18 — os valores do
-- termo, ao centavo, contra os R$ 27.272,72 que a carteira mostra hoje.
--
-- REVERSAO:
--   drop function if exists public.jm_ler_documento(bigint);
-- ============================================================================

create or replace function public.jm_ler_documento(p_documento_id bigint)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_key text; v_path text;
begin
  select storage_path into v_path from public.jm_documentos where id = p_documento_id;
  if v_path is null then return 'sem arquivo'; end if;

  -- Ja lida: nao paga a chamada de novo. Quem quer reler apaga a leitura antes.
  if exists (select 1 from public.jm_documento_leitura where documento_id = p_documento_id) then
    return 'ja lida';
  end if;

  select valor into v_key from public.jm_config where chave = 'jm_ler_peca_key';
  if v_key is null then raise exception 'jm_ler_peca_key nao configurada'; end if;

  perform net.http_post(
    'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/jm-ler-peca',
    headers := jsonb_build_object('Content-Type','application/json','x-jm-key', v_key),
    body := jsonb_build_object('documento_id', p_documento_id),
    timeout_milliseconds := 120000);
  return 'disparada';
end $function$;

revoke all on function public.jm_ler_documento(bigint) from public, anon;
grant execute on function public.jm_ler_documento(bigint) to authenticated;

comment on function public.jm_ler_documento(bigint) is
  'Le UMA peca sob demanda, para a tela poder mostrar o que muda logo depois de anexar. SECURITY DEFINER porque a chave da edge mora em jm_config, que so o service role alcanca — o front nunca a ve.';
