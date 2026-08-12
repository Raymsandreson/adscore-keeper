-- =============================================================================
-- MARCO PELA MOVIMENTAÇÃO DO ESCAVADOR + MARCO DE SUBIDA DE INSTÂNCIA
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- O QUE MOTIVOU (12/08/2026, Raym): processo 0016855-58.2023.5.16.0008 está no
-- TST desde 14/05/2026 e a ficha mostrava "Fase Recursal (2ª instância)" sem
-- nada preenchido. Dois buracos, medidos nesta data:
--
--   1. COBERTURA. A régua só lia DataJud (jm_movimentos) e documento
--      (jm_documentos):
--        672 processos com CNJ → 199 com DataJud, 473 sem.
--        Dos 473 sem DataJud, 411 TÊM movimentação do Escavador.
--      Ou seja: 411 processos invisíveis para a régua por falta de leitor, não
--      por falta de dado. E o DataJud é o mais atrasado das três fontes
--      (movimento mais novo em 03/08 contra 12/08 do e-mail push).
--
--   2. SUBIDA DE INSTÂNCIA NÃO ERA MARCO. A régua tinha "Acórdão (2º grau)" e
--      "Decisão TST/STJ" — os dois são o JULGAMENTO. Processo que subiu e está
--      esperando ficava carimbado na instância de baixo. São 76 CNJs com
--      movimentação de grau SUP e 144 com G2 no DataJud (51 e 92 no Escavador):
--      é onde mora boa parte da carteira recursal.
--
-- COMO O ESCAVADOR ENTRA. As 7.284 movimentações têm código TPU em 0% dos casos
-- e `classificacao_predita.nome` em 100%. Não dá para casar por código; dá para
-- casar pela taxonomia + texto — que é exatamente o tipo 'texto' de
-- pop_marco_sinais, criado em 08/08 e até hoje vazio. O grau vem de
-- `fonte.grau` (1/2/3), que é dado estrutural, não texto: vira o tipo novo
-- 'grau'.
--
-- LIMITE CONHECIDO, PARA NÃO PROMETER DEMAIS: lead_processes.movimentacoes
-- guarda no máximo 20 movimentações por processo (367 processos estão exatos em
-- 20). É janela do recente, não histórico. Serve para dizer ONDE O PROCESSO
-- ESTÁ; não serve para reconstruir a régua inteira de um processo antigo. É por
-- isso que a régua da ficha presume cumpridos os marcos obrigatórios anteriores
-- ao marco atual (ver a migration seguinte) em vez de exigir detecção de cada
-- um.
--
-- O QUE ESTA MIGRATION NÃO TOCA (de propósito):
--   - vw_pop_marcos_detectados (v1) segue idêntica. Ela alimenta
--     vw_pop_carteira_por_fase, que é número de fundo — e a carteira lê o board
--     RASCUNHO ('Trabalhistas judicial — marcos (rascunho)'), não o POP em uso.
--     Sinal novo entra só no POP em uso e só nas views novas.
--   - nenhum passo de checklist, nenhuma instância, nenhum lead.
--
-- CALIBRAGEM DOS PADRÕES (rodada nesta data contra as 7.284 movimentações,
-- processos distintos que cada padrão alcança):
--   ajuizamento 329 · sentença 33 · embargos 29 · audiência realizada 25
--   perícia 20 · execução 19 · acordo 11 · trânsito 9 · alvará 8
--   acórdão 8 · arquivamento 4
-- Padrão que não casou nada não foi inventado aqui.
--
-- REVERSÃO:
--   drop view if exists public.vw_pop_marcos_regua;
--   drop view if exists public.vw_pop_marcos_escavador;
--   delete from public.pop_marco_sinais where tipo in ('grau','texto');
--   delete from public.pop_marcos
--    where board_id = 'b436c043-3ddb-4900-8800-dc4063624816'
--      and chave in ('remessa_2grau','remessa_superior');
--   -- e devolver as ordens: -1 em ordem >= 13, depois -1 em ordem >= 9.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tipo de sinal novo: 'grau'
--
-- Não é texto nem código: é a instância em que a movimentação nasceu. Um único
-- sinal ('SUP') marca a subida ao TST em qualquer processo, sem depender de o
-- tribunal ter usado a palavra "remessa" ou o código 123.
-- ---------------------------------------------------------------------------
alter table public.pop_marco_sinais drop constraint if exists pop_marco_sinais_tipo_check;
alter table public.pop_marco_sinais drop constraint if exists pop_marco_sinais_coerente;

alter table public.pop_marco_sinais
  add constraint pop_marco_sinais_tipo_check check (tipo in ('tpu','texto','documento','grau'));

alter table public.pop_marco_sinais
  add constraint pop_marco_sinais_coerente check (
    (tipo = 'tpu'  and codigo is not null) or
    (tipo = 'grau' and grau   is not null) or
    (tipo in ('texto','documento') and padrao is not null and length(btrim(padrao)) > 0)
  );

comment on column public.pop_marco_sinais.grau is
  'tipo=tpu: filtra o grau do movimento. tipo=grau: o proprio sinal — processo com movimentacao neste grau atingiu o marco.';

