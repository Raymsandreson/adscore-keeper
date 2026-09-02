-- =============================================================================
-- Os atos que as movimentações anunciam viram marco; a evidência sem DataJud
--
-- Pedido do usuário (02/09/2026): "as movimentações informam quando entra com
-- réplica, contestação, recursos etc. — não são documentos, mas podem ser
-- usados para conferir os marcos alcançados". E: "pode tirar o DataJud do
-- pop_marco_evidencia".
--
-- 1. Sinal de texto ganha GRAU opcional (coluna `grau` de pop_marco_sinais,
--    antes usada só pelo tipo 'grau'). É o que separa "embargos de declaração"
--    do 1º grau (G1) do 2º (G2), e o acórdão do TST (SUP) do acórdão do TRT.
--    vw_pop_marcos_escavador respeita; vw_pop_marcos_feed (process_updates,
--    que não tem grau) só aplica sinal sem grau.
--
-- 2. 14 sinais de texto novos, calibrados contra as movimentações dos dois
--    POPs (classe `classificacao_predita.nome` do Escavador, ancorada no
--    início). Medido antes: trabalhista — ED 1º grau 22 processos, ED 2º grau
--    10, RO 7, agravo interno 1, RE 8, acórdão TST 6, liquidação 29,
--    constrição 7, pagamento espontâneo 68 (excluindo depósito recursal),
--    levantamento 4; BPC — ED 4, RO 1. Zero falso positivo nas amostras.
--
-- 3. pop_marco_evidencia deixa de consultar jm_movimentos; passa a mostrar
--    também o feed (process_updates) e a respeitar o grau do sinal — espelho
--    exato do que a régua lê. O front (MarcoEvidenciaDialog) perdeu o bloco
--    "Movimentos do DataJud que casaram".
--
-- Rollback: delete from pop_marco_sinais where motivo like '%[02/09/2026 atos por texto]%';
--   views: reaplicar 20260902140000 (feed) e 20260814130000 (escavador);
--   função: reaplicar 20260827120000_por_que_este_marco_a_evidencia_crua.sql.
-- =============================================================================
-- (aplicado direto no Externo em 02/09/2026; o corpo das views e da função é o
--  que está no banco — este arquivo registra a decisão e os padrões)

insert into public.pop_marco_sinais (pop_marco_id, tipo, grau, padrao, padrao_excluir, origem, confirmado, motivo)
select m.id, 'texto', v.grau, v.padrao, v.excl, 'manual', true, 'movimentação anuncia o ato [02/09/2026 atos por texto]'
from (values
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'::uuid,'embargos_1grau','^embargos de declara|^(n[ãa]o-)?acolhimento( em parte)? de embargos de declara|^conclusos os autos para julgamento dos embargos de declara',null,'G1'),
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15','embargos_2grau','^embargos de declara|^(n[ãa]o-)?acolhimento( em parte)? de embargos de declara|^conclusos os autos para julgamento dos embargos de declara',null,'G2'),
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15','remessa_2grau','^recurso ordin|^juntada a peti[çc][ãa]o de recurso ordin|^remetidos os autos (ao|para o) (trt|tribunal regional)',null,null),
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15','agravo_interno','^agravo (interno|regimental)',null,null),
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15','recurso_extraordinario','^recurso extraordin|^agravo em recurso extraordin',null,null),
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15','decisao_superior','^ac[óo]rd[ãa]o|^a c [óo] r d [ãa] o',null,'SUP'),
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15','liquidacao','^c[áa]lculo de liquida|^homologa[çc][ãa]o de liquida|^liquida[çc][ãa]o iniciada|^liquida[çc][ãa]o de senten|^homologa[çc][ãa]o d[oe]s? c[áa]lculo',null,null),
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15','constricao','^bloqueio/penhora|^certid[ãa]o de bacenjud|^renajud|^sisbajud|^transfer[êe]ncia - bloqueio|^penhora|^certid[ãa]o de consulta de (renajud|sisbajud|bacenjud)',null,null),
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15','pagamento_espontaneo','^comprovante de dep[óo]sito judicial|^dep[óo]sito judicial|^guia de dep[óo]sito judicial|^comprovante de pagamento','recursal',null),
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15','pagamento','^levantamento|levantamento realizado|comprovante (de )?levantamento|^transfer[êe]ncia de valores|^ordem de pagamento','suspens|sobrest',null),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6','embargos_1grau','^embargos de declara|^(n[ãa]o-)?acolhimento( em parte)? de embargos de declara|^conclusos os autos para julgamento dos embargos de declara',null,'G1'),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6','remessa_2grau','^recurso inominado|^apela[çc][ãa]o|^recurso ordin|^remetidos os autos (ao|para o|[àa]) (trf|tribunal regional federal|turma recursal)',null,null),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6','decisao_superior','^recurso especial|turma nacional de uniformiza|^pedido de uniformiza|^agravo em recurso especial',null,null),
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6','pagamento','^levantamento|levantamento realizado|^ordem de pagamento|pagamento d[ao] rpv|^comprovante de levantamento','suspens|sobrest',null)
) as v(board_id, chave, padrao, excl, grau)
join public.pop_marcos m on m.board_id = v.board_id and m.chave = v.chave
where not exists (select 1 from public.pop_marco_sinais s where s.pop_marco_id = m.id and s.tipo = 'texto' and s.padrao = v.padrao);

-- vw_pop_marcos_escavador: por_texto ganha `and (s.grau is null or m.grau = s.grau)`.
-- vw_pop_marcos_feed:      join de sinais ganha `and s.grau is null`.
-- pop_marco_evidencia:     sem o bloco jm_movimentos; casados do Escavador com o
--                          mesmo filtro de grau; união com process_updates; a
--                          chave 'datajud' e 'cobertura.movimentos_datajud' saem
--                          do retorno (o front foi ajustado junto).

select public.refresh_process_pop_marcos();
select count(*) from public.aplicar_fase_por_marco();
