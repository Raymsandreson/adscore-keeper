-- =============================================================================
-- E-mail de push lido por parser VELHO volta para a fila.
-- Banco alvo: Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- O BURACO (medido em 30/08/2026, a partir do processo 1017247-47.2025.4.01.3100):
--   A ficha do processo mostrava "Nenhuma movimentação capturada neste processo
--   ainda" com TRÊS pushes do TRF1 na base (17/06, 30/06 e 09/07/2026), todos
--   com has_movimentacao = true e process_number preenchido:
--
--     select count(*) from processual_emails
--      where process_number = '1017247-47.2025.4.01.3100';   -- 3
--     select count(*) from process_updates
--      where process_id = 'f3a67175-9b1b-4fe5-bd35-8d66a1b3755a';  -- 0
--
--   Os três foram lidos em 11 e 12/08/2026 pelo parser da época (movimentacoes=1,
--   casados=1 em email_push_processados), que só sabia copiar o assunto. Os cards
--   genéricos que ele gerou foram apagados na limpeza de ruído do dia 12
--   (zz_process_updates_ruido_bkp_20260812 guarda os 3). O e-mail, porém,
--   continuou marcado como processado — e vw_email_push_pendentes é um anti-join
--   contra essa marca. Resultado: e-mail na base, parser novo capaz de lê-lo
--   (conferido: o v13 extrai "Publicado Intimação polo ativo em 09/07/2026" da
--   tabela Data/Movimento do TRF1), e nenhuma rodada do cron que o alcance.
--
--   Não é um processo: são 155 de 615 processos com push na base sem um único
--   card, 462 dos e-mails deles marcados como processados em 11-12/08.
--
-- A CORREÇÃO ESTRUTURAL:
--   "Processado" deixa de ser sim/não e passa a ser POR QUAL PARSER. A versão
--   fica no banco (jm_email_parser_versao), a marca guarda a versão que leu, e
--   a fila = nunca lido OU lido por versão anterior. Toda melhoria de parser
--   passa a re-alcançar a caixa inteira uma vez, em vez de valer só para o que
--   chegar depois dela.
--
--   Reprocessar é seguro: a gravação do feed é upsert por
--   (process_id, conteudo_hash) com ignoreDuplicates — e-mail relido não
--   duplica card. E não custa: a reabertura paga do Escavador
--   (jm_esc_reabrir_por_cnj, R$ 0,20/processo) só alcança e-mail recebido
--   dentro de reabrir_desde_dias (3), então o passivo antigo não gasta nada.
--
-- RITUAL (o que a próxima sessão precisa saber):
--   mexeu em _shared/emailPushParser.ts de um jeito que muda o que ele extrai?
--   sobe jm_email_parser_versao() em +1 numa migration. É isso que faz a caixa
--   inteira ser relida com o parser novo.
--
-- ORDEM DE APLICAÇÃO (importa):
--   1º deploy da sync-email-push com o carimbo da versão, 2º esta migration.
--   Invertido, a edge velha volta a marcar o e-mail SEM parser_versao: as linhas
--   do backfill continuam em 0, a fila não drena e o cron relê o mesmo lote a
--   cada hora até o deploy chegar. Não corrompe nada (a gravação do feed é
--   idempotente por (process_id, conteudo_hash)), mas é trabalho jogado fora.
--
-- ROLLBACK:
--   create or replace view public.vw_email_push_pendentes as
--     select e.gmail_message_id, e.subject, e.from_addr, e.body_text, e.received_at
--       from public.processual_emails e
--       left join public.email_push_processados p on p.message_id = e.gmail_message_id
--      where e.deleted_at is null and p.message_id is null
--      order by e.received_at desc;
--   -- (e a versão anterior de vw_jm_captura_status, no arquivo
--   --  20260812020000_email_push_do_banco_e_cron_marcos.sql)
--   alter table public.email_push_processados drop column if exists parser_versao;
--   drop function if exists public.jm_email_parser_versao();
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Qual parser leu cada e-mail
-- ---------------------------------------------------------------------------
-- default 0 = "lido por algum parser anterior ao versionamento". Como a versão
-- corrente nasce em 1, toda a caixa já processada (5.918 e-mails em 30/08/2026)
-- volta para a fila uma vez — que é exatamente o backfill dos 155 processos.
alter table public.email_push_processados
  add column if not exists parser_versao integer not null default 0;

comment on column public.email_push_processados.parser_versao is
  'Versão de _shared/emailPushParser.ts que leu este e-mail (jm_email_parser_versao). Menor que a corrente = volta para vw_email_push_pendentes.';

create index if not exists email_push_processados_versao_idx
  on public.email_push_processados (parser_versao);

-- ---------------------------------------------------------------------------
-- 2) A versão corrente — fonte única, lida pela edge e pelas views
-- ---------------------------------------------------------------------------
-- v1 = sync-email-push v13 (30/08/2026): identificador tipado, índice paginado,
-- PJe Push TRF1/TRF3, EPROC em linha corrida, PROJUDI, e-SAJ com incidente.
create or replace function public.jm_email_parser_versao()
returns integer
language sql
immutable
set search_path = public
as $function$
  select 1;
$function$;

