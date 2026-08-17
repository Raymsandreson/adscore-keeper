-- =============================================================================
-- SELIC da Justiça do Trabalho vinda da API do BACEN, sozinha, todo mês.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Pedido do usuário (15/08/2026): em vez de a tabela de índices ser carregada à
-- mão, buscar a SELIC direto no Banco Central. Motivo prático: a safra estava
-- parada em jul/2026 com o mês já em agosto, e tabela parada congela o valor
-- corrigido da carteira sem avisar ninguém.
--
-- FONTE: Bacen SGS série 4390 — "Taxa de juros - Selic acumulada no mês" (% a.m.)
--   https://api.bcb.gov.br/dados/serie/bcdata.sgs.4390/dados?formato=json&...
-- Endpoint público, sem chave, sem dado nosso trafegando. A chamada sai do
-- Postgres via pg_net (a rede do app não precisa alcançar o Bacen).
--
-- A REGRA DO COEFICIENTE, e a prova de que é a certa:
--   coeficiente(competência) = 1 + Σ SELIC(m)/100, para m de `competência` até o
--   mês ANTERIOR à `referencia`. A SELIC do mês de referência NÃO incide — é a
--   regra da tabela única do TST/CSJT, e por isso a competência igual à
--   referência vale exatamente 1,0.
--   PROVA (15/08/2026): reconstruindo a série do Bacen desde 1995 com esta
--   fórmula e comparando com as 379 linhas que já estavam gravadas —
--   **379 idênticas, 0 divergentes, diferença máxima 0,0000**. Ou seja: não é
--   uma aproximação nova, é exatamente a conta que já produzia a tabela atual.
--
-- SAFRA, NÃO SOBRESCRITA: `jm_indices` tem chave única
-- (indice, competencia, referencia). Cada rodada grava uma safra nova com
-- `referencia` = mês corrente e preserva as anteriores — dá para responder
-- "quanto a carteira valia corrigida até jul/2026" depois de agosto chegar. Quem
-- lê a carteira pega a safra mais recente (ver 20260815220000).
--
-- ASSÍNCRONO EM DOIS PASSOS, porque pg_net é assíncrono:
--   `jm_selic_sync_disparar()` faz o http_get e registra o request_id;
--   `jm_selic_sync_aplicar()` lê a resposta, valida e grava.
-- O controle fica em `jm_indices_sync`, para a falha ser VISÍVEL. Armadilha já
-- conhecida nesta base (skill marcos-pop-e-captura): `net._http_response` some
-- em ~6h — resposta perdida some sem deixar rastro. Por isso o pendente que
-- passa de 6h é marcado 'perdida' em vez de ficar pendurado para sempre.
--
-- SALVAGUARDAS (uma tabela de índice corrompida erra o valor de TODA a carteira):
--   - status_code <> 200            → marca 'erro', NÃO toca em jm_indices;
--   - JSON ilegível                 → marca 'erro', não toca;
--   - menos de 300 competências     → marca 'suspeita', não toca (resposta
--     truncada; a série real tem 379+ meses desde 1995);
--   - qualquer valor não numérico   → a conversão falha e cai no 'erro'.
--   Em todos os casos a safra anterior continua valendo e a carteira segue
--   funcionando com o número de ontem.
--
-- O QUE ESTA MIGRATION NÃO FAZ: TCM_ESTADUAL continua manual. O Bacen não
-- publica a tabela de correção monetária estadual; ela vem do TJ. Enquanto não
-- houver fonte automática, a safra dela envelhece — e é por isso que a tela
-- mostra a data de referência ao lado de todo valor corrigido.
--
-- REVERSÃO:
--   select cron.unschedule('jm_selic_sync_disparar');
--   select cron.unschedule('jm_selic_sync_aplicar');
--   drop function if exists public.jm_selic_sync_aplicar();
--   drop function if exists public.jm_selic_sync_disparar();
--   drop function if exists public.jm_selic_coeficientes(bigint, date);
--   drop table if exists public.jm_indices_sync;
--   -- e, para voltar a carteira à safra antiga:
--   -- delete from public.jm_indices where indice='SELIC_SIMPLES_JT' and referencia > '2026-07-01';
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Controle: toda rodada deixa rastro, com sucesso ou não.
-- ---------------------------------------------------------------------------
create table if not exists public.jm_indices_sync (
  id           bigserial primary key,
  indice       text        not null default 'SELIC_SIMPLES_JT',
  request_id   bigint      not null,
  url          text        not null,
  disparado_em timestamptz not null default now(),
  aplicado_em  timestamptz,
  -- pendente | aplicada | erro | suspeita | perdida
  status       text        not null default 'pendente',
  mensagem     text,
  referencia   date,
  linhas       integer
);

