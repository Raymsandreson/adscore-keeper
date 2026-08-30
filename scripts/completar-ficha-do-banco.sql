-- =============================================================================
-- Completar a ficha do processo com o que o BANCO já sabe — em lote.
--
-- É o mesmo que o botão "Completar do banco" da ficha faz um processo por vez
-- (src/lib/fichaDoBanco.ts + src/hooks/useFichaDoBanco.ts), aplicado a todos.
-- Custo ZERO de API: nenhuma consulta ao Escavador, só junção de tabelas que já
-- existem no Supabase Externo (kmedldlepwiityjsdahz).
--
-- POR QUE EXISTE (30/08/2026): 1.175 dos 1.291 processos judiciais estavam sem
-- tribunal, 1.181 sem polo ativo e 896 sem nenhuma data de início. Motivo: eles
-- foram alimentados pelo endpoint /movimentacoes do Escavador (edge
-- backfill-process-marcos), que NÃO devolve capa — só o botão "Buscar no
-- Escavador" da ficha traz capa, e ele nunca rodou nesses processos
-- (escavador_raw NULL em 1.175 deles).
-- Isso NÃO afeta a jurimetria (nenhuma view vw_jm_* lê estes campos; conferido
-- em 30/08/2026 — a única que toca lead_processes é vw_jm_conciliacao_acordos,
-- e só usa process_number e title), mas quebra a busca da carteira por
-- UF/cidade/tribunal (useCarteiraDoPop.ts) e deixa o processo sem o marco de
-- ajuizamento, que a régua tira de data_distribuicao/data_inicio.
--
-- ORDEM DE PRECEDÊNCIA (a mesma da ficha): nota do cadastro → DataJud →
-- jurimetria. A leitura das PUBLICAÇÕES (regex sobre o texto da intimação, que
-- na ficha vem antes de tudo) fica de fora: o `substring()` do Postgres decide a
-- gulodice pela expressão inteira e não reproduz o `(?=...)` do parser em JS.
-- Os campos que só a publicação dá (classe, área) continuam a cargo do botão.
--
-- SEGURANÇA:
--   * só grava em coluna NULL — nunca sobrescreve dado existente;
--   * idempotente: rodar de novo não muda mais nada;
--   * não toca em data_ultima_verificacao (isso é carimbo de busca real);
--   * bloco 0 grava o estado anterior; bloco 3 desfaz tudo.
--
-- USO: bloco 0 (backup) → bloco 1 (dry-run) → bloco 2 (update).
-- =============================================================================


-- ============================ 0. BACKUP / ROTA DE FUGA =======================
-- Guarda o estado atual das colunas tocadas, para o rollback do bloco 3.
CREATE TABLE IF NOT EXISTS lead_processes_ficha_backfill_20260830 AS
SELECT id, polo_ativo, polo_passivo, orgao_julgador, grau, tribunal_sigla,
       unidade_origem_cidade, estado_origem_sigla, data_distribuicao,
       data_inicio, ano_inicio, data_ultima_movimentacao
FROM lead_processes
WHERE deleted_at IS NULL
  AND process_number ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$';

-- A cópia carrega nome de parte: RLS ligada e SEM policy — só o service_role lê.
ALTER TABLE lead_processes_ficha_backfill_20260830 ENABLE ROW LEVEL SECURITY;


-- ============================ FONTES (usadas nos blocos 1 e 2) ===============
-- Copie o WITH inteiro antes do SELECT do dry-run ou do UPDATE.
--
-- WITH alvo AS (...), dj AS (...), jm AS (...), partes AS (...), mov AS (...),
--      nota AS (...), calc AS (...)


