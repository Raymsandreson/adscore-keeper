-- =============================================================================
-- PERGUNTAR À PEÇA — a conversa com o documento que sustenta o marco
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- PEDIDO DO RAYM (27/08/2026), na Conferência do processo:
--   "ter também uma ia para perguntar sobre a peça em si que subsidia o marco".
--
-- O QUE JÁ EXISTIA E POR QUE NÃO BASTAVA. `jm-ler-peca` lê a peça e devolve um
-- JSON FECHADO — espécie, valores, partes, cronograma. É extração, não leitura:
-- responde as perguntas que o prompt previu e nenhuma outra. A pergunta que
-- aparece na conferência é sempre a que ninguém previu: "esse não-provimento é
-- de mérito ou de agravo?", "essa certidão transitou para as duas partes?",
-- "o acordo aqui é o mesmo do termo de fl. 1819?". Para isso é preciso abrir a
-- peça para pergunta livre.
--
-- POR QUE UMA TABELA, E NÃO UMA CHAMADA DIRETA. Mesma razão de `jm_ler_documento`:
-- a chave da edge mora em `jm_config` (RLS ligada, sem policy — só service role
-- alcança) e o front nunca a vê. O disparo sai do banco por pg_net, que é
-- assíncrono, então a resposta precisa de um lugar para pousar. O efeito
-- colateral é bom: a pergunta e a resposta FICAM. A segunda pessoa que abrir o
-- mesmo marco lê o que a primeira já perguntou, em vez de pagar a leitura de
-- novo e receber uma resposta ligeiramente diferente.
--
-- O QUE ISTO NÃO FAZ: não altera marco, valor, estágio nem parcela. Resposta de
-- IA sobre peça é LEITURA — para virar número existe `jm_corrigir_valores_peca`,
-- que exige alguém confirmar. Aqui ninguém confirma nada.
--
-- LIMITE DE USO: 20 perguntas por peça por hora. A chave anônima do Externo está
-- no bundle, então qualquer um que abra o JS chega nesta RPC; sem teto, uma aba
-- em laço torra a cota do Gemini. 20 é folgado para uso humano e barato para
-- errar.
--
-- REVERSÃO:
--   drop function public.jm_perguntar_peca(bigint, text, text);
--   drop table public.jm_peca_pergunta;
-- =============================================================================

create table if not exists public.jm_peca_pergunta (
  id            bigserial primary key,
  documento_id  bigint not null references public.jm_documentos(id) on delete cascade,
  processo_cnj  text,
  -- De qual marco a pergunta saiu. É contexto para o modelo ("esta peça é a
  -- prova de Sentença em 09/06/2025") e é o que permite reabrir a conversa no
  -- mesmo lugar da trilha.
  marco_chave   text,
  marco_rotulo  text,
  pergunta      text not null,
  resposta      text,
  erro          text,
  modelo        text,
  criado_por    uuid,
  criado_em     timestamptz not null default now(),
  respondido_em timestamptz
);

create index if not exists idx_jm_peca_pergunta_doc
  on public.jm_peca_pergunta (documento_id, criado_em desc);

alter table public.jm_peca_pergunta enable row level security;

-- Leitura para `authenticated` (a sessão do app no Externo é anônima e cai
-- neste role). Escrita NÃO: quem grava é a RPC abaixo e o service role da edge.
drop policy if exists jm_peca_pergunta_select on public.jm_peca_pergunta;
create policy jm_peca_pergunta_select on public.jm_peca_pergunta
  for select to authenticated using (true);

comment on table public.jm_peca_pergunta is
  'Perguntas livres sobre uma peca dos autos e as respostas do modelo. Leitura, nunca numero oficial.';

-- ---------------------------------------------------------------------------
-- Dispara a pergunta. Devolve o id da linha para o front acompanhar.
-- ---------------------------------------------------------------------------
create or replace function public.jm_perguntar_peca(
  p_documento_id bigint,
  p_pergunta     text,
  p_marco_chave  text default null,
  p_marco_rotulo text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key      text;
  v_path     text;
  v_cnj      text;
  v_pergunta text := btrim(coalesce(p_pergunta, ''));
  v_id       bigint;
  v_na_hora  int;
begin
  if length(v_pergunta) < 3 then
    raise exception 'pergunta vazia';
  end if;
  if length(v_pergunta) > 1000 then
    raise exception 'pergunta longa demais (máximo 1000 caracteres)';
  end if;

  select storage_path, processo_cnj into v_path, v_cnj
  from public.jm_documentos where id = p_documento_id;
  if v_path is null then
    raise exception 'peça sem arquivo baixado — não dá para ler o que não está em casa';
  end if;

  select count(*) into v_na_hora
  from public.jm_peca_pergunta
  where documento_id = p_documento_id and criado_em > now() - interval '1 hour';
  if v_na_hora >= 20 then
    raise exception 'muitas perguntas para esta peça na última hora — espere um pouco';
  end if;

  select valor into v_key from public.jm_config where chave = 'jm_ler_peca_key';
  if v_key is null then raise exception 'jm_ler_peca_key nao configurada'; end if;

  insert into public.jm_peca_pergunta
    (documento_id, processo_cnj, marco_chave, marco_rotulo, pergunta, criado_por)
  values (p_documento_id, v_cnj, p_marco_chave, p_marco_rotulo, v_pergunta, auth.uid())
  returning id into v_id;

  perform net.http_post(
    'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/jm-perguntar-peca',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-jm-key', v_key),
    body := jsonb_build_object('pergunta_id', v_id),
    timeout_milliseconds := 120000);

  return v_id;
end;
$$;

comment on function public.jm_perguntar_peca(bigint, text, text, text) is
  'Enfileira uma pergunta livre sobre a peca e dispara jm-perguntar-peca por pg_net. Devolve o id para o front acompanhar a resposta.';

revoke all on function public.jm_perguntar_peca(bigint, text, text, text) from public;
grant execute on function public.jm_perguntar_peca(bigint, text, text, text) to authenticated;
