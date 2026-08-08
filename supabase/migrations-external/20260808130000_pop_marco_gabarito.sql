-- =============================================================================
-- GABARITO DE CALIBRAGEM — a verdade contra a qual a régua é medida.
--
-- POR QUE: até aqui a única forma de saber se um marco estava certo era olhar
-- processo a processo. Sem verdade conhecida, "melhorar o prompt" é chute com
-- convicção — e a régua já mostrou que erra de um jeito que ninguém percebe:
-- na primeira medição, audiência estava sendo marcada pela data em que foi
-- DESIGNADA (e audiência CANCELADA contava como marco atingido), o que dava
-- 7 dias entre ajuizamento e audiência. Nenhuma revisão de prompt acharia isso;
-- o número absurdo denunciou.
--
-- A FONTE DA VERDADE É INDEPENDENTE DA RÉGUA — este é o ponto todo.
-- O gabarito vem de jm_decisoes (439 decisões catalogadas à mão pela equipe) e
-- jm_acordos (termo de audiência, digitado do PJe). A régua vem de jm_movimentos
-- (código TPU do DataJud). São dois caminhos que nunca se tocam: se concordam,
-- a concordância significa alguma coisa. Medir a régua contra ela mesma seria
-- circular.
--
-- LINHA DE BASE MEDIDA EM 08/08/2026 (tolerância de data = 7 dias):
--
--   marco                 no gabarito   acerto 7d   15d   30d   acha (s/ data)
--   sentença                     109         80%    80%   80%       83%
--   embargos de declaração        75         76%    76%   77%       89%
--   acórdão 2º grau               70         71%    80%   83%       89%
--   acordo homologado             42         57%    71%   76%       88%
--   decisão TST/STJ               33         67%    76%   79%       85%
--
-- O QUE A SENSIBILIDADE À TOLERÂNCIA ENSINA: em sentença a data é exata ou o
-- marco não existe (80% em qualquer tolerância). Em acordo e acórdão, afrouxar
-- de 7 para 30 dias ganha ~20 pontos — porque a homologação e a publicação
-- demoram a ser registradas no sistema do tribunal. Tolerância deveria ser POR
-- MARCO, não global. Pendente de decisão do usuário.
--
-- "sem_gabarito" NÃO É ERRO DA RÉGUA. Conferido em 08/08/2026 nos 28 casos de
-- acórdão detectado sem gabarito correspondente: TODOS os 28 tinham remessa ou
-- distribuição ao 2º grau anterior à data do julgamento. São acórdãos reais que
-- o catálogo manual não registrou — a régua está achando decisão que a equipe
-- perdeu, não inventando decisão.
--
-- COMO USAR: qualquer mexida em pop_marco_sinais roda
--   select * from vw_pop_marco_calibragem
-- antes de valer. Se o acerto cair, a mudança piorou — reverte.
--
-- REVERSÃO: drop view vw_pop_marco_calibragem, vw_pop_marcos_detectados;
--           drop table pop_marco_gabarito;
-- =============================================================================

create table if not exists public.pop_marco_gabarito (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references public.kanban_boards(id) on delete cascade,
  processo_cnj  text not null,
  marco_chave   text not null,
  data_esperada date not null,
  fonte         text not null check (fonte in ('jm_decisoes','jm_acordos','manual')),
  fonte_ref     text,
  confianca     text not null default 'alta' check (confianca in ('alta','media','baixa')),
  observacao    text,
  created_at    timestamptz not null default now(),
  constraint pop_marco_gabarito_unico unique (board_id, processo_cnj, marco_chave)
);

create index if not exists idx_pop_marco_gabarito_cnj on public.pop_marco_gabarito (processo_cnj);

alter table public.pop_marco_gabarito enable row level security;
drop policy if exists pop_marco_gabarito_all on public.pop_marco_gabarito;
create policy pop_marco_gabarito_all on public.pop_marco_gabarito
  for all to authenticated using (true) with check (true);

