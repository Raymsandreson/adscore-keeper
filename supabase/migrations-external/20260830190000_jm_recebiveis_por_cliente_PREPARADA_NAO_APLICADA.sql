-- =============================================================================
-- jm_recebiveis — recebíveis por (processo × cliente), régua v4.  ⚠ PREPARADA,
-- NÃO APLICADA. Modo Leopardo: aplicar só com aval explícito do Raym, logo
-- após um tick do cron jm-esc-rotina (roda a cada 20min — não há "horário"; a
-- janela é entre execuções, ou pausar o job por 5min), e com a conciliação
-- do piloto registrada (abaixo).
--
-- ── Piloto de 5 processos (30/08/2026) — a conciliação que autoriza a regra
--
-- Processos: 0000453-61.2023.5.20.0016 (13 clientes), 0000330-97.2021.5.08.0103,
-- 0000249-26.2020.5.14.0004, 0000411-13.2022.5.21.0018, 0100440-70.2022.5.01.0263
-- (todos com litisconsórcio + parcelas + cliente menor + execução).
-- Fechamento célula a célula contra a Tab. Aux (planilha Jurimetria/indenização,
-- colunas K..P), 26/26 pares:
--   K (TOTAL CONDENAÇÃO CJCM) = L (TOTAL PARTE) + N (HON. CONTRATUAL À VISTA)
--                             + O (HON. CONTRATUAL PARCELADO) + P (SUCUMBENCIAL)
--   → fecha em 26/26.
--   P = hs_pct × (L+N+O)  → hs_pct da planilha bate com jm_valores.hs_pct em 26/26.
--   (N+O) = 30% × (L+N+O) → contratual implícito é 30% em 26/26 (média do
--   fee_percentage do banco: 29,98% — é o padrão do contrato do escritório).
--
-- REGRA DE DERIVAÇÃO (validada no piloto; vale sobre base nominal ou corrigida,
-- porque é percentual):
--   bruto                = cota_cliente + honorario_contratual  (sem sucumbencial)
--   honorario_contratual = fee × bruto        (fee = lead_processes.fee_percentage/100, senão 0.30)
--   cota_cliente_liquida = (1 − fee) × bruto
--   honorario_sucumbencial = hs_pct × bruto   (hs_pct = jm_valores.hs_pct da decisão vigente)
--   condenacao_total     = bruto + sucumbencial
-- No banco, jm_valores (dano_moral + dano_estetico + base_calculo×meses) guarda
-- a CONDENAÇÃO da parte (≈ bruto, nominal). Logo, na derivação a partir do banco:
--   bruto_nominal = dm + de + base×meses
--   contratual    = fee × bruto_nominal
--   cota_liquida  = bruto_nominal − contratual
--   sucumbencial  = hs_pct × bruto_nominal
--
-- ── O que esta migração NÃO faz
--   - Não altera nenhuma tabela existente (100% aditiva).
--   - Não agenda cron (o backfill/derivação é chamado à mão, e a recorrência é
--     decisão posterior).
--   - Não grava valor CJCM (corrigido): componentes ficam NOMINAIS + os
--     percentuais; a correção monetária continua no motor da conferência.
--
-- ── Rollback (<5min)
--   drop function if exists public.jm_recebiveis_derivar(text);
--   drop table if exists public.jm_recebiveis;
-- =============================================================================

create table public.jm_recebiveis (
  id bigint generated always as identity primary key,
  processo_cnj text not null,
  cliente text not null,

  -- componentes NOMINAIS derivados da decisão vigente (regra do piloto)
  bruto_nominal numeric,
  cota_cliente_liquida numeric,
  honorario_contratual numeric,
  honorario_contratual_pct numeric,             -- fração usada (0.30 default do piloto)
  honorario_sucumbencial_rateado numeric,
  honorario_sucumbencial_pct numeric,           -- jm_valores.hs_pct da decisão vigente
  honorario_sucumbencial_global_auditoria numeric,  -- valor global fixado pelo juiz (quando o rateio
                                                    -- for proporcional, a soma das frações tem de
                                                    -- bater com este número — auditoria da régua v4)

  -- cessão do honorário: duas perguntas DISTINTAS (régua v4)
  honorario_cessivel boolean,                   -- derivado das travas: menor (art. 1.691 CC),
                                                -- RPV/precatório (IRDR 34 TRF4), depositado em juízo
  honorario_cedido boolean not null default false,  -- flag MANUAL do Raym; só cedido soma no FIDC

  -- estágio de fluxo (régua de 7) — "cadê o dinheiro" deste cliente
  estagio text check (estagio in
    ('PROJETADO','CONDENACAO','A_RECEBER','VENCIDO','EM_EXECUCAO','DEPOSITADO_EM_JUIZO','PAGO')),
  cliente_menor boolean not null default false, -- jm_partes.nascimento < 18 anos
  data_liberacao date,                          -- aniversário de 18 anos, ou data do "ao final"

  -- proveniência e auditoria
  dec_id text,                                  -- decisão vigente que originou os números
  fonte text not null default 'derivado',       -- derivado | planilha | manual
  derivado_em timestamptz,
  atualizado_em timestamptz not null default now(),

  unique (processo_cnj, cliente)
);