-- ---------------------------------------------------------------------------
-- 2. Dois marcos novos no POP em uso: a subida, não o julgamento
--
-- Abrem espaço na régua em 8 (antes do acórdão) e em 12 (antes da decisão
-- superior). O shift usa faixa temporária alta porque a unique de ordem é
-- deferrable mas o UPDATE em bloco colidiria dentro do mesmo comando.
-- ---------------------------------------------------------------------------
do $$
declare v_board uuid := 'b436c043-3ddb-4900-8800-dc4063624816';
begin
  -- nada a fazer se já rodou
  if exists (select 1 from public.pop_marcos where board_id = v_board and chave = 'remessa_2grau') then
    return;
  end if;

  -- abre a vaga da ordem 8 (acórdão 2º grau em diante andam +1)
  update public.pop_marcos set ordem = ordem + 100 where board_id = v_board and ordem >= 8;
  update public.pop_marcos set ordem = ordem - 99  where board_id = v_board and ordem >= 100;

  insert into public.pop_marcos
    (board_id, chave, rotulo, ordem, stage_id, terminal, eventual, atravessa_fases, descricao)
  values
    (v_board, 'remessa_2grau', 'Subida ao 2º grau', 8,
     'recurso_segunda_instancia_auto_gen', false, true, false,
     'Processo remetido ao TRT. Marca a ENTRADA na fase recursal — o acordao e o julgamento, que vem depois.');

  -- abre a vaga da ordem 12 (decisão superior em diante andam +1)
  update public.pop_marcos set ordem = ordem + 100 where board_id = v_board and ordem >= 12;
  update public.pop_marcos set ordem = ordem - 99  where board_id = v_board and ordem >= 100;

  insert into public.pop_marcos
    (board_id, chave, rotulo, ordem, stage_id, terminal, eventual, atravessa_fases, descricao)
  values
    (v_board, 'remessa_superior', 'Subida ao TST / STJ', 12,
     'recurso_instancia_superior_auto_gen', false, true, false,
     'Processo autuado em tribunal superior. E a chegada, nao a decisao.');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Sinais de grau
