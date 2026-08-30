-- =============================================================================
-- Pipeline de atualizações processuais — Fases 1-3 da tarefa de 30/08/2026.
-- Banco alvo: Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- ORDEM DE ROLLOUT: esta migration roda ANTES do deploy da sync-email-push
-- v13 — a função nova grava data_presumida e chama jm_email_orfaos_upsert;
-- sem as colunas/RPC o upsert do feed falharia inteiro.
--
-- 1) process_updates.data_presumida
--    O fallback de layout desconhecido carimbava a DATA DO E-MAIL como
--    data_movimentacao: ato de 28/08 virava card vazio de 29/08 (9 cards só
--    em 29/08/2026). Agora o fallback grava data_movimentacao NULA e marca
--    data_presumida = true; o front mostra "sem data no e-mail" em vez de uma
--    data que o tribunal nunca disse.
--
-- 2) email_identificadores_orfaos — a aba "Sem vínculo"
--    O array cnjs_sem_cadastro era devolvido na resposta da função e jogado
--    fora. Identificador que não casa passa a ser LINHA: quantas vezes
--    apareceu, quando foi a última, de quem veio — ordenável por última
--    ocorrência (o backfill traz processo antigo; o que está vivo sobe).
--    Upsert por identificador via RPC, incrementando ocorrencias e
--    preservando o status que a equipe já deu (novo|ignorado|vinculado).
--
-- ROLLBACK:
--   drop function if exists public.jm_email_orfaos_upsert(jsonb);
--   drop table if exists public.email_identificadores_orfaos;
--   alter table public.process_updates drop column if exists data_presumida;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Fallback não inventa mais data
-- ---------------------------------------------------------------------------
alter table public.process_updates
  add column if not exists data_presumida boolean not null default false;

comment on column public.process_updates.data_presumida is
  'true = o e-mail não trouxe a data do ato (layout desconhecido) e data_movimentacao ficou nula de propósito. O front trata como "sem data", nunca como a data do e-mail.';

-- ---------------------------------------------------------------------------
-- 2) Identificadores órfãos (aba "Sem vínculo")
-- ---------------------------------------------------------------------------
create table if not exists public.email_identificadores_orfaos (
  -- Normalizado (só dígitos) — é a chave do upsert. A forma com máscara fica
  -- em identificador_exibicao, que é o que a aba mostra.
  identificador           text primary key,
  identificador_exibicao  text not null,
  tipo                    text not null
    check (tipo in ('cnj','sei','demanda_sit','ordem_servico','protocolo_inss','outro')),
  primeira_ocorrencia     timestamptz not null,
  ultima_ocorrencia       timestamptz not null,
  ocorrencias             integer not null default 1,
  ultimo_remetente        text,
  ultimo_assunto          text,
  ultimo_message_id       text,
  status                  text not null default 'novo'
    check (status in ('novo','ignorado','vinculado')),
  lead_process_id         uuid references public.lead_processes(id) on delete set null,
  vinculado_em            timestamptz,
  vinculado_por           uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.email_identificadores_orfaos is
  'Identificadores (CNJ, SEI, demanda SIT, OS, protocolo INSS) citados em e-mail de processual_emails sem processo cadastrado correspondente. Alimentada pela sync-email-push via jm_email_orfaos_upsert; a aba "Sem vínculo" do painel de atualizações vincula/cria/ignora.';

-- A aba ordena por última ocorrência desc — o backfill despeja processo de
-- 2024 e o que está vivo tem que subir.
create index if not exists email_identificadores_orfaos_ultima_idx
  on public.email_identificadores_orfaos (status, ultima_ocorrencia desc);

alter table public.email_identificadores_orfaos enable row level security;

-- Mesmo desenho das demais tabelas do painel: front entra como authenticated
-- (signInAnonymously); a escrita de novas linhas é só da função (service role,
-- ignora RLS). Authenticated pode LER e ATUALIZAR (vincular/ignorar), não
-- inserir nem apagar.
create policy email_orfaos_read_authenticated
  on public.email_identificadores_orfaos for select to authenticated using (true);
create policy email_orfaos_update_authenticated
  on public.email_identificadores_orfaos for update to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Upsert em lote: soma ocorrências, avança a última aparição, preserva status.
-- p_itens: [{identificador, tipo, ocorrido_em, remetente, assunto, message_id,
--            ocorrencias}]
-- `identificador` chega como apareceu no e-mail (com máscara) — normalizamos
-- aqui para a chave e guardamos a máscara para exibição.
-- ---------------------------------------------------------------------------
create or replace function public.jm_email_orfaos_upsert(p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
begin
  insert into public.email_identificadores_orfaos as o (
    identificador, identificador_exibicao, tipo,
    primeira_ocorrencia, ultima_ocorrencia, ocorrencias,
    ultimo_remetente, ultimo_assunto, ultimo_message_id
  )
  select
    regexp_replace(i->>'identificador', '\D', '', 'g'),
    i->>'identificador',
    i->>'tipo',
    (i->>'ocorrido_em')::timestamptz,
    (i->>'ocorrido_em')::timestamptz,
    coalesce((i->>'ocorrencias')::integer, 1),
    i->>'remetente',
    i->>'assunto',
    i->>'message_id'
  from jsonb_array_elements(p_itens) i
  where coalesce(regexp_replace(i->>'identificador', '\D', '', 'g'), '') <> ''
    and i->>'tipo' in ('cnj','sei','demanda_sit','ordem_servico','protocolo_inss','outro')
  on conflict (identificador) do update set
    ocorrencias        = o.ocorrencias + excluded.ocorrencias,
    -- greatest: o reprocessamento pode revisitar e-mail antigo; a última
    -- aparição não pode andar para trás.
    ultima_ocorrencia  = greatest(o.ultima_ocorrencia, excluded.ultima_ocorrencia),
    primeira_ocorrencia = least(o.primeira_ocorrencia, excluded.primeira_ocorrencia),
    ultimo_remetente   = case when excluded.ultima_ocorrencia >= o.ultima_ocorrencia
                              then excluded.ultimo_remetente else o.ultimo_remetente end,
    ultimo_assunto     = case when excluded.ultima_ocorrencia >= o.ultima_ocorrencia
                              then excluded.ultimo_assunto else o.ultimo_assunto end,
    ultimo_message_id  = case when excluded.ultima_ocorrencia >= o.ultima_ocorrencia
                              then excluded.ultimo_message_id else o.ultimo_message_id end,
    updated_at         = now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Só a service role chama (a função roda no cron); nada de expor a anon.
revoke all on function public.jm_email_orfaos_upsert(jsonb) from public, anon, authenticated;
