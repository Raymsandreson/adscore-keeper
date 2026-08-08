-- =============================================================================
-- Complementa 20260807100000 com o que so apareceu ao rodar os 14 arquivos de
-- 202501 a 202603 (619.529 registros). Tres achados que nao dava pra ver com o
-- arquivo de janeiro sozinho:
--
-- 1. A competencia de um arquivo e a data de EMISSAO da CAT, nao a do acidente.
--    Em 202507: emissao 63.785 em jul + 2.743 em ago, contra acidentes
--    espalhados por 5 meses (jul 53.646, jun 10.234, mai 1.168, abr 435).
--    E CAT.JUN.25.ZIP nao e junho: 214.745 linhas cobrindo jun (66.737),
--    jul (75.123), ago (72.775) e set (110) — sobrepoe os arquivos de julho e
--    agosto inteiros. Sem identificador de CAT na origem, nao ha dedup possivel
--    depois da carga, entao o import filtra por competencia.
--
-- 2. O campo de codigo do CID tem largura fixa 6. Ate 202506 vinha preenchido
--    com espaco ("S610  "); em 202507 a origem passou a serializar o subcampo
--    nulo como a string "NULL", truncada pelo campo: "S610NU", "S61NUL" —
--    66.528 de 66.528 linhas do arquivo. Normalizado com ^[A-Z]\d{2,3}.
--
-- 3. CNAE "0000" e ausencia de classificacao, nao um setor. Aparece a partir de
--    202506 em ~3% das linhas (7.481 em jun/25, 2.487 em mar/26). Vira NULL.
--
-- Sem DDL: so metadado. ROLLBACK nao se aplica.
-- =============================================================================

comment on column public.cat_inss_registros.competencia is
  'Mes do arquivo de origem, que corresponde a data de EMISSAO da CAT, nao a do acidente. A carga filtra por isso: CAT.JUN.25.ZIP traz jun+jul+ago e sobreporia os arquivos de julho e agosto.';
comment on column public.cat_inss_registros.cid_codigo is
  'Extraido com ^[A-Z]\d{2,3}. O campo de origem tem largura fixa 6 e em 202507 passou a vir preenchido com a string NULL truncada (S610NU, S61NUL) em 66.528/66.528 linhas.';
comment on column public.cat_inss_registros.cnae_codigo is
  'NULL quando a origem manda "0000", que e ausencia de classificacao e nao um setor. Aparece a partir de 202506, ~3% das linhas.';
comment on column public.cat_inss_registros.data_acidente is
  'Pode ser de meses anteriores a competencia: a CAT e emitida depois do acidente. Em 202507, so 53.646 de 66.528 acidentes eram do proprio mes.';
