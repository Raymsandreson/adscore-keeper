-- =============================================================================
-- `busca_chave_caso` para de comer o número quando ele vem sem prefixo.
--
-- O ERRO
-- A migration anterior (20260907140000) reusou `dom_normalizar_nome_grupo` para
-- limpar o texto antes de extrair o código do caso. Reuso errado: aquela função
-- foi escrita para nome de GRUPO, onde tudo que vem antes da primeira letra é
-- lixo (✅ 🟢 🟧 e espaço), e por isso o regex dela é `^[^A-Z]+`. Dígito no
-- começo cai nesse "lixo".
--
--     dom_normalizar_nome_grupo('1802')   ->  ''     (string vazia)
--     dom_normalizar_nome_grupo('183.1')  ->  ''
--     dom_normalizar_nome_grupo('PREV 1802') -> 'PREV 1802'   (esse funcionava)
--
-- Resultado medido: digitar "1802" não caía no ramo de caso, caía no de texto
-- livre. E como o texto livre ACHOU o grupo "PREV 1802 Izolete Muller" pelo
-- nome, a tela mostrava a coisa certa pelo motivo errado — o pior tipo de bug,
-- o que se disfarça de funcionalidade e só aparece no dia em que o nome do
-- grupo não tiver o número dentro.
--
-- O estrago maior estava no outro lado. Do lado da LINHA (p_estrito = false) a
-- mesma normalização é aplicada a `case_number`, e 1.279 dos 1.769 leads com
-- número guardam SÓ o número ("248", "1298"), sem prefixo. Nenhum deles casaria
-- nunca — 72% da tabela invisível para a busca por código.
--
-- O CONSERTO
-- `busca_chave_caso` passa a normalizar por conta própria, com `^[^A-Z0-9]+`:
-- corta emoji e pontuação do começo, mantém dígito.
--
-- `dom_normalizar_nome_grupo` NÃO é alterada. Ela está certa para o trabalho
-- dela (decidir escopo por prefixo do nome do grupo), e mexer nela mudaria a
-- classificação dos 1.149 grupos que acabaram de ser classificados. Duas
-- perguntas diferentes merecem duas funções diferentes; foi querer economizar
-- uma que causou isto.
-- =============================================================================

create or replace function public.busca_chave_caso(
  p_txt     text,
  p_estrito boolean default false
)
returns table (familia text, numero integer, sufixo text)
language sql
immutable
as $$
  with bruto as (
    select
      coalesce(p_txt, '') as t,
      -- Normalização PRÓPRIA: '^[^A-Z0-9]+' preserva o dígito inicial.
      -- Não trocar por dom_normalizar_nome_grupo(): ela usa '^[^A-Z]+' e
      -- devolve '' para '1802'. Ver cabeçalho.
      regexp_replace(
        upper(translate(
          coalesce(p_txt, ''),
          'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
          'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
        )),
        '^[^A-Z0-9]+', ''
      ) as n
  ),
  guardado as (
    select b.*,
      (length(public.cnj_digitos(b.t)) = 20 or b.t ~ '[0-9]{6,}') as recusa
    from bruto b
  ),
  achado as (
    select g.recusa,
      case when g.recusa then null else regexp_match(
        g.n,
        case when p_estrito
          then '^(PREV|CASO|FAMILIA|LEAD|SM|DG)?[[:space:]\-_|.]*([0-9]{1,5})(\.[0-9]{1,2})?[[:space:]]*$'
          else '^(PREV|CASO|FAMILIA|LEAD|SM|DG)?[[:space:]\-_|.]*([0-9]{1,5})(\.[0-9]{1,2})?'
        end
      ) end as m
    from guardado g
  )
  select a.m[1], a.m[2]::integer, ltrim(a.m[3], '.')
    from achado a
   where a.m is not null and a.m[2] is not null;
$$;

comment on function public.busca_chave_caso(text, boolean) is
  'Texto -> (familia, numero, sufixo) do codigo do caso. Normalizacao propria (mantem digito inicial). Recusa CNJ e bloco de 6+ digitos em vez de adivinhar.';

-- =============================================================================
-- ROLLBACK: recolar a versão de 20260907140000 (a que usa
-- dom_normalizar_nome_grupo). Só que ela está errada — reverter esta migration
-- reintroduz o bug. O rollback de verdade aqui é `drop function`, junto com o
-- rollback da 20260907140000.
-- =============================================================================
