-- =============================================================================
-- Segredo compartilhado entre o banco (quem dispara) e a edge function
-- `jm-ler-peca` (quem executa). A função roda com verify_jwt = false porque quem
-- chama é o pg_net, sem sessão de usuário — a verificação de origem tem que ser
-- manual. Sem ela era um endpoint público que queimava Gemini e lia autos do
-- bucket privado para quem descobrisse a URL.
--
-- Por que uma tabela e não env var / chave literal: não há secret no
-- repositório e o valor nunca aparece em código. RLS ligada e SEM policy
-- nenhuma: só quem ignora RLS (service_role, e o próprio banco) lê. anon e
-- authenticated não alcançam a tabela nem por engano.
-- =============================================================================
create table if not exists public.jm_config (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);

alter table public.jm_config enable row level security;
revoke all on public.jm_config from anon, authenticated;

insert into public.jm_config (chave, valor)
values ('jm_ler_peca_key', encode(gen_random_bytes(32), 'hex'))
on conflict (chave) do nothing;

-- =============================================================================
-- jm_ler_disparar — solta a fila de leitura de peças, em lote.
--
-- Mesmo desenho do `jm_esc_disparar`: o banco chama a edge function por pg_net,
-- de forma assíncrona. A resposta cai em `net._http_response`; quem confirma que
-- a peça foi lida é a linha em `jm_documento_leitura` (a própria função grava).
--
-- Só manda o que ainda NÃO foi lido (`ja_lido = false` na vw_jm_fila_leitura),
-- então re-rodar é seguro: não paga Gemini duas vezes pela mesma peça.
-- Ordem por prioridade: alvará/comprovante/guia primeiro, depois decisão e
-- sentença — é onde o dinheiro aparece.
-- =============================================================================
create or replace function public.jm_ler_disparar(p_limit integer default 25)
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_rec record;
  v_n int := 0;
  v_key text;
begin
  select valor into v_key from public.jm_config where chave = 'jm_ler_peca_key';
  if v_key is null then
    raise exception 'jm_ler_peca_key não configurada em jm_config';
  end if;

  for v_rec in
    select documento_id from public.vw_jm_fila_leitura
    where not ja_lido
    order by prioridade, data_documento desc nulls last, documento_id
    limit p_limit
  loop
    perform net.http_post(
      'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/jm-ler-peca',
      headers := jsonb_build_object('Content-Type','application/json','x-jm-key', v_key),
      body := jsonb_build_object('documento_id', v_rec.documento_id),
      timeout_milliseconds := 120000);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $function$;

revoke all on function public.jm_ler_disparar(integer) from anon, authenticated;
