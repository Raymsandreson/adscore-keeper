-- =============================================================================
-- Organiza a tabela de lançamentos: categoria canônica + natureza do caixa.
-- Banco alvo: EXTERNO kmedldlepwiityjsdahz.
--
-- O PROBLEMA, medido em 20/08/2026: `jm_lancamentos` tem **81 categorias
-- distintas**, que colapsam em 68 só normalizando caixa e acento. O mesmo
-- conceito aparece escrito de até cinco jeitos ("FOLHA DE PAGAMENTO Variável",
-- "variavel", "VARIÁVEL", "VARIAVEL", "VIARIAVEL"), e "Idenização" é erro de
-- digitação que virou categoria. Agrupar por texto cru parte toda contagem.
--
-- Pior que isso: a tabela mistura **três caixas diferentes** — dinheiro que
-- entra e sai por causa de processo, custo de manter o escritório, e vida
-- pessoal do sócio. "Quanto o escritório ganhou" hoje soma supermercado e IPVA.
--
-- É VIEW, NÃO COLUNA, de propósito: a régua ainda vai mudar conforme a leitura
-- automática dos autos amadurecer. Uma view se corrige com `create or replace`;
-- coluna gerada exigiria reescrever a tabela toda a cada ajuste. Nenhum dado é
-- alterado por esta migration.
--
-- A MESMA RÉGUA vive em `src/lib/lancamentoCategorias.ts` (`categoriaCanonica` e
-- `naturezaDoLancamento`), com 33 testes sobre as grafias reais. Mudou de um
-- lado, muda do outro — senão a tela e o SQL contam histórias diferentes.
--
-- Resultado da classificação (20/08/2026, 4.713 linhas):
--   processo    3.090 linhas   R$ 33.697.996,46
--   escritorio  1.400 linhas   R$  7.510.417,23
--   pessoal       223 linhas   R$     89.152,03
--
-- REVERSÃO: drop view if exists public.vw_jm_lancamentos_classificado;
-- =============================================================================

create or replace view public.vw_jm_lancamentos_classificado as
with base as (
  select l.*,
         l.processo_cnj is not null as tem_processo,
         -- Sem acento e em minúscula, para casar uma vez só.
         lower(translate(trim(coalesce(l.categoria, '')),
           'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
           'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) as c
  from public.jm_lancamentos l
),
limpo as (
  -- Erros de digitação vistos no dado real, corrigidos ANTES de casar.
  select b.*,
         regexp_replace(
           regexp_replace(
             regexp_replace(b.c, '\midenizacao\M', 'indenizacao', 'g'),
           '\mviariavel\M', 'variavel', 'g'),
         '\mpesoal\M', 'pessoal', 'g') as cl
  from base b
)
select
  l.*,
  case
    when l.cl = '' then 'SEM CATEGORIA'
    when l.cl like '%folha de pagamento%' or l.cl in ('variavel', 'pessoal variavel') then
      case when l.cl like '%fixo%' then 'FOLHA DE PAGAMENTO FIXO'
           else 'FOLHA DE PAGAMENTO VARIAVEL' end
    when l.cl like '%ajuda familia%' then
      case when l.cl like '%a pagar%' then 'AJUDA FAMILIA A PAGAR' else 'AJUDA FAMILIA' end
    when l.cl like '%adiantad%'  then 'HONORARIOS ADIANTADOS FIDC'
    -- Exige "honorário" junto: "Parceria"/"Parceira" podem ser rateio de
    -- sociedade, não repasse. Sem confirmação, ficam como categoria própria.
    when l.cl like '%parceir%' and l.cl like '%honorari%' then 'HONORARIOS ADV PARCEIRO'
    when l.cl like '%comprad%'   then 'INDENIZACAO COMPRADA'
    when l.cl like '%indenizacao%' then
      case when l.cl like '%a receber%' then 'INDENIZACAO A RECEBER' else 'INDENIZACAO' end
    when l.cl like '%honorari%' then
      case when l.cl like '%a receber%' then 'HONORARIOS A RECEBER' else 'HONORARIOS' end
    when l.cl like '%emprestimo%' then 'EMPRESTIMO BANCARIO'
    else upper(l.cl)
  end as categoria_canonica,
  case
    -- Vínculo com processo vence o texto: uma custa lançada num processo é do
    -- processo mesmo que a categoria diga "Outros".
    when l.tem_processo then 'processo'
    when l.c ~ 'indenizacao|honorari|custas|pericia|acordo|alvara|sucumb' then 'processo'
    when l.c ~ ('supermercado|restaurante|lanche|bebida|farra|noivado|viagem|uber|roupa|'
             || 'cuidados pessoais|saude|educacao|livro|doacao|ajuda familia|visita familia|'
             || 'manutencao casa|manutencao do carro|combustivel|ipva|licenciamento|hillux|'
             || 'utv|previdenciario') then 'pessoal'
    -- Desconhecido cai no escritório: errar para cá infla custo, não infla carteira.
    else 'escritorio'
  end as natureza
from limpo l;

comment on view public.vw_jm_lancamentos_classificado is
  'jm_lancamentos com categoria_canonica (colapsa as grafias) e natureza '
  '(processo | escritorio | pessoal). Régua espelhada em src/lib/lancamentoCategorias.ts.';
