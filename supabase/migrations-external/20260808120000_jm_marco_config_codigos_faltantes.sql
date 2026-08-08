-- =============================================================================
-- jm_marco_config: completar o de-para de códigos TPU/CNJ que faltavam.
--
-- POR QUE (medido em 08/08/2026, Externo kmedldlepwiityjsdahz):
--   vw_jm_duracoes sobre 344 processos devolvia acordão = 0. NENHUM acórdão
--   detectado na base inteira. A causa não é a lógica da view — é a tabela de
--   de-para procurando o código errado no grau errado:
--
--   A config mapeia 219/220/221 (Procedência / Improcedência / Procedência em
--   Parte) com grau='G2' como ACORDAO_*. Só que esses três códigos existem
--   APENAS em G1 nesta base — são SENTENÇA. Em 2º grau o tribunal não julga o
--   pedido, julga o RECURSO, e o movimento gravado é Provimento (237),
--   Provimento em Parte (238) ou Não-Provimento (239). Nenhum dos três estava
--   na config, então o marco de acórdão nunca podia disparar.
--
--   Pela mesma razão faltava o marco de abertura: "Distribuição" (26) não
--   existia na config e 297 dos 344 processos ficavam sem ajuizamento.
--
-- IMPACTO MEDIDO POR SIMULAÇÃO (SELECT, antes de aplicar):
--   ajuizamento ........ 297 processos ganham o marco (hoje 0)
--   acórdão 2º grau .... 109 processos ganham o marco (hoje 0)
--   decisão superior .... 50 processos ganham o marco (hoje 0)
--
-- NEUTRALIDADE DELIBERADA DO RESULTADO: os marcos de 2º grau e superior dizem
-- o que aconteceu com o RECURSO, não quem ganhou a causa. "Não-Provimento" do
-- recurso do réu significa que o autor VENCEU. O DataJud não informa quem
-- recorreu, então carimbar ACORDAO_IMPROCEDENTE em 239 inverteria o desfecho
-- de metade dos casos. Quem ganhou continua em lead_processes.resultado_atingido.
--
-- confirmado = false nas linhas novas: são de-para por código+nome, ainda não
-- validados contra um gabarito processo a processo (isso é a fase seguinte).
-- vw_jm_marcos NÃO filtra por confirmado, então a coluna aqui é sinalização,
-- não chave de ativação.
--
-- REVERSÃO: delete from jm_marco_config where confirmado = false;
-- (nenhuma linha pré-existente tem confirmado = false — as 22 originais são true)
-- =============================================================================

insert into public.jm_marco_config (marco, fase, codigo, grau, complemento_pattern, familia, confirmado)
select v.marco, v.fase, v.codigo, v.grau, v.complemento_pattern, 'JUDICIAL', false
from (values
  -- ---- CONHECIMENTO -------------------------------------------------------
  -- Abertura do processo. Só G1: em G2/SUP "Distribuição" é remessa ao relator.
  ('AJUIZAMENTO',                        'CONHECIMENTO',            26,    'G1', null),
  -- Audiências. 12747 "Inicial" é a audiência inaugural trabalhista, NÃO a
  -- petição inicial — os complementos são designada/realizada/cancelada e
  -- "dirigida por Juiz(a)". Junta-se às já mapeadas (970, 12740, 12749-12751).
  ('AUDIENCIA',                          'CONHECIMENTO',            12747, null, null),
  ('AUDIENCIA',                          'CONHECIMENTO',            12743, null, null),
  ('SANEAMENTO',                         'CONHECIMENTO',            12387, 'G1', null),

  -- ---- RECURSAL (2º grau) -------------------------------------------------
  -- O acórdão que faltava. Ver nota de neutralidade no cabeçalho.
  ('ACORDAO_PROVIMENTO',                 'RECURSAL',                237,   'G2', null),
  ('ACORDAO_PROVIMENTO_PARCIAL',         'RECURSAL',                238,   'G2', null),
  ('ACORDAO_NAO_PROVIMENTO',             'RECURSAL',                239,   'G2', null),
  -- Não conhecer e negar seguimento também encerram o recurso no tribunal.
  ('ACORDAO_NAO_CONHECIMENTO',           'RECURSAL',                235,   'G2', null),
  ('ACORDAO_NAO_CONHECIMENTO',           'RECURSAL',                236,   'G2', null),
  ('ACORDAO_RECURSO_PREJUDICADO',        'RECURSAL',                230,   'G2', null),
  -- Embargos de declaração: não movem o processo de fase, mas explicam meses
  -- de intervalo entre o acórdão e o trânsito — a calibragem de tempo precisa.
  ('EMBARGOS_ACOLHIDOS',                 'RECURSAL',                198,   null, null),
  ('EMBARGOS_ACOLHIDOS_PARCIAL',         'RECURSAL',                871,   null, null),
  ('EMBARGOS_REJEITADOS',                'RECURSAL',                200,   null, null),
  -- Juízo de admissibilidade do RR, feito no TRT antes de subir ao TST.
  ('ADMISSIBILIDADE_RECURSO_REVISTA',    'RECURSAL',                434,   'G2', null),
  ('ADMISSIBILIDADE_RECURSO_REVISTA',    'RECURSAL',                431,   'G2', null),

  -- ---- RECURSAL SUPERIOR (TST/STJ) ---------------------------------------
  -- Fase própria porque o POP "Trabalhistas judicial" separa 2ª instância de
  -- instância superior e de STF. Fases novas: não há CHECK em jm_marco_config.fase.
  ('DECISAO_SUPERIOR_PROVIMENTO',         'RECURSAL_SUPERIOR',       237,   'SUP', null),
  ('DECISAO_SUPERIOR_PROVIMENTO_PARCIAL', 'RECURSAL_SUPERIOR',       238,   'SUP', null),
  ('DECISAO_SUPERIOR_NAO_PROVIMENTO',     'RECURSAL_SUPERIOR',       239,   'SUP', null),
  ('DECISAO_SUPERIOR_NAO_CONHECIMENTO',   'RECURSAL_SUPERIOR',       235,   'SUP', null),
  ('DECISAO_SUPERIOR_NAO_CONHECIMENTO',   'RECURSAL_SUPERIOR',       236,   'SUP', null),

  -- ---- RECURSAL EXTRAORDINÁRIA (STF) -------------------------------------
  ('RECURSO_EXTRAORDINARIO',              'RECURSAL_EXTRAORDINARIA', 432,   null, null),

  -- ---- ENCERRAMENTO -------------------------------------------------------
  ('ARQUIVAMENTO_DEFINITIVO',             'ENCERRADO',               246,   null, null),
  ('BAIXA_DEFINITIVA',                    'ENCERRADO',               22,    null, null),
  ('DESISTENCIA',                         'ENCERRADO',               463,   'G1', null)
) as v(marco, fase, codigo, grau, complemento_pattern)
where not exists (
  -- Idempotente: a tabela não tem unique em (codigo, grau), então a guarda é aqui.
  select 1 from public.jm_marco_config c
   where c.codigo = v.codigo
     and coalesce(c.grau, '') = coalesce(v.grau, '')
     and coalesce(c.complemento_pattern, '') = coalesce(v.complemento_pattern, '')
);
