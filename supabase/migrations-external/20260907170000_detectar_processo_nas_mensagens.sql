-- =============================================================================
-- Etapa 6a — detectar número de processo nas mensagens dos grupos e ENFILEIRAR.
--
-- Esta migration NÃO escreve em `lead_processes`. Ela só lê mensagem, valida e
-- classifica. A escrita na ficha do cliente é a 6b, e só depois de gente olhar
-- a lista — criar registro de processo a partir de texto de WhatsApp sem
-- ninguém conferir é o tipo de coisa que não se desfaz com um ctrl+Z.
--
-- O QUE FOI MEDIDO ANTES DE ESCREVER (07/09/2026)
--
--   whatsapp_messages      1.735.085 linhas / 7,1 GB — `count(*)` estoura 60s
--   custo por grupo        191 ms pelo idx_whatsapp_messages_phone
--   1.146 grupos           ~3,6 min de varredura completa, em lotes
--
--   amostra de 60 grupos-alvo (operacional + com lead + sem processo CNJ):
--     6 têm algum CNJ · 4 sem dúvida · 2 ambíguos
--   ou seja: o auto-vínculo rende ~40 fichas, não ~600. Melhor saber agora.
--
-- POR QUE SÓ MENSAGEM RECEBIDA
-- Medido nos mesmos grupos: `inbound` traz 139 CNJ distintos, `outbound` traz
-- 132 — subconjunto. Ignorar o que NÓS escrevemos não perde nenhum processo, e
-- tira do caminho o risco de reingerir alucinação do próprio assistente. Que
-- não é hipótese: dos 2.849 números achados, 3 reprovaram no verificador, e um
-- deles saiu daqui de dentro —
--
--     "Olha, o processo da Equiti Prev (0000000-00.2023.8.10.0001) está
--      aguardando a gente apresentar um recurso..."
--
-- Número todo zero, inventado pelo modelo e dito a um cliente. Sem `cnj_valido`
-- (módulo 97, ISO 7064) isso vira processo fantasma numa ficha.
--
-- TRÊS COISAS QUE O REQUISITO ORIGINAL NÃO PREVIU, E QUE OS DADOS IMPUSERAM
--
--   1. "Grupo sem processo -> vincula" não funciona em metade dos grupos.
--      Distribuição de CNJ distintos por grupo, em 79 medidos:
--        1 CNJ: 41 grupos | 2: 16 | 3: 16 | 4: 5 | 6: 1
--      Grupo com três números não tem "o processo": tem três candidatos.
--
--   2. O grupo também é ambíguo pelo lado do CLIENTE. Dos 844 grupos com lead,
--      276 têm mais de um (226 com 2, 43 com 3, um com 18). Não dá para saber
--      em qual ficha gravar.
--
--   3. "Já vinculado a número diferente" não é binário: 114 dos 325 leads com
--      processo têm MAIS de um CNJ (um tem 7). A comparação certa é de
--      pertinência a um conjunto, não igualdade com um valor.
--
-- Em todos os três a saída é a mesma e é a que o usuário já escolheu no item
-- 4d: PENDÊNCIA para humano, nunca escolha automática. Errar aqui é colocar o
-- processo de um cliente na ficha de outro.
--
-- A METÁFORA
-- Carteiro que acha três cartas sem remetente na mesma caixa. Ele não abre e
-- decide de quem é: separa e chama alguém. Entregar rápido no endereço errado
-- é pior que demorar.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A fila de pendências
--
-- Genérica de propósito: o item 4d (mensagem no privado de quem está em mais de
-- um grupo) vai precisar da mesma fila, e duas tabelas quase iguais viram duas
-- telas quase iguais.
-- -----------------------------------------------------------------------------
create table if not exists public.pendencias_vinculo (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null,
  group_jid    text,
  lead_id      uuid,
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'aberta',
  criado_em    timestamptz not null default now(),
  resolvido_por uuid,
  resolvido_em timestamptz,
  resolucao    text,
  constraint pendencias_vinculo_tipo_ck check (tipo in (
    'divergencia_processo',   -- o cliente já tem processo, e apareceu outro número
    'ambiguidade_processo',   -- o grupo cita 2+ processos válidos e o cliente não tem nenhum
    'ambiguidade_lead',       -- o grupo está ligado a 2+ clientes
    'vinculacao_ambigua'      -- reservado para o item 4d (privado 1:1)
  )),
  constraint pendencias_vinculo_status_ck check (status in ('aberta','resolvida','descartada'))
);

