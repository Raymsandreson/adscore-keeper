-- =============================================================================
-- MARCO = DOCUMENTO + MARCO = FASE DO POP
--
-- Duas ideias do usuário (08/08/2026), aplicadas juntas porque se sustentam:
--
--   1. "todo marco tem um documento que representa a entrada nele"
--   2. "a fase deveria ser representada por cada marco — um diz o estado do
--       processo de forma automática via API, o outro o passo a passo que a
--       equipe tem que seguir para chegar em cada marco/fase"
--
-- O achado que motivou a #2: 1.753 processos têm POP e ZERO têm
-- workflow_stage_id preenchido. As fases existem, os passos existem, e nenhum
-- processo está posicionado em fase nenhuma — ninguém move na mão. Ligar a fase
-- ao marco resolve isso sem trabalho manual: o marco vem da API, a fase avança
-- sozinha, e a equipe passa a ver os objetivos e passos da fase certa.
--
-- -----------------------------------------------------------------------------
-- PRECEDÊNCIA ENTRE MOVIMENTO E DOCUMENTO — medida, não arbitrada
-- -----------------------------------------------------------------------------
-- Quando o documento existe, a data dele bate EXATO com o gabarito (acórdão
-- 13/13, sentença 9/9 com diferença zero). Isso sugeria "documento sempre vence".
-- Medido, essa regra melhorou o acórdão (71% -> 76%) e PIOROU a sentença
-- (80% -> 69%).
--
-- Motivo: o acervo baixado é incompleto. Quando a sentença original não foi
-- baixada, o único documento "sentença" do processo é uma sentença POSTERIOR —
-- num caso, o gabarito diz 02/2024 e o documento é de 02/2026. Documento errado
-- vencendo movimento certo empurra o marco dois anos para a frente.
--
-- Regra final: o documento REFINA, não substitui.
--   ambos e próximos (<= 30d) -> data do documento (mais precisa)
--   ambos e distantes         -> data do movimento (o documento é outro ato)
--   só um                     -> o que existir
-- Resultado: sentença 79% com as divergências caindo de 16 para 5, acórdão 76%.
-- E 129 marcos passam a ter prova documental consultável mesmo quando não é o
-- documento que define a data.
--
-- GANHO LATERAL: perícia e trânsito em julgado não tinham NENHUM detector — não
-- há código TPU confiável para eles. "laudo pericial" e "certidão de trânsito em
-- julgado" são títulos de documento inequívocos e passam a marcá-los.
--
-- REVERSÃO: as views voltam à versão anterior; delete from pop_marco_sinais
-- where tipo = 'documento'.
-- =============================================================================

alter table public.pop_marco_sinais drop constraint if exists pop_marco_sinais_tipo_check;
alter table public.pop_marco_sinais drop constraint if exists pop_marco_sinais_coerente;
alter table public.pop_marco_sinais add column if not exists padrao_excluir text;

alter table public.pop_marco_sinais
  add constraint pop_marco_sinais_tipo_check check (tipo in ('tpu','texto','documento'));
alter table public.pop_marco_sinais
  add constraint pop_marco_sinais_coerente check (
    (tipo = 'tpu' and codigo is not null) or
    (tipo in ('texto','documento') and padrao is not null and length(btrim(padrao)) > 0)
  );

comment on column public.pop_marco_sinais.padrao is
  'tipo=texto: trecho a casar. tipo=documento: REGEX case-insensitive sobre jm_documentos.titulo.';
comment on column public.pop_marco_sinais.padrao_excluir is
  'Regex de exclusao. "sentenca" casa "sentenca de extincao da execucao", que e outro marco.';

drop view if exists public.vw_pop_processo_fase;
drop view if exists public.vw_pop_marco_calibragem;
drop view if exists public.vw_pop_marcos_detectados;

create view public.vw_pop_marcos_detectados as
with por_movimento as (
  select pm.board_id, pm.chave as marco_chave, pm.ordem, pm.rotulo, pm.stage_id,
         m.processo_cnj, min(m.data_hora)::date as data_detectada, count(*)::bigint as itens
  from public.pop_marcos pm
  join public.pop_marco_sinais s on s.pop_marco_id = pm.id and s.tipo = 'tpu'
  join public.jm_movimentos m
    on m.codigo = s.codigo
   and (s.grau is null or s.grau = m.grau)
   and (s.complemento_pattern is null
        or lower(coalesce(m.complementos::text,'')) like '%' || s.complemento_pattern || '%')
  group by 1,2,3,4,5,6
),
por_documento as (
  select pm.board_id, pm.chave as marco_chave, pm.ordem, pm.rotulo, pm.stage_id,
         d.processo_cnj, min(d.data_documento)::date as data_detectada, count(*)::bigint as itens,
         (array_agg(d.id order by d.data_documento))[1] as documento_id
  from public.pop_marcos pm
  join public.pop_marco_sinais s on s.pop_marco_id = pm.id and s.tipo = 'documento'
  join public.jm_documentos d
    on lower(coalesce(d.titulo,'')) ~ s.padrao
   and (s.padrao_excluir is null or lower(coalesce(d.titulo,'')) !~ s.padrao_excluir)
  where d.data_documento is not null
  group by 1,2,3,4,5,6
),
juntos as (
  select
    coalesce(dc.board_id, mv.board_id)         as board_id,
    coalesce(dc.marco_chave, mv.marco_chave)   as marco_chave,
    coalesce(dc.ordem, mv.ordem)               as ordem,
    coalesce(dc.rotulo, mv.rotulo)             as rotulo,
    coalesce(dc.stage_id, mv.stage_id)         as stage_id,
    coalesce(dc.processo_cnj, mv.processo_cnj) as processo_cnj,
    mv.data_detectada as data_por_movimento,
    dc.data_detectada as data_por_documento,
    dc.documento_id,
    coalesce(dc.itens,0) + coalesce(mv.itens,0) as itens
  from por_movimento mv
  full outer join por_documento dc
    on  dc.board_id     = mv.board_id
    and dc.marco_chave  = mv.marco_chave
    and dc.processo_cnj = mv.processo_cnj
)
select j.*,
  case
    when j.data_por_documento is not null and j.data_por_movimento is not null
     and abs(j.data_por_documento - j.data_por_movimento) <= 30 then j.data_por_documento
    when j.data_por_movimento is not null                       then j.data_por_movimento
    else j.data_por_documento
  end as data_detectada,
  case
    when j.data_por_documento is not null and j.data_por_movimento is not null
     and abs(j.data_por_documento - j.data_por_movimento) <= 30 then 'documento'
    when j.data_por_movimento is not null                       then 'movimento'
    else 'documento'
  end as fonte_deteccao,
  (j.documento_id is not null) as tem_prova_documental
