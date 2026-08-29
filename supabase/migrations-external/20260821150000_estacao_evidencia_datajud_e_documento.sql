-- =============================================================================
-- A ESTAÇÃO PASSA A MOSTRAR A PROVA: código do DataJud + documento do processo
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- POR QUÊ (pedido do usuário em 21/08/2026, olhando a aba Marcos):
--   "todos os documentos que subsidiam os marcos têm que estar aqui, e também
--    detalhar o código do DataJud que justifica ele estar passando pelo marco".
--
-- Hoje a régua afirma "houve Sentença em 11/06/2026" e a única coisa que o
-- usuário pode conferir é o trecho de texto que o Escavador devolveu. O que
-- prova o marco — o movimento TPU do tribunal e a peça publicada — já está no
-- banco, em duas tabelas que a tela nunca leu:
--
--   jm_movimentos ... 41.434 movimentos do DataJud, 330 CNJs, com codigo (TPU),
--                     nome, grau, órgão julgador e complementos
--   jm_documentos ...  4.261 peças públicas do Escavador, 412 CNJs, das quais
--                      2.510 já baixadas no bucket privado jm-autos
--
-- COBERTURA MEDIDA (21/08/2026, sobre os 547 CNJs que têm marco):
--   com movimento do DataJud ... 156 (28%)
--   com documento baixado ...... 236 (43%)
-- Ou seja: a evidência NÃO existe para todo processo, e a tela precisa dizer
-- isso em vez de deixar a estação muda. Quem tem 100% de cobertura continua
-- sendo a publicação do Escavador que gerou o marco (process_movements).
--
-- COMO O DE-PARA É FEITO: estacao_sinais é o mesmo padrão de pop_marco_sinais,
-- só que chaveado pelas 12 estações de process_movements (que são as da tela)
-- em vez das chaves por board do POP. Os códigos vêm de jm_marco_config, já
-- calibrados; os padrões de título vêm dos sinais tipo='documento' do POP,
-- ampliados com os títulos mais frequentes medidos em jm_documentos
-- (despacho 1.464, decisão 558, ata da audiência 453, sentença 283, acórdão 196).
--
-- O QUE NÃO É FEITO AQUI, DE PROPÓSITO: o marco continua nascendo do parser do
-- Escavador. Estas views são LEITURA de prova, não um detector novo — não
-- mudam nenhuma data, nenhum marco_ordem, nenhuma fase. Se a prova diverge do
-- marco, quem olha vê a divergência, que é exatamente o ponto.
--
-- ATA DA AUDIÊNCIA em duas estações: o título não distingue conciliação de
-- instrução. O par (conciliação, instrução) aponta para o mesmo padrão e quem
-- desempata é a data — a tela só mostra o documento dentro da janela do marco.
--
-- REVERSÃO:
--   drop view public.vw_estacao_evidencia_documento;
--   drop view public.vw_estacao_evidencia_datajud;
--   drop table public.estacao_sinais;
--   drop policy jm_autos_leitura on storage.objects;
-- =============================================================================

create table if not exists public.estacao_sinais (
  id                  bigserial primary key,
  estacao             text not null,
  tipo                text not null check (tipo in ('tpu','documento')),
  codigo              integer,
  grau                text,
  complemento_pattern text,
  padrao              text,
  padrao_excluir      text,
  observacao          text,
  created_at          timestamptz not null default now(),
  constraint estacao_sinais_coerente check (
    (tipo = 'tpu'       and codigo is not null) or
    (tipo = 'documento' and padrao is not null and length(btrim(padrao)) > 0)
  ),
  constraint estacao_sinais_estacao_check check (estacao in (
    'peticao_inicial','audiencia_conciliacao','pericia','audiencia_instrucao',
    'sentenca_1grau','acordo','acordao_2grau','acordao_superior',
    'transito_julgado','cumprimento_sentenca','precatorio_rpv','pagamento'
  ))
);

comment on table public.estacao_sinais is
  'De-para entre as 12 estacoes de process_movements e a prova: codigo TPU do DataJud (tipo=tpu) e titulo da peca do Escavador (tipo=documento, regex sobre lower(jm_documentos.titulo)).';
comment on column public.estacao_sinais.padrao is
  'tipo=documento: REGEX POSIX aplicada em lower(jm_documentos.titulo).';
comment on column public.estacao_sinais.padrao_excluir is
  'Regex de exclusao. "sentenca" casa "sentenca de extincao da execucao", que e outra estacao.';

alter table public.estacao_sinais enable row level security;

