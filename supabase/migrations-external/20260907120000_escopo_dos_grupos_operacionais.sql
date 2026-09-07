-- =============================================================================
-- Escopo dos grupos: o Dom só olha grupo que é da firma.
--
-- POR QUE
-- Em 06/09/2026 o grupo "Familia gold1p.x" — grupo PESSOAL do Dr. Prudêncio,
-- que entra pelo WhatsApp pessoal dele (instância `Raym`, owner 558695590127) —
-- estava com 3 rascunhos pendentes em `dom_respostas_pendentes`, intenção C9,
-- prontos para virar resposta automática. 120 mensagens dele foram lidas e
-- classificadas nos últimos 30 dias.
--
-- A causa não é o webhook. É esta linha, achada em `dom_grupos_piloto`:
--
--     group_jid  = 55219829307221446775117
--     group_name = Familia gold1p.x
--     lead_id    = NULL
--     ativo      = true
--     modo       = rascunho
--     observacao = "entrou em lote pelo padrão CASO/FAMILIA/PREV em 05/09/2026"
--
-- A carga em lote casou a palavra FAMILIA em QUALQUER posição do nome. O grupo
-- da família do sócio se chama literalmente "Familia gold1p.x" e entrou junto.
-- Dos 1.149 grupos ativos no piloto, 1.141 vieram desse lote e 1.141 estão sem
-- `lead_id`. O `dom-rascunho` varre `dom_grupos_piloto where ativo` e nunca
-- perguntou se aquele grupo é da firma.
--
-- A METÁFORA
-- Hoje a portaria deixa entrar quem disser que é do prédio. Esta migration
-- coloca a lista de moradores na portaria — e quem não está na lista não é
-- expulso, fica na recepção esperando alguém identificar (`nao_classificado`).
--
-- COMO O ESCOPO É DECIDIDO
-- Pelo PREFIXO do nome do grupo, contra `escopo_prefixos` (tabela, não regex
-- hardcoded — dá para ligar/desligar prefixo em runtime, sem deploy):
--
--     PREV    <numero>  -> previdenciario
--     CASO    <numero>  -> trabalhista_jc
--     FAMILIA <numero>  -> trabalhista_jc   (acidente de trabalho e consumo)
--
-- O nome é normalizado antes: sem acento, uppercase, e sem os caracteres que
-- não são letra no começo (✅ 🟢 🟧 e espaço). Entre o prefixo e o número vale
-- espaço, hífen, pipe, underscore ou ponto — "✅ PREV.  1098|" casa, e é nome
-- real que está no banco.
--
-- MEDIDO ANTES DE ESCREVER (07/09/2026, 1.149 grupos ativos)
--     887  PREV
--     183  CASO
--      76  FAMILIA
--       3  nao_classificado
--
-- Os 3 da quarentena, um por um:
--     "Familia gold1p.x"                          lead_id NULL  <- o pessoal
--     "✅FAMÍLIA JP 408 -S.Gonçalo do Amarante/CE" lead_id NULL  <- caso real, nome fora do padrão
--     "1104 Milagros - BPC/LOAS"                  lead_id OK    <- caso real, sem prefixo
--
-- Os dois últimos são casos de verdade e por isso NÃO são descartados: ficam
-- visíveis na quarentena, e resolvem com override manual ou renomeando o grupo.
-- Filtrar quem não casa seria trocar um erro por outro erro mais silencioso.
--
-- O QUE ESTA MIGRATION NÃO FAZ
-- Não toca em `whatsapp-webhook`, `whatsapp_messages`, `whatsapp_instances.is_active`,
-- `dom_decisoes`, `dom-contexto` nem em UI. Nenhum DROP, nenhum DELETE.
--
-- ROLLBACK — no fim do arquivo, com a versão atual de `dom_grupos_para_olhar`
-- copiada literalmente para poder ser recolada.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Os prefixos, editáveis em runtime
-- -----------------------------------------------------------------------------
create table if not exists public.escopo_prefixos (
  prefixo       text primary key,
  area          text not null,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint escopo_prefixos_area_ck
    check (area in ('previdenciario', 'trabalhista_jc')),
  -- O prefixo é comparado contra o nome já normalizado (sem acento, uppercase).
  -- Guardar "Família" aqui criaria uma regra que nunca casa com nada.
  constraint escopo_prefixos_normalizado_ck
    check (prefixo = upper(prefixo) and prefixo ~ '^[A-Z]+$')
);