--
-- G2/SUP no DataJud (jm_movimentos.grau) e fonte.grau 2/3 no Escavador.
-- Deliberadamente sem G1: primeiro grau não é marco, é o ponto de partida.
-- ---------------------------------------------------------------------------
insert into public.pop_marco_sinais (pop_marco_id, tipo, grau, origem, confirmado, motivo)
select pm.id, 'grau', v.grau, 'manual', true, v.motivo
from (values
  ('remessa_2grau',    'G2',  'movimentacao em 2o grau prova que o processo subiu, independente do texto'),
  ('remessa_superior', 'SUP', 'movimentacao em tribunal superior prova a subida; 76 CNJs no DataJud e 51 no Escavador')
) as v(chave, grau, motivo)
join public.pop_marcos pm
  on pm.chave = v.chave and pm.board_id = 'b436c043-3ddb-4900-8800-dc4063624816'::uuid
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Sinais de texto para a movimentação do Escavador
--
-- `padrao` é REGEX case-insensitive casado contra classificacao_predita.nome E
-- contra o conteúdo. Duas armadilhas já embutidas:
--   - audiência só conta REALIZADA (designada/cancelada/adiada fora), mesma
--     regra medida em 08/08: contar designação dava mediana de 7 dias entre
--     ajuizamento e audiência contra 84 reais;
--   - "sentença" exclui homologação, extinção, embargos e execução — cada um é
--     outro marco, e a sentença de extinção da execução chegava a marcar
--     sentença de conhecimento.
-- ---------------------------------------------------------------------------
insert into public.pop_marco_sinais (pop_marco_id, tipo, padrao, padrao_excluir, origem, confirmado, motivo)
select pm.id, 'texto', v.padrao, v.excluir, 'manual', false, v.motivo
from (values
  ('ajuizamento','^distribui|^redistribui', null,
   'classificacao Distribuicao/Redistribuicao do Escavador; alcanca 329 processos'),
  ('audiencia_inicial','audi[êe]ncia.*(concilia|inaugural|inicial)', 'designa|redesigna|cancel|adiad|remarcad',
   'so audiencia realizada; designacao nao e marco'),
  ('pericia','laudo de per[íi]cia|laudo pericial', null,
   'pericia nao tem codigo TPU confiavel; o laudo e a prova dela'),
  ('audiencia_instrucao','audi[êe]ncia.*instru', 'designa|redesigna|cancel|adiad|remarcad',
   'so audiencia realizada'),
  ('sentenca','^senten[çc]a|julgado (procedente|improcedente)|proferida senten', 'homolog|extin[çc]|embargos|execu',
   'exclui sentenca de homologacao, de extincao e de embargos'),
  ('acordo_homologado','homologa[çc][ãa]o de acordo|acordo homologado', null,
   'homologacao e o ato; acordo apenas celebrado nao entra'),
  ('acordao_2grau','^ac[óo]rd[ãa]o|julgado.*recurso ordin', null,
   'em teste: o titulo nao diz o grau, o sinal de grau e que ancora a instancia'),
  ('embargos_declaracao','embargos de declara', null,
   'classificacao propria do Escavador'),
  ('transito_julgado','tr[âa]nsito em julgado', null,
   'inequivoco'),
  ('execucao_iniciada','cumprimento de senten|in[íi]cio da execu|execu[çc][ãa]o iniciada', null,
   'entrada na fase de cumprimento'),
  ('alvara_expedido','alvar[áa]', 'pedido',
   'exclui "pedido de expedicao de alvara", que e requerimento e nao expedicao'),
  ('arquivamento_definitivo','arquivamento definitivo|arquivados os autos definitiv', null,
   'arquivamento provisorio nao encerra')
) as v(chave, padrao, excluir, motivo)
join public.pop_marcos pm
  on pm.chave = v.chave and pm.board_id = 'b436c043-3ddb-4900-8800-dc4063624816'::uuid
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. A leitura do Escavador
--
-- Uma linha por (POP, marco, processo): a PRIMEIRA data em que o sinal apareceu.
-- ---------------------------------------------------------------------------
create or replace view public.vw_pop_marcos_escavador as
with mov as (
  select
    regexp_replace(coalesce(p.process_number,''), '[^0-9]', '', 'g') as cnj_num,
    nullif(mv->>'data','')::date                                     as data_mov,
    lower(coalesce(mv->'classificacao_predita'->>'nome',''))          as classe,
    lower(coalesce(mv->>'conteudo',''))                              as conteudo,
    case mv->'fonte'->>'grau' when '1' then 'G1' when '2' then 'G2' when '3' then 'SUP' end as grau
  from public.lead_processes p
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.movimentacoes) = 'array' then p.movimentacoes else '[]'::jsonb end
  ) mv
  where p.deleted_at is null
    and length(regexp_replace(coalesce(p.process_number,''), '[^0-9]', '', 'g')) >= 15
),
por_texto as (
  select pm.board_id, pm.chave as marco_chave, pm.ordem, pm.rotulo, pm.stage_id,
         m.cnj_num, min(m.data_mov) as data_detectada, count(*)::bigint as itens,
         'escavador_texto'::text as fonte_deteccao
  from public.pop_marcos pm
  join public.pop_marco_sinais s on s.pop_marco_id = pm.id and s.tipo = 'texto'
  join mov m
    on (m.classe ~ s.padrao or m.conteudo ~ s.padrao)
   and (s.padrao_excluir is null
        or not (m.classe ~ s.padrao_excluir or m.conteudo ~ s.padrao_excluir))
  where m.data_mov is not null
  group by 1,2,3,4,5,6
),
por_grau as (
  select pm.board_id, pm.chave as marco_chave, pm.ordem, pm.rotulo, pm.stage_id,
         m.cnj_num, min(m.data_mov) as data_detectada, count(*)::bigint as itens,
         'escavador_grau'::text as fonte_deteccao
  from public.pop_marcos pm
  join public.pop_marco_sinais s on s.pop_marco_id = pm.id and s.tipo = 'grau'
  join mov m on m.grau = s.grau
  where m.data_mov is not null
  group by 1,2,3,4,5,6
)
select * from por_texto
union all
select * from por_grau;

comment on view public.vw_pop_marcos_escavador is
  'Marcos lidos das movimentacoes do Escavador (lead_processes.movimentacoes): taxonomia/texto e grau da fonte. Janela de 20 movimentacoes por processo.';

-- ---------------------------------------------------------------------------
-- 6. A régua consolidada
--
-- Precedência: DataJud/documento vence Escavador quando os dois viram o mesmo
-- marco. Não é preferência estética — o TPU é determinístico e o texto é
-- inferência. O Escavador entra onde o DataJud não chegou, que é a maioria.
--
-- O sinal de grau NÃO sobrepõe: um processo com movimentação SUP e sem nenhum
-- outro sinal fica com "Subida ao TST" e é isso que se sabe dele.
-- ---------------------------------------------------------------------------
create or replace view public.vw_pop_marcos_regua as
with todas as (
  select d.board_id, d.marco_chave, d.ordem, d.rotulo, d.stage_id,
         regexp_replace(d.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
         d.data_detectada, d.fonte_deteccao, d.tem_prova_documental, 1 as prioridade
  from public.vw_pop_marcos_detectados d
  where d.data_detectada is not null
  union all
  select e.board_id, e.marco_chave, e.ordem, e.rotulo, e.stage_id,
         e.cnj_num, e.data_detectada, e.fonte_deteccao, false, 2
  from public.vw_pop_marcos_escavador e
)
select distinct on (board_id, cnj_num, marco_chave)
       board_id, cnj_num, marco_chave, ordem, rotulo, stage_id,
       data_detectada, fonte_deteccao, tem_prova_documental
from todas
order by board_id, cnj_num, marco_chave, prioridade, data_detectada;

comment on view public.vw_pop_marcos_regua is
  'Uniao das tres fontes de marco: DataJud (TPU), documento e Escavador. TPU vence quando ha conflito. E a fonte da regua da ficha do processo.';