comment on function public.jm_email_parser_versao() is
  'Versão corrente do parser de push por e-mail. Subir em +1 sempre que emailPushParser.ts passar a extrair algo que antes não extraía — é o que devolve a caixa inteira para a fila.';

-- Linha NOVA nasce com a versão corrente mesmo que quem gravou não mande a
-- coluna (edge antiga ainda no ar): sem isto, e-mail que chega antes do deploy
-- entraria já vencido e ficaria rodando na fila à toa. As linhas antigas ficam
-- com o 0 que o `default 0` do passo 1 carimbou — é esse 0 que faz o backfill.
alter table public.email_push_processados
  alter column parser_versao set default public.jm_email_parser_versao();

-- ---------------------------------------------------------------------------
-- 3) A fila passa a incluir o que foi lido por parser velho
-- ---------------------------------------------------------------------------
create or replace view public.vw_email_push_pendentes as
select
  e.gmail_message_id,
  e.subject,
  e.from_addr,
  e.body_text,
  e.received_at,
  -- Null = nunca lido. Sai na view para a edge poder dizer, no retorno, quanto
  -- da rodada foi novidade e quanto foi releitura.
  p.parser_versao
from public.processual_emails e
left join public.email_push_processados p on p.message_id = e.gmail_message_id
where e.deleted_at is null
  and (p.message_id is null or p.parser_versao < public.jm_email_parser_versao())
order by e.received_at desc;

comment on view public.vw_email_push_pendentes is
  'E-mails de push que o parser CORRENTE ainda não leu (nunca lidos ou lidos por versão anterior), do mais recente ao mais antigo.';

-- ---------------------------------------------------------------------------
-- 4) O painel do sino conta a mesma coisa que a fila
-- ---------------------------------------------------------------------------
-- Sem isto o painel diria "0 na fila" enquanto a edge relê 5.918 e-mails — a
-- mesma mentira que o rótulo "última entrega" contava em 11/08 (migration
-- 20260812020000). Só o CTE `em` muda; esc e dj são cópia fiel.
create or replace view public.vw_jm_captura_status as
with esc as (
  select
    count(*) as total,
    count(*) filter (where status = 'SUCESSO') as concluidos,
    count(*) filter (where status = 'A_ENVIAR') as na_fila,
    count(*) filter (where status = any (array['ENVIANDO', 'PENDENTE'])) as em_andamento,
    count(*) filter (where status = any (array['ERRO', 'BLOQUEADO_SALDO'])) as com_erro,
    min(criado_em) as iniciou_em,
    max(concluido_em) as ultimo_concluido,
    coalesce(sum(creditos), 0::bigint) as creditos
  from public.jm_esc_solicitacoes
), dj as (
  select
    (select count(*) from public.jm_processos
      where processo_cnj ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$') as total,
    (select count(distinct processo_cnj) from public.jm_movimentos
      where captured_at > (now() - '7 days'::interval)) as concluidos,
    (select count(*) from public.jm_datajud_req where processed = false) as em_andamento,
    (select max(captured_at) from public.jm_movimentos) as ultimo_concluido
), em as (
  select
    count(*) as total,
    count(*) filter (
      where p.message_id is not null
        and p.parser_versao >= public.jm_email_parser_versao()
    ) as concluidos,
    count(*) filter (
      where p.message_id is null
        or p.parser_versao < public.jm_email_parser_versao()
    ) as na_fila,
    max(e.received_at) as ultimo_recebido,
    max(p.processado_em) as ultimo_processado
  from public.processual_emails e
  left join public.email_push_processados p on p.message_id = e.gmail_message_id
  where e.deleted_at is null
)
select
  'escavador'::text as fonte,
  'Documentos e estado do processo'::text as descricao,
  esc.total,
  esc.concluidos,
  esc.na_fila,
  esc.em_andamento,
  esc.com_erro,
  case when esc.total > 0
    then round(100.0 * esc.concluidos::numeric / esc.total::numeric)::integer
    else 0 end as pct,
  esc.iniciou_em,
  esc.ultimo_concluido,
  (esc.creditos::numeric / 100.0)::numeric(10,2) as gasto_reais,
  (esc.na_fila::numeric * 0.20)::numeric(10,2) as falta_gastar_reais
from esc
union all
select
  'datajud'::text,
  'Movimentações e código do movimento'::text,
  dj.total,
  dj.concluidos,
  greatest(dj.total - dj.concluidos, 0::bigint) as na_fila,
  dj.em_andamento,
  0,
  case when dj.total > 0
    then round(100.0 * dj.concluidos::numeric / dj.total::numeric)::integer
    else 0 end,
  null::timestamptz,
  dj.ultimo_concluido,
  0::numeric(10,2),
  0::numeric(10,2)
from dj
union all
select
  'email'::text,
  'inbox#4 tribunais · inbox#3 INSS e MPT'::text,
  em.total,
  em.concluidos,
  em.na_fila,
  0,
  0,
  case when em.total > 0
    then round(100.0 * em.concluidos::numeric / em.total::numeric)::integer
    else 0 end,
  em.ultimo_recebido,
  em.ultimo_processado,
  0::numeric(10,2),
  0::numeric(10,2)
from em;

comment on view public.vw_jm_captura_status is
  'Estado das tres filas de captura (Escavador, DataJud, e-mail) para o painel do sino. No e-mail, concluido = lido pelo parser CORRENTE.';
