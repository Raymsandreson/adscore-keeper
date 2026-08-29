-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- APLICADA em 24/08/2026.
-- ============================================================================
-- A fila de leitura foi escrita quando so existia peca PUBLICA, e a regua de
-- prioridade dela reflete isso: alvara/comprovante, decisao, ata, despacho, e
-- todo o resto empilhado em `prioridade 9`.
--
-- Em 24/08 o certificado passou a funcionar e o primeiro processo com autos
-- completos (0011351-63.2022.5.15.0031) trouxe 140 pecas, 118 RESTRITAS. Isso
-- muda a economia da fila: em modo publico sao ~11 pecas por processo, com
-- autos passam de 100. Ler tudo e caro em IA e nao paga.
--
-- MEDIDO no acervo atual (541 pecas restritas, 3 processos):
--
--   faixa                       docs   restritos
--   planilha de calculo           12          12   <- valor que o juizo aceitou
--   alvara/comprovante/guia       56          11
--   decisao/sentenca/acordao    1322           8
--   peticao inicial               15           5
--   transito em julgado            9           2
--   RUIDO PROCESSUAL             298         228   <- 42% do restrito
--   resto (prio 9)              2874         274
--
-- Ou seja: quase metade da peca restrita e intimacao, manifestacao,
-- substabelecimento, procuracao, carta de preposicao. Nenhuma delas move um
-- numero da carteira, e cada uma custa uma chamada de IA.
--
-- DUAS MUDANCAS
--
-- 1. `Planilha de Calculos` e `Planilha de Atualizacao de Calculos` sobem para
--    prioridade 1. Elas trazem o valor ATUALIZADO que o juizo aceitou, com
--    data — hoje a carteira estima a correcao aplicando indice sobre o nominal,
--    e a planilha e o numero real. Peticao inicial e certidao de transito
--    ganham faixa propria pelo mesmo motivo: pedido/base e marco com data certa.
--
-- 2. O ruido processual sai da fila. NAO e exclusao do acervo: a peca continua
--    em `jm_documentos`, arquivada no bucket, e abre normalmente pelo botao
--    "ver a peca" da conferencia. Ela so deixa de ser candidata a leitura
--    automatica.
--
-- O QUE NAO ENTROU NA EXCLUSAO, DE PROPOSITO
--
--   `Documento Diverso` — 31 ocorrencias so no caso 88, e e onde o termo de
--   acordo costuma se esconder (o do caso 88 tem 6 paginas e foi juntado dois
--   dias antes da homologacao). Fica em prioridade 9: nao e prioritario, mas
--   nao se joga fora o unico lugar onde mora o cronograma das parcelas.
--
-- REVERSAO (a view anterior nao tinha as faixas 1/4/5 nem a exclusao de ruido;
-- refazer com o texto do dump anterior, ou simplesmente:)
--   -- basta recriar removendo o termo `and u.titulo !~* '<RUIDO>'` e voltando
--   -- o CASE para as 4 faixas originais. Nenhum dado e tocado.
-- ============================================================================

create or replace view public.vw_jm_fila_leitura as
 with alvo as (
   select distinct p.cnj_num, p.processo_cnj,
          sum(p.valor_previsto) over (partition by p.cnj_num) as valor_em_jogo
     from vw_jm_parcela_leitura p
    where p.leitura = 'PRECISA_LER'
 ), unico as (
   select distinct on (d.processo_cnj, d.titulo, d.data_documento)
          d.id as documento_id, d.processo_cnj, d.titulo, d.data_documento, d.storage_path
     from jm_documentos d
     join alvo a on regexp_replace(d.processo_cnj, '\D', '', 'g') = a.cnj_num
    order by d.processo_cnj, d.titulo, d.data_documento, (d.storage_path is null), d.id
 )
 select u.documento_id, u.processo_cnj, u.titulo, u.data_documento, u.storage_path,
   case
     -- O valor que o juizo aceitou vem antes de tudo: e ele que corrige a carteira.
     when u.titulo ~* 'planilha'                        then 1
     when u.titulo ~* 'alvar|comprovante|guia|deposit'  then 2
     when u.titulo ~* 'decis|senten|acórd|acord'        then 3
     when u.titulo ~* 'peti(ç|c)(ã|a)o inicial'         then 4
     when u.titulo ~* 'tr(â|a)nsito em julgado'         then 5
     when u.titulo ~* 'ata da audi'                     then 6
     when u.titulo ~* 'despacho'                        then 7
     else 9
   end as prioridade,
   l.documento_id is not null as ja_lido
  from unico u
  left join jm_documento_leitura l on l.documento_id = u.documento_id
 where u.storage_path is not null
   and u.titulo !~* 'public|inserido na (extra)?pauta|certid.*publica'
   -- Ruido processual: nao move numero e custa chamada de IA. A peca continua
   -- no acervo e abre pelo botao "ver a peca" — so nao entra em leitura.
   and u.titulo !~* 'intima(ç|c)|manifesta(ç|c)|substabelec|procura(ç|c)|preposi(ç|c)|documento de identifica|jurisprud|estatuto|contrato de trabalho|notifica(ç|c)|mandado|habilita(ç|c)|raz(õ|o)es finais|contesta(ç|c)';
