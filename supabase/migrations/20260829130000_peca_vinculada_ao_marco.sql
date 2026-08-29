-- =============================================================================
-- Peça anexada NA linha do marco sustenta o marco (Externo, 29/08/2026).
--
-- Pedido do Raym: "faltou as peças para subsidiar a passagem pelo marco do
-- agravo interno ao levantamento/pagamento". A detecção por documento só
-- casava por regex de título (pop_marco_sinais tipo='documento'), e a maioria
-- dos marcos não tem sinal cadastrado — no board trabalhista, só 4 de 27 têm.
-- Peça anexada num marco sem sinal nunca viraria detecção: botão morto.
--
-- Canal explícito: jm_documentos.marco_chave. A conferência grava a chave do
-- marco (e a data informada pela pessoa) ao anexar; a view aceita esse vínculo
-- direto, sem regex e sem falso positivo. Desvincular (oculta_em) desfaz.
--
-- Rollback: as duas mudanças são reversíveis em <5min —
--   1) recriar a view com a definição anterior (ramo por_documento único, por
--      regex, sem filtro de marco_chave/oculta_em — está no histórico git);
--   2) ALTER TABLE public.jm_documentos DROP COLUMN marco_chave;
-- =============================================================================

alter table public.jm_documentos
  add column if not exists marco_chave text;

comment on column public.jm_documentos.marco_chave is
  'Vínculo explícito com pop_marcos.chave: peça anexada à mão na linha do marco '
  'para comprová-lo. Null = peça comum (casamento por título/data).';

create or replace view public.vw_pop_marcos_detectados as
with por_movimento as (
  select pm.board_id,
         pm.chave as marco_chave,
         pm.ordem,
         pm.rotulo,
         pm.stage_id,
         m.processo_cnj,
         min(m.data_hora)::date as data_detectada,
         count(*) as itens
    from pop_marcos pm
    join pop_marco_sinais s
      on s.pop_marco_id = pm.id and s.tipo = 'tpu'
    join jm_movimentos m
      on m.codigo = s.codigo
     and (s.grau is null or s.grau = m.grau)
     and (s.complemento_pattern is null
          or lower(coalesce(m.complementos::text, '')) like ('%' || s.complemento_pattern || '%'))
   group by pm.board_id, pm.chave, pm.ordem, pm.rotulo, pm.stage_id, m.processo_cnj
),
docs_casados as (
  -- Casamento por título (regex do sinal), como sempre foi. Peça com vínculo
  -- explícito fica fora deste ramo para não contar duas vezes.
  select pm.board_id, pm.chave, pm.ordem, pm.rotulo, pm.stage_id,
         d.processo_cnj, d.data_documento, d.id
    from pop_marcos pm
    join pop_marco_sinais s
      on s.pop_marco_id = pm.id and s.tipo = 'documento'
    join jm_documentos d
      on lower(coalesce(d.titulo, '')) ~ s.padrao
     and (s.padrao_excluir is null or lower(coalesce(d.titulo, '')) !~ s.padrao_excluir)
   where d.data_documento is not null
     and d.marco_chave is null
  union all
  -- Vínculo explícito (29/08/2026): peça anexada NA linha do marco, na
  -- conferência. Dispensa sinal cadastrado; desvincular (oculta_em) desfaz.
  select pm.board_id, pm.chave, pm.ordem, pm.rotulo, pm.stage_id,
         d.processo_cnj, d.data_documento, d.id
    from pop_marcos pm
    join jm_documentos d on d.marco_chave = pm.chave
   where d.data_documento is not null
     and d.oculta_em is null
),
por_documento as (
  select board_id,
         chave as marco_chave,
         ordem,
         rotulo,
         stage_id,
         processo_cnj,
         min(data_documento) as data_detectada,
         count(*) as itens,
         (array_agg(id order by data_documento))[1] as documento_id
    from docs_casados
   group by board_id, chave, ordem, rotulo, stage_id, processo_cnj
),
juntos as (
  select coalesce(dc.board_id, mv.board_id) as board_id,
         coalesce(dc.marco_chave, mv.marco_chave) as marco_chave,
         coalesce(dc.ordem, mv.ordem) as ordem,
         coalesce(dc.rotulo, mv.rotulo) as rotulo,
         coalesce(dc.stage_id, mv.stage_id) as stage_id,
         coalesce(dc.processo_cnj, mv.processo_cnj) as processo_cnj,
         mv.data_detectada as data_por_movimento,
         dc.data_detectada as data_por_documento,
         dc.documento_id,
         coalesce(dc.itens, 0::bigint) + coalesce(mv.itens, 0::bigint) as itens
    from por_movimento mv
    full join por_documento dc
      on dc.board_id = mv.board_id
     and dc.marco_chave = mv.marco_chave
     and dc.processo_cnj = mv.processo_cnj
)
select board_id,
       marco_chave,
       ordem,
       rotulo,
       stage_id,
       processo_cnj,
       data_por_movimento,
       data_por_documento,
       documento_id,
       itens,
       case
         when data_por_documento is not null and data_por_movimento is not null
              and abs(data_por_documento - data_por_movimento) <= 30 then data_por_documento
         when data_por_movimento is not null then data_por_movimento
         else data_por_documento
       end as data_detectada,
       case
         when data_por_documento is not null and data_por_movimento is not null
              and abs(data_por_documento - data_por_movimento) <= 30 then 'documento'::text
         when data_por_movimento is not null then 'movimento'::text
         else 'documento'::text
       end as fonte_deteccao,
       documento_id is not null as tem_prova_documental
  from juntos;