drop policy if exists estacao_sinais_auth_select on public.estacao_sinais;
create policy estacao_sinais_auth_select on public.estacao_sinais
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Sinais TPU. Todos saem de jm_marco_config (coluna codigo/grau), traduzidos
-- do vocabulario de marco (AJUIZAMENTO, ACORDAO_PROVIMENTO...) para o das
-- estacoes da tela. Onde jm_marco_config nao tem codigo confiavel (pericia,
-- precatorio/RPV) a estacao fica so com prova documental — e melhor nao ter
-- codigo do que ter o codigo errado.
-- ---------------------------------------------------------------------------
insert into public.estacao_sinais (estacao, tipo, codigo, grau, observacao)
select v.estacao, 'tpu', v.codigo, v.grau, v.obs
from (values
  ('peticao_inicial',       26,    'G1',  'Distribuicao. So G1: em G2/SUP e remessa ao relator.'),
  ('audiencia_conciliacao', 970,   null,  'Audiencia'),
  ('audiencia_conciliacao', 12740, null,  'Audiencia de conciliacao'),
  ('audiencia_conciliacao', 12747, null,  'Audiencia inaugural trabalhista ("Inicial")'),
  ('audiencia_instrucao',   12743, null,  'Audiencia de instrucao'),
  ('audiencia_instrucao',   12749, null,  'Audiencia de instrucao'),
  ('audiencia_instrucao',   12750, null,  'Audiencia de instrucao'),
  ('audiencia_instrucao',   12751, null,  'Audiencia de instrucao'),
  ('sentenca_1grau',        219,   'G1',  'Procedencia'),
  ('sentenca_1grau',        220,   'G1',  'Improcedencia'),
  ('sentenca_1grau',        221,   'G1',  'Procedencia em parte'),
  ('acordo',                466,   null,  'Homologacao de acordo'),
  ('acordo',                14099, null,  'Acordo em execucao'),
  ('acordao_2grau',         219,   'G2',  'Procedencia em 2o grau'),
  ('acordao_2grau',         220,   'G2',  'Improcedencia em 2o grau'),
  ('acordao_2grau',         221,   'G2',  'Procedencia em parte em 2o grau'),
  ('acordao_2grau',         230,   'G2',  'Recurso prejudicado'),
  ('acordao_2grau',         235,   'G2',  'Nao conhecimento'),
  ('acordao_2grau',         236,   'G2',  'Nao conhecimento'),
  ('acordao_2grau',         237,   'G2',  'Provimento'),
  ('acordao_2grau',         238,   'G2',  'Provimento em parte'),
  ('acordao_2grau',         239,   'G2',  'Nao provimento'),
  ('acordao_superior',      235,   'SUP', 'Nao conhecimento no TST/STJ'),
  ('acordao_superior',      236,   'SUP', 'Nao conhecimento no TST/STJ'),
  ('acordao_superior',      237,   'SUP', 'Provimento no TST/STJ'),
  ('acordao_superior',      238,   'SUP', 'Provimento em parte no TST/STJ'),
  ('acordao_superior',      239,   'SUP', 'Nao provimento no TST/STJ'),
  ('acordao_superior',      432,   null,  'Recurso extraordinario (STF)'),
  ('transito_julgado',      848,   null,  'Transito em julgado'),
  ('cumprimento_sentenca',  11384, null,  'Liquidacao iniciada'),
  ('cumprimento_sentenca',  11385, null,  'Execucao iniciada'),
  ('pagamento',             60,    null,  'Alvara expedido'),
  ('pagamento',             277,   null,  'Satisfacao voluntaria da obrigacao'),
  ('pagamento',             196,   null,  'Extincao da execucao por satisfacao')
) as v(estacao, codigo, grau, obs)
where not exists (
  select 1 from public.estacao_sinais s
   where s.estacao = v.estacao and s.tipo = 'tpu'
     and s.codigo = v.codigo and s.grau is not distinct from v.grau
);