-- ============================ 1. DRY-RUN =====================================
WITH alvo AS (
  SELECT lp.id,
         regexp_replace(lp.process_number, '\D', '', 'g') AS cnj_num,
         lp.notes,
         lp.polo_ativo               AS old_polo_ativo,
         lp.polo_passivo             AS old_polo_passivo,
         lp.orgao_julgador           AS old_orgao_julgador,
         lp.grau                     AS old_grau,
         lp.tribunal_sigla           AS old_tribunal_sigla,
         lp.unidade_origem_cidade    AS old_cidade,
         lp.estado_origem_sigla      AS old_uf,
         lp.data_distribuicao        AS old_data_distribuicao,
         lp.data_inicio              AS old_data_inicio,
         lp.ano_inicio               AS old_ano_inicio,
         lp.data_ultima_movimentacao AS old_ultima_mov
  FROM lead_processes lp
  WHERE lp.deleted_at IS NULL
    AND lp.process_number ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'
),
-- DataJud: o movimento MAIS RECENTE carrega o órgão e o grau atuais.
-- O alias vem minúsculo ("tst"); a ficha usa a sigla em caixa alta.
dj AS (
  SELECT DISTINCT ON (cnj_num)
         cnj_num,
         nullif(btrim(orgao_julgador), '')        AS orgao_julgador,
         nullif(upper(btrim(tribunal_alias)), '') AS tribunal_sigla,
         nullif(btrim(grau), '')                  AS grau
  FROM vw_estacao_evidencia_datajud
  ORDER BY cnj_num, data_hora DESC
),
-- Jurimetria da carteira: empresa, cidade, UF, protocolo. A linha INTERNO ganha.
jm AS (
  SELECT DISTINCT ON (cnj_num) cnj_num, empresa, cidade_proc, uf_proc, data_protocolo
  FROM (
    SELECT regexp_replace(processo_cnj, '\D', '', 'g') AS cnj_num,
           nullif(btrim(empresa), '')     AS empresa,
           nullif(btrim(cidade_proc), '') AS cidade_proc,
           nullif(btrim(uf_proc), '')     AS uf_proc,
           data_protocolo,
           origem
    FROM jm_processos
  ) z
  ORDER BY cnj_num, (origem = 'INTERNO') DESC, data_protocolo NULLS LAST
),
-- Partes da jurimetria, com o mesmo "Capitalizar Nome" de capitalizarNome().
partes AS (
  SELECT cnj_num, string_agg(nome, ', ' ORDER BY nome) AS clientes
  FROM (
    SELECT DISTINCT
           regexp_replace(p.processo_cnj, '\D', '', 'g') AS cnj_num,
           (SELECT string_agg(
                     CASE WHEN t.i > 1 AND t.w = ANY (ARRAY['de','da','do','das','dos','e','em','a','o'])
                          THEN t.w ELSE initcap(t.w) END, ' ' ORDER BY t.i)
              FROM unnest(string_to_array(lower(btrim(regexp_replace(p.cliente, '\s+', ' ', 'g'))), ' '))
                   WITH ORDINALITY AS t(w, i)) AS nome
    FROM jm_partes p
    WHERE coalesce(btrim(p.cliente), '') <> ''
  ) x
  GROUP BY cnj_num
),
-- Última publicação guardada (process_movements), como na ficha.
mov AS (
  SELECT process_id, max(data_movimentacao) AS ultima
  FROM process_movements
  GROUP BY process_id
),
-- O que a nota do cadastro diz — mesmos padrões de lerNotas(): o valor vai até
-- `;` ou ponto SEGUIDO DE ESPAÇO, nunca no ponto de "S.A".
nota AS (
  SELECT a.id,
         nullif(btrim(substring(a.notes FROM '(?i)polo ativo\s*:\s*((?:[^.;\n]|\.(?=\S))+)')), '')   AS polo_ativo_bruto,
         nullif(btrim(substring(a.notes FROM '(?i)polo passivo\s*:\s*((?:[^.;\n]|\.(?=\S))+)')), '') AS polo_passivo_bruto,
         substring(a.notes FROM '(?i)protocolo\s*:\s*(\d{2}/\d{2}/\d{4})')                           AS protocolo_br
  FROM alvo a
),
-- Mesmo ehNome() da lib: parte anonimizada em iniciais ("R. G. M. P.") não vira
-- polo — gravar a primeira letra some com o aviso de que o dado falta.
nota_util AS (
  SELECT id,
         CASE WHEN polo_ativo_bruto   ~ '[A-Za-zÀ-ÿ]{3,}' THEN polo_ativo_bruto   END AS polo_ativo,
         CASE WHEN polo_passivo_bruto ~ '[A-Za-zÀ-ÿ]{3,}' THEN polo_passivo_bruto END AS polo_passivo,
         protocolo_br
  FROM nota
),
calc AS (
  SELECT a.*,
         coalesce(n.polo_ativo, pa.clientes)   AS novo_polo_ativo,
         coalesce(n.polo_passivo, j.empresa)   AS novo_polo_passivo,
         d.orgao_julgador                      AS novo_orgao_julgador,
         d.grau                                AS novo_grau,
         d.tribunal_sigla                      AS novo_tribunal_sigla,
         j.cidade_proc                         AS novo_cidade,
         j.uf_proc                             AS novo_uf,
         coalesce(
           CASE WHEN n.protocolo_br IS NOT NULL
                THEN to_char(to_date(n.protocolo_br, 'DD/MM/YYYY'), 'YYYY-MM-DD') END,
           to_char(j.data_protocolo, 'YYYY-MM-DD')
         )                                     AS novo_data_distribuicao,
         to_char(m.ultima, 'YYYY-MM-DD')       AS novo_ultima_mov
  FROM alvo a
  LEFT JOIN dj     d  ON d.cnj_num    = a.cnj_num
  LEFT JOIN jm     j  ON j.cnj_num    = a.cnj_num
  LEFT JOIN partes pa ON pa.cnj_num   = a.cnj_num
  LEFT JOIN nota_util n ON n.id       = a.id
  LEFT JOIN mov    m  ON m.process_id = a.id
)
SELECT
  count(*) FILTER (WHERE old_polo_ativo        IS NULL AND novo_polo_ativo        IS NOT NULL) AS polo_ativo,
  count(*) FILTER (WHERE old_polo_passivo      IS NULL AND novo_polo_passivo      IS NOT NULL) AS polo_passivo,
  count(*) FILTER (WHERE old_orgao_julgador    IS NULL AND novo_orgao_julgador    IS NOT NULL) AS orgao_julgador,
  count(*) FILTER (WHERE old_grau              IS NULL AND novo_grau              IS NOT NULL) AS grau,
  count(*) FILTER (WHERE old_tribunal_sigla    IS NULL AND novo_tribunal_sigla    IS NOT NULL) AS tribunal_sigla,
  count(*) FILTER (WHERE old_cidade            IS NULL AND novo_cidade            IS NOT NULL) AS cidade,
  count(*) FILTER (WHERE old_uf                IS NULL AND novo_uf                IS NOT NULL) AS uf,
  count(*) FILTER (WHERE old_data_distribuicao IS NULL AND novo_data_distribuicao IS NOT NULL) AS data_distribuicao,
  count(*) FILTER (WHERE old_data_inicio       IS NULL AND novo_data_distribuicao IS NOT NULL) AS data_inicio,
  count(*) FILTER (WHERE old_ano_inicio        IS NULL AND novo_data_distribuicao IS NOT NULL) AS ano_inicio,
  count(*) FILTER (WHERE old_ultima_mov        IS NULL AND novo_ultima_mov        IS NOT NULL) AS ultima_mov