create index if not exists idx_jm_indices_sync_pendente
  on public.jm_indices_sync (status, disparado_em);

-- Dado operacional: nem o app nem o anon precisam ler. RLS ligada sem policy
-- deixa a tabela acessível só a quem roda como service_role/cron, igual jm_config.
alter table public.jm_indices_sync enable row level security;

comment on table public.jm_indices_sync is
  'Rastro de cada busca da SELIC no Bacen (SGS 4390) para jm_indices. status: pendente|aplicada|erro|suspeita|perdida.';

-- ---------------------------------------------------------------------------
-- Cálculo puro: de uma resposta do Bacen para (competencia, coeficiente).
-- Separado de propósito — dá para conferir o número sem gravar nada.
-- ---------------------------------------------------------------------------
create or replace function public.jm_selic_coeficientes(
  p_request_id bigint,
  p_referencia date
)
returns table (competencia date, coeficiente numeric)
language sql
stable
security definer
set search_path = public
as $$
  with resp as (
    select r.content::jsonb as j
    from net._http_response r
    where r.id = p_request_id and r.status_code = 200
  ),
  selic as (
    select to_date(e->>'data', 'DD/MM/YYYY') as competencia,
           (e->>'valor')::numeric            as pct
    from resp, jsonb_array_elements(resp.j) e
  )
  select s.competencia,
         -- Soma SIMPLES (não capitaliza) da competência até o mês anterior à
         -- referência: a SELIC do mês de referência não incide.
         round(1 + coalesce((
           select sum(x.pct) from selic x
           where x.competencia >= s.competencia
             and x.competencia <  p_referencia
         ), 0) / 100, 4) as coeficiente
  from selic s
  where s.competencia <= p_referencia;
$$;

comment on function public.jm_selic_coeficientes(bigint, date) is
  'Converte uma resposta do Bacen SGS 4390 em coeficientes SELIC simples (regra da tabela unica do TST: soma simples da competencia ate o mes anterior a referencia).';

-- ---------------------------------------------------------------------------
-- Passo 1: pedir a série ao Bacen.
-- ---------------------------------------------------------------------------
create or replace function public.jm_selic_sync_disparar()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_req bigint;
begin
  -- Série inteira desde 1995: reconstruir tudo é barato (≈380 meses) e evita
  -- buraco se alguma rodada falhar.
  v_url := 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4390/dados?formato=json'
        || '&dataInicial=01/01/1995'
        || '&dataFinal=' || to_char(current_date, 'DD/MM/YYYY');

  select net.http_get(v_url) into v_req;

  insert into public.jm_indices_sync (indice, request_id, url)
  values ('SELIC_SIMPLES_JT', v_req, v_url);

  return v_req;
end;
$$;

comment on function public.jm_selic_sync_disparar() is
  'Passo 1 do sync: pede a serie 4390 (Selic acumulada no mes) ao Bacen via pg_net e registra o request em jm_indices_sync.';

-- ---------------------------------------------------------------------------
-- Passo 2: ler a resposta, validar e gravar a safra.
-- ---------------------------------------------------------------------------
create or replace function public.jm_selic_sync_aplicar()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pend       record;
  v_resp       record;
  v_referencia date := date_trunc('month', current_date)::date;
  v_qtd        integer;
  v_gravadas   integer;
  v_aplicadas  integer := 0;