from juntos j;

create view public.vw_pop_marco_calibragem as
select
  coalesce(g.board_id, d.board_id)         as board_id,
  coalesce(g.processo_cnj, d.processo_cnj) as processo_cnj,
  coalesce(g.marco_chave, d.marco_chave)   as marco_chave,
  g.data_esperada, d.data_detectada, d.fonte_deteccao, d.tem_prova_documental,
  (d.data_detectada - g.data_esperada)     as dif_dias,
  g.fonte, g.confianca,
  case
    when g.data_esperada is null                      then 'sem_gabarito'
    when d.data_detectada is null                     then 'perdeu'
    when abs(d.data_detectada - g.data_esperada) <= 7 then 'ok'
    else 'data_diverge'
  end as veredicto
from public.pop_marco_gabarito g
full outer join public.vw_pop_marcos_detectados d
  on  d.board_id     = g.board_id
  and d.processo_cnj = g.processo_cnj
  and d.marco_chave  = g.marco_chave;

-- A ponte entre o automático e o manual: o marco de maior ordem já atingido diz
-- em que fase do POP o processo está. SUGERE — não escreve em lead_processes.
-- Promover a sugestão a fase real é passo separado, com o jurídico junto.
create view public.vw_pop_processo_fase as
with normal as (
  select id, lead_id, process_number, workflow_id, workflow_stage_id,
         regexp_replace(coalesce(process_number,''), '[^0-9]', '', 'g') as cnj_num
  from public.lead_processes
  where deleted_at is null and process_number is not null
),
det as (
  select d.*, regexp_replace(d.processo_cnj, '[^0-9]', '', 'g') as cnj_num
  from public.vw_pop_marcos_detectados d
),
topo as (
  select distinct on (n.id)
         n.id as process_id, n.lead_id, n.process_number, n.workflow_stage_id as stage_atual,
         d.marco_chave, d.rotulo as marco_rotulo, d.ordem, d.stage_id as stage_do_marco,
         d.data_detectada, d.fonte_deteccao, d.tem_prova_documental
  from normal n
  join det d on d.cnj_num = n.cnj_num and length(n.cnj_num) >= 15
  order by n.id, d.ordem desc, d.data_detectada desc
)
select t.*, (t.stage_do_marco is distinct from t.stage_atual) as fase_desatualizada
from topo t;

comment on view public.vw_pop_processo_fase is
  'Fase do POP sugerida pelo marco de maior ordem ja detectado. Sugere, nao escreve em lead_processes.';

-- Sinais documentais. Conservadores de propósito: só títulos inequívocos.
-- "ata da audiência" (362 documentos em 79 processos) NÃO entra como acordo —
-- a ata é onde o acordo PODE estar, não prova que houve. Isso é trabalho para a
-- IA ler o conteúdo, não para casar título.
with s(chave, padrao, excluir, motivo) as (values
 ('pericia','laudo pericial',null,
  'pericia nao tem codigo TPU confiavel; o laudo e a unica prova documental dela'),
 ('transito_julgado','certid[ãa]o de tr[âa]nsito',null,
  'certidao de transito e inequivoca'),
 ('sentenca','senten[çc]a','embargos|extin|execu|homolog',
  'exclui sentenca de embargos e de extincao da execucao, que sao outros marcos'),
 ('acordao_2grau','ac[óo]rd[ãa]o',null,
  'em teste: o titulo do documento nao diz o grau, pode casar acordao do TST')
)
insert into public.pop_marco_sinais (pop_marco_id, tipo, padrao, padrao_excluir, origem, confirmado, motivo)
select pm.id, 'documento', s.padrao, s.excluir, 'manual', false, s.motivo
from s join public.pop_marcos pm
  on pm.chave = s.chave and pm.board_id = 'b436c043-3ddb-4900-8800-dc4063624816'::uuid
on conflict do nothing;