FROM calc;


-- ============================ 2. UPDATE ======================================
-- (mesmo WITH do bloco 1; repetido porque cada bloco roda sozinho)
WITH alvo AS (
  SELECT lp.id,
         regexp_replace(lp.process_number, '\D', '', 'g') AS cnj_num,
         lp.notes
  FROM lead_processes lp
  WHERE lp.deleted_at IS NULL
    AND lp.process_number ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'
),
dj AS (
  SELECT DISTINCT ON (cnj_num)
         cnj_num,
         nullif(btrim(orgao_julgador), '')        AS orgao_julgador,
         nullif(upper(btrim(tribunal_alias)), '') AS tribunal_sigla,
         nullif(btrim(grau), '')                  AS grau
  FROM vw_estacao_evidencia_datajud
  ORDER BY cnj_num, data_hora DESC
),
jm AS (
  SELECT DISTINCT ON (cnj_num) cnj_num, empresa, cidade_proc, uf_proc, data_protocolo
  FROM (
    SELECT regexp_replace(processo_cnj, '\D', '', 'g') AS cnj_num,
           nullif(btrim(empresa), '')     AS empresa,
           nullif(btrim(cidade_proc), '') AS cidade_proc,
           nullif(btrim(uf_proc), '')     AS uf_proc,
           data_protocolo, origem
    FROM jm_processos
  ) z
  ORDER BY cnj_num, (origem = 'INTERNO') DESC, data_protocolo NULLS LAST
),
partes AS (
  SELECT cnj_num, string_agg(nome, ', ' ORDER BY nome) AS clientes
  FROM (
    SELECT DISTINCT
           regexp_replace(p.processo_cnj, '\D', '', 'g') AS cnj_num,
           (SELECT string_agg(
                     CASE WHEN t.i > 1 AND t.w = ANY (ARRAY['de','da','do','das','dos','e','em','a','o'])
                          THEN t.w ELSE initcap(t.w) END, ' ' ORDER BY t.i)
              FROM unnest(string_to_array(lower(btrim(regexp_replace(p.cliente, '\s+', ' ', 'g'))), ' '))
                   WITH ORDINALITY AS t(w, i)) AS nome
    FROM jm_partes p
    WHERE coalesce(btrim(p.cliente), '') <> ''
  ) x
  GROUP BY cnj_num
),
mov AS (
  SELECT process_id, max(data_movimentacao) AS ultima
  FROM process_movements GROUP BY process_id
),
nota AS (
  SELECT a.id,
         nullif(btrim(substring(a.notes FROM '(?i)polo ativo\s*:\s*((?:[^.;\n]|\.(?=\S))+)')), '')   AS polo_ativo_bruto,
         nullif(btrim(substring(a.notes FROM '(?i)polo passivo\s*:\s*((?:[^.;\n]|\.(?=\S))+)')), '') AS polo_passivo_bruto,
         substring(a.notes FROM '(?i)protocolo\s*:\s*(\d{2}/\d{2}/\d{4})')                           AS protocolo_br
  FROM alvo a
),
-- Mesmo ehNome() da lib: parte anonimizada em iniciais ("R. G. M. P.") não vira
-- polo — gravar a primeira letra some com o aviso de que o dado falta.
nota_util AS (
  SELECT id,
         CASE WHEN polo_ativo_bruto   ~ '[A-Za-zÀ-ÿ]{3,}' THEN polo_ativo_bruto   END AS polo_ativo,
         CASE WHEN polo_passivo_bruto ~ '[A-Za-zÀ-ÿ]{3,}' THEN polo_passivo_bruto END AS polo_passivo,
         protocolo_br
  FROM nota
),
calc AS (
  SELECT a.id,
         coalesce(n.polo_ativo, pa.clientes) AS polo_ativo,
         coalesce(n.polo_passivo, j.empresa) AS polo_passivo,
         d.orgao_julgador, d.grau, d.tribunal_sigla,
         j.cidade_proc AS unidade_origem_cidade,
         j.uf_proc     AS estado_origem_sigla,
         coalesce(
           CASE WHEN n.protocolo_br IS NOT NULL
                THEN to_char(to_date(n.protocolo_br, 'DD/MM/YYYY'), 'YYYY-MM-DD') END,
           to_char(j.data_protocolo, 'YYYY-MM-DD')
         ) AS data_distribuicao,
         to_char(m.ultima, 'YYYY-MM-DD') AS data_ultima_movimentacao
  FROM alvo a
  LEFT JOIN dj     d  ON d.cnj_num    = a.cnj_num
  LEFT JOIN jm     j  ON j.cnj_num    = a.cnj_num
  LEFT JOIN partes pa ON pa.cnj_num   = a.cnj_num
  LEFT JOIN nota_util n ON n.id       = a.id
  LEFT JOIN mov    m  ON m.process_id = a.id
)
UPDATE lead_processes lp
SET polo_ativo              = coalesce(lp.polo_ativo, c.polo_ativo),
    polo_passivo            = coalesce(lp.polo_passivo, c.polo_passivo),
    orgao_julgador          = coalesce(lp.orgao_julgador, c.orgao_julgador),
    grau                    = coalesce(lp.grau, c.grau),
    tribunal_sigla          = coalesce(lp.tribunal_sigla, c.tribunal_sigla),
    unidade_origem_cidade   = coalesce(lp.unidade_origem_cidade, c.unidade_origem_cidade),
    estado_origem_sigla     = coalesce(lp.estado_origem_sigla, c.estado_origem_sigla),
    data_distribuicao       = coalesce(lp.data_distribuicao, c.data_distribuicao),
    data_inicio             = coalesce(lp.data_inicio, c.data_distribuicao),
    ano_inicio              = coalesce(lp.ano_inicio, nullif(left(c.data_distribuicao, 4), '')::int),
    data_ultima_movimentacao = coalesce(lp.data_ultima_movimentacao, c.data_ultima_movimentacao)