begin
  for v_pend in
    select * from public.jm_indices_sync
    where status = 'pendente'
    order by id
  loop
    select id, status_code, content into v_resp
    from net._http_response where id = v_pend.request_id;

    if not found then
      -- net._http_response some em ~6h. Antes disso ainda pode estar a caminho;
      -- depois, a resposta foi perdida e insistir é esperar para sempre.
      if v_pend.disparado_em < now() - interval '6 hours' then
        update public.jm_indices_sync
        set status = 'perdida', aplicado_em = now(),
            mensagem = 'net._http_response expirou antes de ser lida'
        where id = v_pend.id;
      end if;
      continue;
    end if;

    if v_resp.status_code is distinct from 200 then
      update public.jm_indices_sync
      set status = 'erro', aplicado_em = now(),
          mensagem = 'Bacen respondeu HTTP ' || coalesce(v_resp.status_code::text, 'sem status')
      where id = v_pend.id;
      continue;
    end if;

    -- Resposta curta demais = truncada ou fora do formato. Não encosta na
    -- tabela: safra velha errada é melhor que safra nova quebrada.
    begin
      select count(*) into v_qtd
      from public.jm_selic_coeficientes(v_pend.request_id, v_referencia);
    exception when others then
      update public.jm_indices_sync
      set status = 'erro', aplicado_em = now(),
          mensagem = 'resposta ilegivel: ' || left(SQLERRM, 300)
      where id = v_pend.id;
      continue;
    end;

    if coalesce(v_qtd, 0) < 300 then
      update public.jm_indices_sync
      set status = 'suspeita', aplicado_em = now(),
          mensagem = 'so ' || coalesce(v_qtd, 0) || ' competencias (esperado 300+); tabela nao alterada'
      where id = v_pend.id;
      continue;
    end if;

    insert into public.jm_indices (indice, ano, mes, competencia, coeficiente, referencia)
    select 'SELIC_SIMPLES_JT',
           extract(year  from c.competencia)::integer,
           extract(month from c.competencia)::integer,
           c.competencia,
           c.coeficiente,
           v_referencia
    from public.jm_selic_coeficientes(v_pend.request_id, v_referencia) c
    on conflict (indice, competencia, referencia)
      do update set coeficiente = excluded.coeficiente;

    get diagnostics v_gravadas = row_count;

    update public.jm_indices_sync
    set status = 'aplicada', aplicado_em = now(),
        referencia = v_referencia, linhas = v_gravadas,
        mensagem = 'safra ' || to_char(v_referencia, 'MM/YYYY') || ' gravada'
    where id = v_pend.id;

    v_aplicadas := v_aplicadas + 1;
  end loop;

  return v_aplicadas;
end;
$$;

comment on function public.jm_selic_sync_aplicar() is
  'Passo 2 do sync: le a resposta do Bacen, valida (200, JSON legivel, 300+ competencias) e grava a safra do mes em jm_indices. Nao altera nada quando a resposta e suspeita.';

-- ---------------------------------------------------------------------------
-- Agenda. Diário porque o custo é irrelevante e a série só muda uma vez por
-- mês: assim a safra do mês novo entra no dia 1 sem depender de ninguém.
-- Horários em UTC (09:05 UTC = 06:05 em Brasília).
-- ---------------------------------------------------------------------------
select cron.unschedule('jm_selic_sync_disparar')
where exists (select 1 from cron.job where jobname = 'jm_selic_sync_disparar');

select cron.unschedule('jm_selic_sync_aplicar')
where exists (select 1 from cron.job where jobname = 'jm_selic_sync_aplicar');

select cron.schedule('jm_selic_sync_disparar', '5 9 * * *',
                     $cron$select public.jm_selic_sync_disparar();$cron$);

-- A cada 30 min: é no-op sem pendente, e sobra janela antes das 6h de validade
-- da resposta mesmo se uma rodada falhar.
select cron.schedule('jm_selic_sync_aplicar', '*/30 * * * *',
                     $cron$select public.jm_selic_sync_aplicar();$cron$);