comment on table public.escopo_prefixos is
  'Prefixo do nome do grupo -> área. Lido por dom_classificar_escopo(). Editável sem deploy.';

alter table public.escopo_prefixos enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'escopo_prefixos' and p.polname = 'escopo_prefixos_rw'
  ) then
    create policy escopo_prefixos_rw on public.escopo_prefixos
      for all to authenticated using (true) with check (true);
  end if;
end $$;

insert into public.escopo_prefixos (prefixo, area) values
  ('PREV',    'previdenciario'),
  ('CASO',    'trabalhista_jc'),
  ('FAMILIA', 'trabalhista_jc')
on conflict (prefixo) do nothing;


-- -----------------------------------------------------------------------------
-- 2. A área de cada instância
--
-- Reusa `whatsapp_instances` de propósito: ela já é lida em 7 pontos do webhook
-- e em webhookOrigin.ts. Uma tabela `instancias` paralela criaria duas verdades
-- sobre "instância ativa", e a hora em que as duas discordassem seria a hora em
-- que ninguém saberia qual valia.
--
-- `is_active` NÃO é tocado. As 26 instâncias sem área continuam gravando
-- mensagem exatamente como hoje; `area` só diz por qual linha a resposta sai.
-- -----------------------------------------------------------------------------
alter table public.whatsapp_instances
  add column if not exists area text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_instances_area_ck'
  ) then
    alter table public.whatsapp_instances
      add constraint whatsapp_instances_area_ck
      check (area is null or area in ('previdenciario', 'trabalhista_jc'));
  end if;
end $$;

comment on column public.whatsapp_instances.area is
  'Área de atendimento da instância. NULL = instância pessoal/auxiliar, sem linha de atendimento.';

-- Casadas por owner_phone, não por nome: nome de instância é editável na UI e
-- já divergiu antes ("Atendimento Processual" atende trabalhista_jc).
update public.whatsapp_instances
   set area = 'previdenciario', updated_at = now()
 where owner_phone = '558694000545' and area is distinct from 'previdenciario';

update public.whatsapp_instances
   set area = 'trabalhista_jc', updated_at = now()
 where owner_phone = '558694473226' and area is distinct from 'trabalhista_jc';