-- ---------------------------------------------------------------------------
-- Sinais de documento. Regex sobre o titulo da peca publica.
-- ---------------------------------------------------------------------------
insert into public.estacao_sinais (estacao, tipo, padrao, padrao_excluir, observacao)
select v.estacao, 'documento', v.padrao, v.excluir, v.obs
from (values
  ('peticao_inicial',       'peti[çc][ãa]o inicial|reclama[çc][ãa]o trabalhista', null,
   'Raro no acervo publico, mas quando existe e a prova exata do ajuizamento.'),
  ('audiencia_conciliacao', 'ata d[ae] audi[êe]ncia|termo de audi[êe]ncia', null,
   'O titulo nao distingue conciliacao de instrucao — quem desempata e a data do marco.'),
  ('audiencia_instrucao',   'ata d[ae] audi[êe]ncia|termo de audi[êe]ncia', null,
   'Mesmo padrao da conciliacao; a janela de data separa as duas.'),
  ('pericia',               'laudo pericial|laudo d[ae] per[íi]cia|per[íi]cia m[ée]dica', null,
   'Unico detector de pericia que existe: nao ha codigo TPU confiavel.'),
  ('sentenca_1grau',        'senten[çc]a', 'embargos|extin[çc]|execu|homolog',
   'Herdado de pop_marco_sinais: "sentenca de extincao da execucao" e outra estacao.'),
  ('acordo',                'acordo|homologa[çc][ãa]o|termo de concilia', null, null),
  ('acordao_2grau',         'ac[óo]rd[ãa]o|ementa', 'recurso de revista|tst',
   'Acordao do TRT. O do TST cai em acordao_superior pelo proprio titulo.'),
  ('acordao_superior',      'recurso de revista|recursos tst|ac[óo]rd[ãa]o.*tst|agravo em recurso especial', null, null),
  ('transito_julgado',      'certid[ãa]o de tr[âa]nsito|tr[âa]nsito em julgado', null, null),
  ('cumprimento_sentenca',  'cumprimento de senten|liquida[çc][ãa]o|c[áa]lculo|penhora|idpj|desconsider', null, null),
  ('precatorio_rpv',        'precat[óo]rio|requisi[çc][ãa]o de pequeno valor|\yrpv\y', null,
   'Sem codigo TPU na config: a peca e a unica prova desta estacao.'),
  ('pagamento',             'alvar[áa]|comprovante de (transfer|pagamento|dep[óo]sito)|guia de dep[óo]sito|extin[çc][ãa]o da execu', 'pedido de alvar',
   'Exclui "pedido de alvara": pedir nao e receber.')
) as v(estacao, padrao, excluir, obs)
where not exists (
  select 1 from public.estacao_sinais s
   where s.estacao = v.estacao and s.tipo = 'documento' and s.padrao = v.padrao
);

-- ---------------------------------------------------------------------------
-- As duas leituras de prova. security_invoker: a RLS das tabelas base (select
-- liberado para authenticated em jm_movimentos e jm_documentos) continua valendo.
-- ---------------------------------------------------------------------------
create or replace view public.vw_estacao_evidencia_datajud
with (security_invoker = on) as
select
  regexp_replace(m.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
  s.estacao,
  m.id            as movimento_id,
  m.codigo,
  m.nome,
  m.grau,
  m.orgao_julgador,
  m.tribunal_alias,
  m.data_hora,
  m.complementos,
  s.observacao    as codigo_significado
from public.estacao_sinais s
join public.jm_movimentos m
  on m.codigo = s.codigo
 and (s.grau is null or s.grau = m.grau)
 and (s.complemento_pattern is null
      or lower(coalesce(m.complementos::text, '')) like '%' || s.complemento_pattern || '%')
where s.tipo = 'tpu';

comment on view public.vw_estacao_evidencia_datajud is
  'Movimento do DataJud que justifica cada estacao da regua, com o codigo TPU a vista. Leitura de prova: nao cria nem move marco.';

create or replace view public.vw_estacao_evidencia_documento
with (security_invoker = on) as
select distinct on (d.id, s.estacao)
  regexp_replace(d.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
  s.estacao,
  d.id            as documento_id,
  d.titulo,
  d.tipo          as sigilo,
  d.data_documento,
  d.origem,
  d.storage_path,
  d.link_api,
  d.stored_at
from public.estacao_sinais s
join public.jm_documentos d
  on lower(coalesce(d.titulo, '')) ~ s.padrao
 and (s.padrao_excluir is null or lower(coalesce(d.titulo, '')) !~ s.padrao_excluir)
where s.tipo = 'documento'
  and d.data_documento is not null;

comment on view public.vw_estacao_evidencia_documento is
  'Peca publica cujo titulo casa com a estacao. A janela de data (aplicada na tela) e que decide se a peca prova AQUELE marco.';

grant select on public.estacao_sinais                 to authenticated;
grant select on public.vw_estacao_evidencia_datajud   to authenticated;
grant select on public.vw_estacao_evidencia_documento to authenticated;

-- ---------------------------------------------------------------------------
-- Sem esta policy o bucket jm-autos e invisivel para o app: createSignedUrl
-- exige select em storage.objects. Mesmo desenho do bucket inss-protocolos,
-- que tambem e privado e guarda documento de processo.
--
-- REVOGADA NO MESMO DIA por 20260821183000: a sessao do app no Externo e
-- anonima e a chave esta no bundle, entao "authenticated" aqui e qualquer um.
-- Com peca RESTRITA entrando pelo certificado, quem assina passou a ser a edge
-- function jm-doc-url, que exige o login do cloud. Mantida aqui como historico.
-- ---------------------------------------------------------------------------
drop policy if exists jm_autos_leitura on storage.objects;
create policy jm_autos_leitura on storage.objects
  for select to authenticated using (bucket_id = 'jm-autos');