-- O que a régua detecta hoje, aplicada aos movimentos.
create or replace view public.vw_pop_marcos_detectados as
select pm.board_id, pm.chave as marco_chave, pm.ordem, pm.rotulo,
       m.processo_cnj, min(m.data_hora)::date as data_detectada,
       count(*) as movimentos
from public.pop_marcos pm
join public.pop_marco_sinais s on s.pop_marco_id = pm.id and s.tipo = 'tpu'
join public.jm_movimentos m
  on m.codigo = s.codigo
 and (s.grau is null or s.grau = m.grau)
 and (s.complemento_pattern is null
      or lower(coalesce(m.complementos::text,'')) like '%' || s.complemento_pattern || '%')
group by pm.board_id, pm.chave, pm.ordem, pm.rotulo, m.processo_cnj;

-- Gabarito x régua, linha a linha.
create or replace view public.vw_pop_marco_calibragem as
select
  coalesce(g.board_id, d.board_id)         as board_id,
  coalesce(g.processo_cnj, d.processo_cnj) as processo_cnj,
  coalesce(g.marco_chave, d.marco_chave)   as marco_chave,
  g.data_esperada,
  d.data_detectada,
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

-- ---------------------------------------------------------------------------
-- Carga do gabarito a partir das duas fontes curadas.
-- Acórdão com instancia 'A REVISAR' ENTRA com confianca='media' em vez de ficar
-- de fora: excluí-lo na primeira rodada criou 4 "falsos positivos" que eram na
-- verdade acerto da régua escondido pelo meu próprio filtro.
-- ---------------------------------------------------------------------------
insert into public.pop_marco_gabarito (board_id, processo_cnj, marco_chave, data_esperada, fonte, fonte_ref, confianca, observacao)
select 'b436c043-3ddb-4900-8800-dc4063624816'::uuid, x.processo_cnj, x.marco_chave, x.data_esperada,
       'jm_decisoes', x.ref, x.confianca, x.obs
from (
  select processo_cnj,
    case
      when tipo_evento='SENTENÇA' and instancia='1º GRAU'                     then 'sentenca'
      when tipo_evento='HOMOLOGAÇÃO DE ACORDO'                                then 'acordo_homologado'
      when tipo_evento='ACÓRDÃO' and instancia in ('2º GRAU','A REVISAR')      then 'acordao_2grau'
      when tipo_evento in ('ACÓRDÃO','DECISÃO') and instancia in ('TST','STJ') then 'decisao_superior'
      when tipo_evento='DECISÃO' and instancia='STF'                          then 'recurso_extraordinario'
      when tipo_evento='EMBARGOS DE DECLARAÇÃO'                               then 'embargos_declaracao'
    end as marco_chave,
    -- Primeira data: no catálogo, acordo parcelado aparece uma vez por parcela
    -- (um processo tinha 6 linhas de "HOMOLOGAÇÃO DE ACORDO" com datas mensais).
    -- Para o marco vale a primeira; as parcelas são assunto do eixo financeiro.
    min(data_decisao) as data_esperada,
    min(dec_id) as ref,
    case when bool_or(instancia='A REVISAR') then 'media' else 'alta' end as confianca,
    case when bool_or(instancia='A REVISAR')
         then 'instancia marcada A REVISAR no catalogo — grau presumido' end as obs
  from jm_decisoes
  group by 1,2
) x
where x.marco_chave is not null
on conflict (board_id, processo_cnj, marco_chave) do nothing;

insert into public.pop_marco_gabarito (board_id, processo_cnj, marco_chave, data_esperada, fonte, fonte_ref, confianca, observacao)
select 'b436c043-3ddb-4900-8800-dc4063624816'::uuid, a.processo_cnj, 'acordo_homologado', a.data_homologacao,
       'jm_acordos', a.id::text, 'alta', 'termo de audiencia: ' || coalesce(a.fonte_doc,'')
from jm_acordos a
where a.data_homologacao is not null
on conflict (board_id, processo_cnj, marco_chave) do nothing;

comment on table public.pop_marco_gabarito is
  'Verdade curada por processo x marco, independente da regua automatica. Base de calibragem e teste de regressao: qualquer mexida em pop_marco_sinais roda contra isto antes de valer.';