FROM calc c
WHERE c.id = lp.id
  AND (   (lp.polo_ativo               IS NULL AND c.polo_ativo               IS NOT NULL)
       OR (lp.polo_passivo             IS NULL AND c.polo_passivo             IS NOT NULL)
       OR (lp.orgao_julgador           IS NULL AND c.orgao_julgador           IS NOT NULL)
       OR (lp.grau                     IS NULL AND c.grau                     IS NOT NULL)
       OR (lp.tribunal_sigla           IS NULL AND c.tribunal_sigla           IS NOT NULL)
       OR (lp.unidade_origem_cidade    IS NULL AND c.unidade_origem_cidade    IS NOT NULL)
       OR (lp.estado_origem_sigla      IS NULL AND c.estado_origem_sigla      IS NOT NULL)
       OR (lp.data_distribuicao        IS NULL AND c.data_distribuicao        IS NOT NULL)
       OR (lp.data_inicio              IS NULL AND c.data_distribuicao        IS NOT NULL)
       OR (lp.ano_inicio               IS NULL AND c.data_distribuicao        IS NOT NULL)
       OR (lp.data_ultima_movimentacao IS NULL AND c.data_ultima_movimentacao IS NOT NULL));


-- ============================ 3. ROLLBACK ====================================
-- Devolve as 11 colunas ao estado do bloco 0. Só rode se algo saiu errado.
--
-- UPDATE lead_processes lp
-- SET polo_ativo = b.polo_ativo, polo_passivo = b.polo_passivo,
--     orgao_julgador = b.orgao_julgador, grau = b.grau, tribunal_sigla = b.tribunal_sigla,
--     unidade_origem_cidade = b.unidade_origem_cidade, estado_origem_sigla = b.estado_origem_sigla,
--     data_distribuicao = b.data_distribuicao, data_inicio = b.data_inicio,
--     ano_inicio = b.ano_inicio, data_ultima_movimentacao = b.data_ultima_movimentacao
-- FROM lead_processes_ficha_backfill_20260830 b
-- WHERE b.id = lp.id;