comment on table public.pendencias_vinculo is
  'Fila de decisões que o sistema se recusa a tomar sozinho. Uma linha aberta por (tipo, grupo).';

-- Uma pendência ABERTA por tipo e grupo. Sem isto, cada rodada da varredura
-- abriria a mesma pendência de novo e a tela viraria um repetidor.
create unique index if not exists uq_pendencias_vinculo_aberta
  on public.pendencias_vinculo (tipo, group_jid) where status = 'aberta';

create index if not exists idx_pendencias_vinculo_status
  on public.pendencias_vinculo (status, tipo);

alter table public.pendencias_vinculo enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
                  where c.relname='pendencias_vinculo' and p.polname='pendencias_vinculo_rw') then
    create policy pendencias_vinculo_rw on public.pendencias_vinculo
      for all to authenticated using (true) with check (true);
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. O rastro do que foi achado, e onde
--
-- Sem isto, "por que esse processo entrou nessa ficha?" não tem resposta daqui
-- a três meses — e é a primeira pergunta que alguém faz quando o número está
-- errado. `primeira_msg_id` é a origem que o requisito pediu ('auto: msg <id>').
-- -----------------------------------------------------------------------------
create table if not exists public.grupo_processo_detectado (
  group_jid       text not null,
  cnj             text not null,
  status          text not null,
  lead_id         uuid,
  ocorrencias     integer not null default 0,
  primeira_msg_id uuid,
  primeira_em     timestamptz,
  ultima_em       timestamptz,
  detectado_em    timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  primary key (group_jid, cnj),
  constraint grupo_processo_detectado_status_ck check (status in (
    'sugerido',      -- 1 CNJ, 1 cliente, cliente sem processo -> candidato da 6b
    'ignorado',      -- o cliente já tem esse número
    'divergente',    -- o cliente tem processo, e este número não é nenhum deles
    'ambiguo_cnj',   -- o grupo cita 2+ números válidos
    'ambiguo_lead',  -- o grupo está ligado a 2+ clientes
    'sem_lead'       -- o grupo não tem cliente vinculado
  )),
  constraint grupo_processo_detectado_cnj_ck check (cnj ~ '^[0-9]{20}$')
);

comment on table public.grupo_processo_detectado is
  'Numero de processo achado em mensagem de grupo, com origem e veredito. Nao vincula nada por si.';

create index if not exists idx_grupo_processo_detectado_status
  on public.grupo_processo_detectado (status);
create index if not exists idx_grupo_processo_detectado_cnj
  on public.grupo_processo_detectado (cnj);

alter table public.grupo_processo_detectado enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
                  where c.relname='grupo_processo_detectado' and p.polname='grupo_processo_detectado_rw') then
    create policy grupo_processo_detectado_rw on public.grupo_processo_detectado
      for all to authenticated using (true) with check (true);
  end if;
end $$;


-- Marca de até onde a varredura chegou. Sem ela, cada chamada olharia sempre os
-- mesmos primeiros grupos e o resto nunca seria varrido — o mesmo defeito que o
-- comentário de `dom_grupos_para_olhar` descreve para a fila de rascunhos.
alter table public.dom_grupos_piloto
  add column if not exists processos_varridos_em timestamptz;