-- -----------------------------------------------------------------------------
-- 3. O escopo de cada grupo
-- -----------------------------------------------------------------------------
alter table public.dom_grupos_piloto
  add column if not exists escopo_status     text not null default 'nao_classificado',
  add column if not exists area              text,
  add column if not exists prefixo_detectado text,
  add column if not exists nome_avaliado     text,
  add column if not exists escopo_manual     boolean not null default false,
  add column if not exists escopo_avaliado_em timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'dom_grupos_piloto_escopo_status_ck'
  ) then
    alter table public.dom_grupos_piloto
      add constraint dom_grupos_piloto_escopo_status_ck
      check (escopo_status in ('operacional', 'nao_classificado'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'dom_grupos_piloto_area_ck'
  ) then
    alter table public.dom_grupos_piloto
      add constraint dom_grupos_piloto_area_ck
      check (area is null or area in ('previdenciario', 'trabalhista_jc'));
  end if;
end $$;

comment on column public.dom_grupos_piloto.escopo_status is
  'operacional = grupo da firma, o Dom pode olhar. nao_classificado = quarentena, visível na UI, sem rascunho.';
comment on column public.dom_grupos_piloto.nome_avaliado is
  'Nome do grupo na hora em que o escopo foi decidido. Se o nome mudar, a classificação é refeita.';
comment on column public.dom_grupos_piloto.escopo_manual is
  'true = alguém decidiu na mão. Trava a reavaliação automática, inclusive se o nome mudar.';


-- -----------------------------------------------------------------------------
-- 4. O classificador
--
-- Devolve linha vazia quando não reconhece — quem chama decide o que fazer com
-- isso. Recusar é resposta; adivinhar não seria.
-- -----------------------------------------------------------------------------
create or replace function public.dom_normalizar_nome_grupo(p_nome text)
returns text
language sql
immutable
as $$
  -- Tira acento, sobe para maiúscula e corta o que não é letra no começo
  -- (✅ 🟢 🟧 e espaço). "✅ Familia 362|" vira "FAMILIA 362|".
  select regexp_replace(
    upper(translate(
      coalesce(p_nome, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
    )),
    '^[^A-Z]+', ''
  );
$$;

create or replace function public.dom_classificar_escopo(p_nome text)
returns table (prefixo text, area text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with nome as (select public.dom_normalizar_nome_grupo(p_nome) as n)
  select e.prefixo, e.area
    from public.escopo_prefixos e, nome
   where e.ativo
     -- Prefixo seguido de número. Entre os dois vale espaço, hífen, pipe,
     -- underscore ou ponto: "PREV 1802", "CASO-0474", "PREV.  1098" e
     -- "FAMILIA_12" são a mesma coisa. Exigir o número é o que separa
     -- "FAMILIA 374 | Peterson x Mart Minas" de "Familia gold1p.x".
     and nome.n ~ ('^' || e.prefixo || '[[:space:]\-_|.]*[0-9]')
   -- Prefixo mais longo primeiro: se um dia existir PREVIDENCIARIO além de
   -- PREV, o mais específico ganha em vez de depender da ordem da tabela.
   order by length(e.prefixo) desc
   limit 1;
$$;

comment on function public.dom_classificar_escopo(text) is
  'Nome do grupo -> (prefixo, area) por escopo_prefixos. Zero linhas = não reconhecido.';


-- -----------------------------------------------------------------------------
-- 5. Reavaliação — usada no backfill e depois pela varredura periódica
--
-- Só mexe em grupo com escopo_manual = false. Override humano é decisão, não
-- palpite a ser corrigido pela máquina.
-- -----------------------------------------------------------------------------
create or replace function public.dom_reavaliar_escopo(p_group_jid text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_mexidos integer;
begin
  with alvo as (
    select g.group_jid, g.group_name, c.prefixo, c.area
      from public.dom_grupos_piloto g
      left join lateral public.dom_classificar_escopo(g.group_name) c on true
     where not g.escopo_manual
       and (p_group_jid is null or g.group_jid = p_group_jid)
       -- Nome inalterado e já avaliado não precisa passar de novo.
       and (g.escopo_avaliado_em is null
            or g.nome_avaliado is distinct from g.group_name)
  )
  update public.dom_grupos_piloto g
     set escopo_status      = case when a.area is null then 'nao_classificado' else 'operacional' end,
         area               = a.area,
         prefixo_detectado  = a.prefixo,
         nome_avaliado      = a.group_name,
         escopo_avaliado_em = now()
    from alvo a
   where g.group_jid = a.group_jid;

  get diagnostics v_mexidos = row_count;
  return v_mexidos;
end $$;

comment on function public.dom_reavaliar_escopo(text) is
  'Reclassifica grupos cujo nome mudou (ou nunca foram avaliados). Ignora escopo_manual = true.';

-- Backfill dos 1.149.
select public.dom_reavaliar_escopo();


-- -----------------------------------------------------------------------------
-- 6. O portão
--
-- `dom-rascunho` só enxerga grupo por dois caminhos: esta RPC (index.ts:415) e
-- a busca direta por group_jid (index.ts:410, fechada no TS). Exigir
-- 'operacional' aqui é o que tira o grupo pessoal da fila.
-- -----------------------------------------------------------------------------
create or replace function public.dom_grupos_para_olhar(
  p_limite integer default 20,
  p_janela interval default '48:00:00'::interval
)
returns table (
  group_jid text,
  group_name text,
  lead_id uuid,
  modo text,
  ultima_do_cliente timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with do_cliente as (
    select m.phone, max(m.created_at) as quando
      from public.whatsapp_messages m
     where m.created_at > now() - p_janela
       and coalesce((m.metadata -> 'message' ->> 'fromMe')::boolean, false) = false
       and not exists (
         select 1
           from public.dom_numeros_equipe e
          where e.ativo
            and e.phone = regexp_replace(
              coalesce(m.metadata -> 'message' ->> 'sender_pn',
                       m.metadata -> 'message' ->> 'sender', ''),
              '\D', '', 'g')
       )
     group by m.phone
  )
  select g.group_jid, g.group_name, g.lead_id, g.modo, c.quando
    from public.dom_grupos_piloto g
    join do_cliente c on c.phone = g.group_jid
   where g.ativo
     -- NOVO (07/09/2026): grupo fora do escopo não é olhado. Ver cabeçalho.
     and g.escopo_status = 'operacional'
     and c.quando > coalesce(
           (select max(d.criado_em) from public.dom_decisoes d
             where d.group_jid = g.group_jid),
           '-infinity'::timestamptz)
   order by c.quando desc
   limit greatest(p_limite, 1);
$function$;


-- -----------------------------------------------------------------------------
-- 7. Os rascunhos que o grupo pessoal já gerou
--
-- Descartadas, não apagadas: o rastro de que existiram é a prova de que o
-- buraco era real, e some junto com a linha se eu deletar.
--
-- O valor é 'descartada' (feminino, concorda com "resposta"), conforme
-- dom_respostas_pendentes_status_check. Não confundir com 'descartado' de
-- group_case_reports, que é outra tabela e outro enum.
-- -----------------------------------------------------------------------------
update public.dom_respostas_pendentes p
   set status = 'descartada',
       motivo_revisao = coalesce(p.motivo_revisao || ' | ', '')
                        || 'descartada em 07/09/2026: grupo fora do escopo operacional'
 where p.status = 'pendente'
   and exists (
     select 1 from public.dom_grupos_piloto g
      where g.group_jid = p.group_jid
        and g.escopo_status = 'nao_classificado'
   );


-- =============================================================================
-- ROLLBACK
--
-- begin;
--
-- -- 6. volta a RPC para a versão de 06/09/2026 (sem o filtro de escopo)
-- create or replace function public.dom_grupos_para_olhar(
--   p_limite integer default 20, p_janela interval default '48:00:00'::interval)
-- returns table (group_jid text, group_name text, lead_id uuid, modo text,
--                ultima_do_cliente timestamptz)
-- language sql stable security definer set search_path to 'public'
-- as $f$
--   with do_cliente as (
--     select m.phone, max(m.created_at) as quando
--       from public.whatsapp_messages m
--      where m.created_at > now() - p_janela
--        and coalesce((m.metadata -> 'message' ->> 'fromMe')::boolean, false) = false
--        and not exists (
--          select 1 from public.dom_numeros_equipe e
--           where e.ativo and e.phone = regexp_replace(
--             coalesce(m.metadata -> 'message' ->> 'sender_pn',
--                      m.metadata -> 'message' ->> 'sender', ''), '\D', '', 'g'))
--      group by m.phone)
--   select g.group_jid, g.group_name, g.lead_id, g.modo, c.quando
--     from public.dom_grupos_piloto g
--     join do_cliente c on c.phone = g.group_jid
--    where g.ativo
--      and c.quando > coalesce((select max(d.criado_em) from public.dom_decisoes d
--                                where d.group_jid = g.group_jid), '-infinity'::timestamptz)
--    order by c.quando desc limit greatest(p_limite, 1);
-- $f$;
--
-- -- 5/4. classificador
-- drop function if exists public.dom_reavaliar_escopo(text);
-- drop function if exists public.dom_classificar_escopo(text);
-- drop function if exists public.dom_normalizar_nome_grupo(text);
--
-- -- 3. colunas do grupo
-- alter table public.dom_grupos_piloto
--   drop constraint if exists dom_grupos_piloto_escopo_status_ck,
--   drop constraint if exists dom_grupos_piloto_area_ck,
--   drop column if exists escopo_status, drop column if exists area,
--   drop column if exists prefixo_detectado, drop column if exists nome_avaliado,
--   drop column if exists escopo_manual, drop column if exists escopo_avaliado_em;
--
-- -- 2. área da instância
-- alter table public.whatsapp_instances
--   drop constraint if exists whatsapp_instances_area_ck,
--   drop column if exists area;
--
-- -- 1. prefixos
-- drop table if exists public.escopo_prefixos;
--
-- -- 7. os rascunhos descartados NÃO voltam a 'pendente' automaticamente.
-- --    Se for para reabrir, é decisão de gente:
-- --    update dom_respostas_pendentes set status = 'pendente'
-- --     where motivo_revisao like '%grupo fora do escopo operacional%';
--
-- commit;
-- =============================================================================
