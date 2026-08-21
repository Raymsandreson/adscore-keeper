-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- APLICADA em 21/08/2026 via MCP. Mantida aqui como registro do schema.
-- ============================================================================
-- Um documento nao traz UM valor: traz varios, e cada um tem natureza propria.
--
-- O caso que motivou (planilha de atualizacao de calculo, 8 paginas, lida em
-- 21/08/2026): valor da causa R$ 604.180,14, liquido ao reclamante
-- R$ 689.388,83, honorario do patrono R$ 125.534,20, sucumbencia
-- R$ 760.934,53, mais dois pagamentos ja feitos. Seis linhas, nao uma. Lancar
-- isso a mao, um por um, era exatamente o trabalho que a leitura existe para
-- tirar.
--
--   verba          de QUE natureza e o valor: dano moral, pensionamento,
--                  sucumbencia, horas extras... Aberto de proposito: cada ramo
--                  tem as suas verbas, e a lista ainda vai mudar. Mesma decisao
--                  que `jm_documento_leitura.partes` tomou ao usar jsonb.
--   valor_nominal  o principal, sem juros nem correcao.
--   juros          o que se somou ao principal ate a data do calculo.
--                  `amount` continua sendo o TOTAL — os dois campos existem
--                  para poder responder "quanto e principal e quanto e tempo",
--                  que e o que decide desagio e o que se pode ceder.
--
--   origem_leitura de qual leitura de peca (`jm_documento_leitura`) a linha
--                  nasceu. NULL = lancamento feito a mao. Sem isso nao da para
--                  reprocessar uma safra de leitura nem saber o que apagar
--                  quando um prompt novo reler a mesma peca.
--
--   conferido      false = a IA sugeriu e ninguem confirmou ainda. Linha assim
--                  NAO entra em total nenhum. Decisao do Raym em 21/08/2026:
--                  valor de condenacao lido por IA que vira numero fechado sem
--                  ninguem olhar e caro de descobrir depois. Default true para
--                  o lancamento manual continuar contando como sempre contou.
--
-- REVERSAO (aditiva, nenhum dado pre-existente e tocado):
--   drop index if exists public.idx_lead_financials_a_conferir;
--   alter table public.lead_financials
--     drop column if exists verba,
--     drop column if exists valor_nominal,
--     drop column if exists juros,
--     drop column if exists origem_leitura,
--     drop column if exists conferido;

alter table public.lead_financials
  add column if not exists verba          text,
  add column if not exists valor_nominal  numeric(14,2),
  add column if not exists juros          numeric(14,2),
  add column if not exists origem_leitura bigint,
  add column if not exists conferido      boolean not null default true;

comment on column public.lead_financials.verba is
  'Natureza do valor: dano moral, pensionamento, sucumbencia, horas extras... Aberto, como jm_documento_leitura.partes.';
comment on column public.lead_financials.valor_nominal is
  'Principal, sem juros nem correcao. amount continua sendo o total.';
comment on column public.lead_financials.juros is
  'Juros e correcao somados ao principal. amount = valor_nominal + juros quando os dois sao conhecidos.';
comment on column public.lead_financials.origem_leitura is
  'jm_documento_leitura.id de onde a linha nasceu. NULL = lancado a mao.';
comment on column public.lead_financials.conferido is
  'false = sugestao de IA aguardando confirmacao. Linha nao conferida NAO entra em total nenhum.';

-- A fila de conferencia e a pergunta cara: "o que a IA propos e ninguem olhou".
create index if not exists idx_lead_financials_a_conferir
  on public.lead_financials(process_id)
  where conferido = false;
