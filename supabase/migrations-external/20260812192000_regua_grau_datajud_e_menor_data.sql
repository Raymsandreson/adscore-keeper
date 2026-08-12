-- =============================================================================
-- O SINAL DE GRAU TAMBÉM VALE NO DATAJUD — e a régua passa a usar a menor data
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Achado logo depois de aplicar 20260812190000, no processo que motivou tudo
-- (0016855-58.2023.5.16.0008):
--
--   Subida ao TST detectada em 31/07/2026 (Escavador)
--   Distribuição grau SUP em jm_movimentos:  14/05/2026 (DataJud)
--
-- Dois meses e meio de diferença, e o DataJud estava certo. Motivo: o sinal
-- tipo 'grau' só era lido em vw_pop_marcos_escavador. O DataJud tem `grau`
-- ('G1','G2','SUP') em cada movimento e cobre 76 CNJs no superior e 144 no
-- segundo grau — mais que os 51 e 92 do Escavador.
--
-- MUDANÇA DE REGRA JUNTO: a consolidação passa de "TPU vence" para "vence a
-- MENOR data, empate desempata por TPU". O marco é a PRIMEIRA vez que o fato
-- aparece; escolher por fonte fazia o marco 'nascer' na data em que a fonte
-- preferida notou, não em que aconteceu. A calibragem documento-refina-movimento
-- continua intacta: ela é interna à v1, que segue entrando aqui como uma linha
-- só por marco.
--
-- REVERSÃO: recriar as duas views com o corpo de 20260812190000.
-- =============================================================================

create or replace view public.vw_pop_marcos_grau_datajud as
select pm.board_id, pm.chave as marco_chave, pm.ordem, pm.rotulo, pm.stage_id,
       regexp_replace(m.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
       min(m.data_hora)::date as data_detectada,
       count(*)::bigint as itens,
       'movimento_grau'::text as fonte_deteccao
from public.pop_marcos pm
join public.pop_marco_sinais s on s.pop_marco_id = pm.id and s.tipo = 'grau'
join public.jm_movimentos m on m.grau = s.grau
where m.data_hora is not null
group by 1,2,3,4,5,6;

comment on view public.vw_pop_marcos_grau_datajud is
  'Subida de instancia pelo grau do movimento do DataJud. Mesma ideia do sinal de grau no Escavador, fonte diferente.';

create or replace view public.vw_pop_marcos_regua as
with todas as (
  select d.board_id, d.marco_chave, d.ordem, d.rotulo, d.stage_id,
         regexp_replace(d.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
         d.data_detectada, d.fonte_deteccao, d.tem_prova_documental, 1 as prioridade
  from public.vw_pop_marcos_detectados d
  where d.data_detectada is not null
  union all
  select g.board_id, g.marco_chave, g.ordem, g.rotulo, g.stage_id,
         g.cnj_num, g.data_detectada, g.fonte_deteccao, false, 2
  from public.vw_pop_marcos_grau_datajud g
  union all
  select e.board_id, e.marco_chave, e.ordem, e.rotulo, e.stage_id,
         e.cnj_num, e.data_detectada, e.fonte_deteccao, false, 3
  from public.vw_pop_marcos_escavador e
)
select distinct on (board_id, cnj_num, marco_chave)
       board_id, cnj_num, marco_chave, ordem, rotulo, stage_id,
       data_detectada, fonte_deteccao, tem_prova_documental
from todas
order by board_id, cnj_num, marco_chave, data_detectada, prioridade;

comment on view public.vw_pop_marcos_regua is
  'Marco por processo nas quatro leituras: TPU, documento, grau do DataJud e Escavador. Vence a menor data; empate desempata por TPU.';