-- -----------------------------------------------------------------------------
-- 3. A varredura
--
-- Processa `p_limite` grupos por chamada (a 191 ms cada, 50 grupos ~ 10 s) e
-- devolve quantos grupos olhou. Idempotente: reprocessar um grupo reescreve as
-- mesmas linhas por (group_jid, cnj).
-- -----------------------------------------------------------------------------
create or replace function public.detectar_processos_em_grupos(
  p_limite integer default 50,
  p_group_jid text default null
)
returns TABLE (grupos_varridos integer, cnjs_registrados integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- Regex do requisito. Casa o CNJ com ou sem máscara, e com máscara torta.
  -- Ela é só o PENEIRA: quem decide se é processo de verdade é cnj_valido().
  c_re constant text := '\d{7}[-.]?\d{2}[.]?\d{4}[.]?\d[.]?\d{2}[.]?\d{4}';
  v_grupos integer := 0;
  v_cnjs   integer := 0;
begin
  -- `on commit drop` limpa entre transacoes, mas duas chamadas DENTRO da mesma
  -- transacao (um `do $$ loop ... $$`, por exemplo) esbarrariam na tabela ja
  -- existente e a funcao morreria no meio do lote.
  drop table if exists _alvo;
  drop table if exists _lead_do_grupo;
  drop table if exists _cnjs_do_lead;
  drop table if exists _achado;
  drop table if exists _quantos_cnj;

  create temporary table _alvo on commit drop as
    select g.group_jid
      from public.dom_grupos_piloto g
     where g.ativo
       and g.escopo_status = 'operacional'
       and (p_group_jid is null or g.group_jid = p_group_jid)
       and (p_group_jid is not null or g.processos_varridos_em is null)
     order by g.group_jid
     limit greatest(p_limite, 1);

  select count(*) into v_grupos from _alvo;
  if v_grupos = 0 then
    return query select 0, 0;
    return;
  end if;

  -- Quantos clientes cada grupo tem. Mais de um e nao ha em qual ficha gravar.
  create temporary table _lead_do_grupo on commit drop as
    select a.group_jid,
           count(distinct lg.lead_id) as leads,
           (array_agg(distinct lg.lead_id))[1] as lead_id
      from _alvo a
      left join public.lead_whatsapp_groups lg
             on public.jid_chave(lg.group_jid) = public.jid_chave(a.group_jid)
     group by a.group_jid;

  -- Os CNJ que o cliente do grupo JA tem. Conjunto, nao valor: 114 dos 325
  -- clientes com processo tem mais de um.
  create temporary table _cnjs_do_lead on commit drop as
    select l.group_jid, public.cnj_digitos(p.process_number) as cnj
      from _lead_do_grupo l
      join public.lead_processes p
        on p.lead_id = l.lead_id and p.deleted_at is null
     where length(public.cnj_digitos(p.process_number)) = 20;

  -- O que as mensagens RECEBIDAS dizem.
  create temporary table _achado on commit drop as
    with brutos as (
      select a.group_jid, m.id as msg_id, m.created_at,
             (regexp_matches(m.message_text, c_re, 'g'))[1] as bruto
        from _alvo a
        join public.whatsapp_messages m on m.phone = a.group_jid
       where m.direction = 'inbound'
         and m.message_text ~ c_re
    )
    select group_jid,
           public.cnj_digitos(bruto) as cnj,
           count(*)::integer as ocorrencias,
           min(created_at) as primeira_em,
           max(created_at) as ultima_em,
           (array_agg(msg_id order by created_at))[1] as primeira_msg_id
      from brutos
     where public.cnj_valido(bruto)
     group by 1, 2;

  create temporary table _quantos_cnj on commit drop as
    select group_jid, count(*) as cnjs from _achado group by 1;

  insert into public.grupo_processo_detectado as d
    (group_jid, cnj, status, lead_id, ocorrencias, primeira_msg_id, primeira_em, ultima_em)
  select
    a.group_jid,
    a.cnj,
    case
      when l.leads is null or l.leads = 0 then 'sem_lead'
      when l.leads > 1                    then 'ambiguo_lead'
      when exists (select 1 from _cnjs_do_lead c
                    where c.group_jid = a.group_jid and c.cnj = a.cnj) then 'ignorado'
      when exists (select 1 from _cnjs_do_lead c
                    where c.group_jid = a.group_jid)                   then 'divergente'
      when q.cnjs > 1                     then 'ambiguo_cnj'
      else 'sugerido'
    end,
    case when coalesce(l.leads, 0) = 1 then l.lead_id else null end,
    a.ocorrencias, a.primeira_msg_id, a.primeira_em, a.ultima_em
  from _achado a
  join _quantos_cnj q on q.group_jid = a.group_jid
  left join _lead_do_grupo l on l.group_jid = a.group_jid
  on conflict (group_jid, cnj) do update
     set status = excluded.status,
         lead_id = excluded.lead_id,
         ocorrencias = excluded.ocorrencias,
         primeira_msg_id = coalesce(d.primeira_msg_id, excluded.primeira_msg_id),
         primeira_em = least(d.primeira_em, excluded.primeira_em),
         ultima_em = greatest(d.ultima_em, excluded.ultima_em),
         atualizado_em = now();

  get diagnostics v_cnjs = row_count;

  -- Pendencias: uma por (tipo, grupo). O indice parcial garante que reprocessar
  -- nao abre a mesma duas vezes; `do nothing` deixa a que ja existe em paz,
  -- inclusive se alguem ja escreveu uma resolucao nela.
  insert into public.pendencias_vinculo (tipo, group_jid, lead_id, payload)
  select 'ambiguidade_lead', l.group_jid, null,
         jsonb_build_object('leads', l.leads,
                            'motivo', 'grupo ligado a mais de um cliente')
    from _lead_do_grupo l
   where l.leads > 1
     and exists (select 1 from _achado a where a.group_jid = l.group_jid)
  on conflict do nothing;

  insert into public.pendencias_vinculo (tipo, group_jid, lead_id, payload)
  select 'ambiguidade_processo', d.group_jid, (array_agg(d.lead_id))[1],
         jsonb_build_object(
           'candidatos', jsonb_agg(jsonb_build_object(
             'cnj', d.cnj, 'ocorrencias', d.ocorrencias, 'msg_id', d.primeira_msg_id)),
           'motivo', 'o grupo cita mais de um processo e o cliente nao tem nenhum')
    from public.grupo_processo_detectado d
    join _alvo a on a.group_jid = d.group_jid
   where d.status = 'ambiguo_cnj'
   group by d.group_jid
  on conflict do nothing;

  insert into public.pendencias_vinculo (tipo, group_jid, lead_id, payload)
  select 'divergencia_processo', d.group_jid, (array_agg(d.lead_id))[1],
         jsonb_build_object(
           'novos', jsonb_agg(jsonb_build_object(
             'cnj', d.cnj, 'ocorrencias', d.ocorrencias, 'msg_id', d.primeira_msg_id)),
           'ja_cadastrados', (select jsonb_agg(distinct c.cnj) from _cnjs_do_lead c
                               where c.group_jid = d.group_jid),
           'motivo', 'apareceu processo que nao esta na ficha do cliente')
    from public.grupo_processo_detectado d
    join _alvo a on a.group_jid = d.group_jid
   where d.status = 'divergente'
   group by d.group_jid
  on conflict do nothing;

  update public.dom_grupos_piloto g
     set processos_varridos_em = now()
    from _alvo a
   where g.group_jid = a.group_jid;

  return query select v_grupos, v_cnjs;
end $$;

comment on function public.detectar_processos_em_grupos(integer, text) is
  'Le mensagens RECEBIDAS dos grupos operacionais, valida CNJ por modulo 97 e classifica. NAO escreve em lead_processes.';


-- =============================================================================
-- ROLLBACK
--
-- begin;
-- drop function if exists public.detectar_processos_em_grupos(integer, text);
-- alter table public.dom_grupos_piloto drop column if exists processos_varridos_em;
-- drop table if exists public.grupo_processo_detectado;
-- drop table if exists public.pendencias_vinculo;
-- commit;
--
-- Nada fora destas duas tabelas e desta coluna foi tocado — nenhuma ficha de
-- cliente, nenhum processo, nenhuma mensagem. Reverter apaga a fila e devolve
-- o banco ao estado anterior exato.
-- =============================================================================