comment on table public.jm_recebiveis is
  'Recebíveis por (processo × cliente) — régua v4. Cota do cliente e honorário '
  'são recebíveis SEPARADOS, nunca somados. Derivação validada no piloto de 5 '
  'processos (30/08/2026, 26/26 células contra a Tab. Aux).';

-- RLS: leitura para o app; escrita só pela derivação (service role).
alter table public.jm_recebiveis enable row level security;
create policy jm_recebiveis_sel on public.jm_recebiveis
  for select to authenticated using (true);
-- (sem policy de INSERT/UPDATE/DELETE para anon/authenticated de propósito:
--  quem escreve é a função abaixo, SECURITY DEFINER, ou o service role.)

-- ── Derivação: materializa a regra do piloto a partir do que o banco já tem.
-- p_cnj = null deriva a base inteira; com CNJ, só aquele processo.
-- Idempotente (upsert por processo_cnj × cliente); linhas com fonte 'manual'
-- ou 'planilha' NÃO são sobrescritas.
create or replace function public.jm_recebiveis_derivar(p_cnj text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_linhas integer;
begin
  with vigente as (
    select distinct on (v.processo_cnj, v.cliente)
      v.processo_cnj, v.cliente, v.dec_id, v.hs_pct,
      coalesce(v.dano_moral,0) + coalesce(v.dano_estetico,0)
        + coalesce(v.base_calculo,0) * coalesce(v.meses_pensionamento,0) as bruto
    from public.jm_valores v
    left join public.jm_decisoes d on d.dec_id = v.dec_id
    where v.cliente is not null
      and (p_cnj is null or v.processo_cnj = p_cnj)
    order by v.processo_cnj, v.cliente, d.data_decisao desc nulls last
  ),
  fee as (
    select lp.process_number, max(lp.fee_percentage) as fee_pct
    from public.lead_processes lp
    where lp.deleted_at is null
    group by lp.process_number
  ),
  menor as (
    select pa.processo_cnj, upper(pa.nome) as nome_up,
           bool_or(pa.nascimento > (current_date - interval '18 years')) as eh_menor,
           max(pa.nascimento) filter (where pa.nascimento > (current_date - interval '18 years'))
             + interval '18 years' as libera_em
    from public.jm_partes pa
    group by pa.processo_cnj, upper(pa.nome)
  ),
  calc as (
    select vg.processo_cnj, vg.cliente, vg.dec_id,
           vg.bruto,
           coalesce(f.fee_pct/100.0, 0.30) as fee_frac,
           vg.hs_pct,
           coalesce(m.eh_menor, false) as eh_menor,
           m.libera_em::date as libera_em
    from vigente vg
    left join fee f on f.process_number = vg.processo_cnj
    left join menor m on m.processo_cnj = vg.processo_cnj
                     and m.nome_up = upper(vg.cliente)
  )
  insert into public.jm_recebiveis as jr
    (processo_cnj, cliente, bruto_nominal, cota_cliente_liquida,
     honorario_contratual, honorario_contratual_pct,
     honorario_sucumbencial_rateado, honorario_sucumbencial_pct,
     honorario_cessivel, cliente_menor, data_liberacao,
     dec_id, fonte, derivado_em, atualizado_em)
  select processo_cnj, cliente, bruto,
         round((bruto * (1 - fee_frac))::numeric, 2),
         round((bruto * fee_frac)::numeric, 2), fee_frac,
         round((bruto * coalesce(hs_pct,0))::numeric, 2), hs_pct,
         -- cessível = não é de menor. (RPV/precatório e depositado-em-juízo
         -- entram quando essas travas tiverem fonte no banco — hoje não têm.)
         not eh_menor,
         eh_menor, libera_em,
         dec_id, 'derivado', now(), now()
  from calc
  on conflict (processo_cnj, cliente) do update
    set bruto_nominal = excluded.bruto_nominal,
        cota_cliente_liquida = excluded.cota_cliente_liquida,
        honorario_contratual = excluded.honorario_contratual,
        honorario_contratual_pct = excluded.honorario_contratual_pct,
        honorario_sucumbencial_rateado = excluded.honorario_sucumbencial_rateado,
        honorario_sucumbencial_pct = excluded.honorario_sucumbencial_pct,
        honorario_cessivel = excluded.honorario_cessivel,
        cliente_menor = excluded.cliente_menor,
        data_liberacao = excluded.data_liberacao,
        dec_id = excluded.dec_id,
        derivado_em = excluded.derivado_em,
        atualizado_em = now()
    where jr.fonte = 'derivado';  -- manual/planilha nunca são sobrescritas

  get diagnostics v_linhas = row_count;
  return v_linhas;
end $$;

revoke execute on function public.jm_recebiveis_derivar(text) from public, anon, authenticated;

-- ── Conciliação obrigatória PÓS-derivação (rodar e conferir antes de qualquer
-- tela; se não bater, é dupla contagem ou cliente órfão — parar e investigar):
--   select count(*), sum(bruto_nominal), sum(cota_cliente_liquida),
--          sum(honorario_contratual), sum(honorario_sucumbencial_rateado)
--     from jm_recebiveis;
--   -- Âncoras esperadas (doc jurimetria-fluxo-carteira §3): bruto total da base
--   -- ≈ R$ 113,75M (moral 40,23M + estético 1,45M + pensionamento 72,07M).
--   -- ATENÇÃO: a "âncora de R$ 41,7M" NÃO é o total — ignora pensionamento.
