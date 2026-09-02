-- =============================================================================
-- Recurso de Revista passa a ser reconhecido pelo TEXTO do Escavador
--
-- Caso 60 (0100419-74.2021.5.01.0281), 02/09/2026: a régua dizia "Embargos de
-- declaração (2º grau) · 15/12/2025" enquanto as movimentações mostravam
--   17/07/2026  Juntada a petição de Recurso de Revista
--   12/08/2026  Conclusos os autos para decisão de admissibilidade do Recurso de Revista
--   24/08/2026  Remessa à CREC (Coordenadoria de Admissibilidade Recursal do TRT1)
--
-- Por quê: `admissibilidade_rr` e `agravo_instrumento` só tinham sinal `tpu`
-- (DataJud, códigos 431/434), e o DataJud deste processo parou em 12/06/2026
-- (jm_movimentos: 512 movimentos, último em 12/06). Os três andamentos acima só
-- existem em lead_processes.movimentacoes (Escavador), que a régua lê pelo
-- sinal `texto` (vw_pop_marcos_escavador) — e a cadeia recursal inteira do POP
-- trabalhista não tinha nenhum. Quando o DataJud atrasa, a régua congela.
--
-- Padrões calibrados contra a carteira inteira do POP (553 processos com
-- movimentações) em 02/09/2026. Os únicos textos que casam:
--   classe:   "recurso de revista" · "contrarrazões de recurso de revista"
--   conteúdo: "juntada a petição de recurso de revista"
--             "conclusos os autos para decisão de admissibilidade do recurso de revista"
--             "remessa à crec"
-- Descartado de propósito: "conclusos ... admissibilidade do recurso a <juiz>"
-- (sem "de revista") — é a admissibilidade do Recurso ORDINÁRIO, feita no 1º
-- grau; casaria 8 processos na fase errada. Também fora "coordenadoria de
-- recursos" solto (casa TJ estadual) e o corpo de publicações do TST (quem
-- está no TST já é pego pelo sinal `grau = SUP` de remessa_superior).
--
-- Efeito medido antes de aplicar: 6 processos casam admissibilidade_rr, 4 deles
-- ainda sem o marco (todos mudam de fase para a frente); 6 ganham
-- agravo_instrumento. Nenhum processo volta de fase — a régua só anda para o
-- marco de maior ordem detectado.
--
-- Rollback: delete from pop_marco_sinais where motivo like '%[02/09/2026 RR por texto]%';
-- depois `select public.refresh_process_pop_marcos();` — o tick de 30 min
-- (pop-marcos-tick) também refaz sozinho.
-- =============================================================================

insert into public.pop_marco_sinais
  (pop_marco_id, tipo, codigo, grau, complemento_pattern, padrao, padrao_excluir, origem, confirmado, motivo)
select m.id, 'texto', null, null, null, v.padrao, null, 'manual', true,
       v.motivo || ' [02/09/2026 RR por texto]'
from (values
  ('admissibilidade_rr',
   '^recurso de revista$|^contrarraz[õo]es de recurso de revista|^juntada a peti[çc][ãa]o de recurso de revista|^conclusos os autos para decis[ãa]o de admissibilidade do recurso de revista|^remessa [àa] crec',
   'RR interposto, contrarrazoado, concluso para admissibilidade ou remetido à CREC: o processo está na admissibilidade do RR mesmo com o DataJud atrasado'),
  ('agravo_instrumento',
   '^agravo de instrumento em recurso de revista$|^juntada a peti[çc][ãa]o de agravo de instrumento em recurso de revista',
   'AIRR pelo texto do Escavador, mesmo motivo do admissibilidade_rr')
) as v(chave, padrao, motivo)
join public.pop_marcos m on m.chave = v.chave
 and m.board_id = '0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'   -- Trabalhistas judicial — marcos
where not exists (
  select 1 from public.pop_marco_sinais s
  where s.pop_marco_id = m.id and s.tipo = 'texto' and s.padrao = v.padrao
);

-- Rematerializa só quem tem POP trabalhista; o tick faria o mesmo em até 30 min.
select public.refresh_process_pop_marcos(p.id)
from public.lead_processes p
where p.workflow_id = '0bcd8be6-3aa5-4ab0-8091-9987bdc47e15' and p.deleted_at is null;

select public.aplicar_fase_por_marco();
