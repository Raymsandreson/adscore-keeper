-- =============================================================================
-- PLANO (não roda sozinho — prefixo PLANO_): marcos previdenciários POR PRODUTO
-- Levantado em 30/08/2026 contra o banco real. ✅ APLICADO em 30/08/2026 com OK
-- do usuário, com DUAS correções sobre o texto abaixo (o aplicado é o que vale):
--   1. Os shifts de ordem NÃO têm teto (`ordem < 20`) e movem TODOS os marcos a
--      partir da âncora, estados incluídos — existe UNIQUE (board_id, ordem)
--      (deferred) e o teto colidia no POP-BPC-Adm (judicial em 11..24, estados
--      em 30..43).
--   2. estagio_financeiro_sugerido é 'A_RECEBER' (underscore — CHECK da tabela),
--      e o padrao_excluir da perícia médica nos boards BPC é
--      'per[íi]cia social|estudo social|laudo social|assistente social', nunca
--      'social' seco ("Instituto Nacional do Seguro Social" está em todo
--      cabeçalho e mataria o marco).
-- Estendido no mesmo dia, com OK, a Justiça Comum e Requerimento de Seguro:
-- contestacao ("Contestação do réu"), replica e rpv_precatorio; SEM implantacao
-- (não há benefício) e SEM liquidacao_calculos — esses boards já têm o marco
-- `liquidacao`, que estava sem sinal e recebeu os padrões de cálculos + planilha
-- (pagamento idem: efetuado + comprovante); acórdão com apelação/TJ e recurso
-- inominado/TR. Totais finais medidos: 260 marcos, 642 sinais, 1338 processos.
-- Verificado após aplicar + pop_marcos_tick(): 222→254 marcos, 556→622 sinais,
-- 3804→3813 linhas materializadas, 1337 processos com marco (ninguém perdeu),
-- 0 ordens duplicadas. Caso 1017247-47.2025.4.01.3100: 28/04 reclassificado de
-- Perícia para Estudo social (a mov é "juntada de laudo de perícia social") e o
-- marco atual virou Contestação do INSS em 17/06/2026 — 40%→50%.
--
-- CONTEXTO MEDIDO
-- As réguas dos POPs previdenciários são hoje IDÊNTICAS entre si (cópia da
-- migration 20260814130000): ajuizamento → perícia → audiência → sentença →
-- embargos → remessa 2º → acórdão 2º → remessa sup → decisão sup → trânsito →
-- execução → alvará → pagamento → arquivamento. O que o Escavador traz nos
-- processos reais (varrido em toda a base de ramo 4 + acidentários de ramo 8):
--
--   termo                          movs  processos
--   perícia médica/laudo            100     57      ← já coberto (marco pericia)
--   proposta de acordo               31     27
--   turma recursal/rec. inominado    29     17      ← NÃO coberto (padrão atual é "recurso ordinário", trabalhista)
--   contestação                       —     28      ← NÃO coberto
--   cumprimento de sentença          25      7      ← coberto ("cumprimento de senten")
--   cálculos/CECALC/exec. invertida  20     16      ← NÃO coberto
--   CEAB/APSADJ (implantação)        13      6      ← NÃO coberto
--   réplica/impugn. à contestação     —      8      ← NÃO coberto
--   estudo/perícia social             8      8      ← cai no marco "pericia" genérico
--   implantação/obrigação de fazer    7      7      ← NÃO coberto
--   RPV/requisição de pagamento       7      5      ← NÃO coberto (não há marco)
--   precatório                        3      2      ← NÃO coberto (não há marco)
--   alvará                            2      1      ← marco existe; raro no ramo 4
--
-- Sinal-âncora achado nos processos que já executam (5001201-49.2021.4.03.6316,
-- 5000414-15.2023.4.03.6004, 1002943-15.2022.4.01.3305, 5000687-31.2024.4.04.7006):
-- a CLASSE evolui para "CUMPRIMENTO DE SENTENÇA CONTRA A FAZENDA PÚBLICA (12078)"
-- e passa a abrir todo cabeçalho — o sinal texto de execucao_iniciada já casa.
-- "Evoluída a classe" aparece em 4 processos como movimentação própria.
--
-- COMPETÊNCIA (confirmada nos CNJs da base): acidentários têm processos na
-- Justiça ESTADUAL (0800689-47.2026.8.10.0098, 1026977-24.2026.8.13.0079,
-- 0801968-05, 0802539-09, 0813476-77 — acidente do trabalho, art. 109 I CF)
-- e na federal; BPC/pensão/salário-maternidade são 100% JEF federal. No JEF o
-- recurso é INOMINADO para TURMA RECURSAL (nunca "recurso ordinário", nunca
-- "apelação"); no estadual é APELAÇÃO ao TJ. Os padrões de acórdão precisam
-- dos dois vocabulários.
--
-- BOARDS ALVO (ids conferidos em kanban_boards):
--   cbaa0dfb-2b83-4e4b-84be-f2f0f6be1ded  BPC JUDICIAL
--   8377ee1b-97a2-4777-9b51-3af9e630b3c6  POP - BPC - Administrativo
--   b922f490-3600-4652-a629-5d63110501ca  Auxílio Acidente
--   <conferir>                            Fluxo Auxílio Doença Acidentário
--   <conferir>                            Fluxo de Pensão por Morte
--   <conferir>                            Salário Maternidade Urbano
--   aeb06943 / 73e156dc / 67a23e8e / 08b5937c  POPs judiciais por benefício (sem processo hoje)
--
-- ⚠️ As ORDENS diferem por board (BPC JUDICIAL: judicial em 1..14;
-- POP-BPC-Adm: administrativo em 1..4 e judicial em 11..24). Todo INSERT
-- abaixo calcula a ordem RELATIVA ao marco-âncora do próprio board e empurra
-- os seguintes com UPDATE antes — nunca ordem absoluta fixa.
-- ⚠️ Marco novo que for ESTADO nasceria com atravessa_fases = true; todos os
-- propostos aqui são FASE (atravessa_fases = false).
-- ⚠️ Depois de aplicar: SELECT pop_marcos_tick(); e conferir vw_pop_marcos_regua.
--
-- =============================================================================
-- BLOCO 1 — Marcos novos COMUNS aos POPs previdenciários (fase de conhecimento
-- e de execução). Chaves novas: contestacao, replica, liquidacao_calculos,
-- implantacao_beneficio, rpv_precatorio.
-- =============================================================================
do $$
declare
  b record;
  o_pericia smallint; o_sentenca smallint; o_execucao smallint; o_alvara smallint;
begin
  for b in
    select id, name from kanban_boards
    where name in ('BPC JUDICIAL','POP - BPC - Administrativo','Auxílio Acidente',
                   'Fluxo Auxílio Doença Acidentário (Administrativo e Judicial)',
                   'Fluxo de Pensão por Morte (Adm e Judicial)','Salário Maternidade Urbano')
  loop
    select ordem into o_pericia  from pop_marcos where board_id = b.id and chave = 'pericia';
    select ordem into o_sentenca from pop_marcos where board_id = b.id and chave = 'sentenca';
    select ordem into o_execucao from pop_marcos where board_id = b.id and chave = 'execucao_iniciada';
    select ordem into o_alvara   from pop_marcos where board_id = b.id and chave = 'alvara_expedido';
    if o_sentenca is null then continue; end if;

    -- 1a. contestacao + replica: entram entre a perícia e a sentença (empurra sentença em diante)
    update pop_marcos set ordem = ordem + 2 where board_id = b.id and ordem >= o_sentenca and atravessa_fases = false and ordem < 20;
    insert into pop_marcos (board_id, chave, rotulo, ordem, eventual, terminal, atravessa_fases, descricao)
    values
      (b.id, 'contestacao', 'Contestação do INSS', o_sentenca,     true, false, false, 'INSS apresentou defesa. Detectado por "juntada de contestação".'),
      (b.id, 'replica',     'Réplica à contestação', o_sentenca+1, true, false, false, 'Impugnação à contestação protocolada.');

    -- recarrega âncoras já deslocadas
    select ordem into o_execucao from pop_marcos where board_id = b.id and chave = 'execucao_iniciada';

    -- 1b. liquidação/cálculos + implantação + RPV/precatório: entre execução e alvará
    update pop_marcos set ordem = ordem + 3 where board_id = b.id and ordem > o_execucao and atravessa_fases = false and ordem < 20 + 3;
    insert into pop_marcos (board_id, chave, rotulo, ordem, eventual, terminal, atravessa_fases, descricao, estagio_financeiro_sugerido)
    values
      (b.id, 'liquidacao_calculos',   'Liquidação / cálculos',        o_execucao+1, true, false, false, 'Cálculos em elaboração (CECALC, AGU-cálculos, execução invertida). É onde a planilha de liquidação anexada se vincula.', null),
      (b.id, 'implantacao_beneficio', 'Implantação do benefício',     o_execucao+2, true, false, false, 'Obrigação de fazer cumprida (CEAB/APSADJ). Benefício ativo; atrasados ainda não.', null),
      (b.id, 'rpv_precatorio',        'RPV / precatório expedido',    o_execucao+3, true, false, false, 'Requisição de pagamento expedida. Dinheiro requisitado, ainda não na conta.', 'A RECEBER');
  end loop;
end $$;

-- Sinais dos marcos novos (texto casa classe E conteúdo — vw_pop_marcos_escavador)
insert into pop_marco_sinais (pop_marco_id, tipo, padrao, padrao_excluir, origem, confirmado, motivo)
select m.id, s.tipo, s.padrao, s.padrao_excluir, 'manual', true, s.motivo
from pop_marcos m
join (values
  ('contestacao','texto','juntada de contesta[çc][ãa]o|^contesta[çc][ãa]o', null,
     'medido: 28 processos ramo 4 com o termo'),
  ('contestacao','documento','contesta[çc][ãa]o', 'impugna|r[ée]plica', null),
  ('replica','texto','juntada de r[ée]plica|impugna[çc][ãa]o [àa] contesta', null,
     'medido: 8 processos'),
  ('liquidacao_calculos','texto','cecalc|execu[çc][ãa]o invertida|c[áa]lculos judiciais|conta de liquida|elabora[çc][ãa]o de c[áa]lculo|agu - c[áa]lculos', null,
     'medido: 16 processos'),
  ('liquidacao_calculos','documento','planilha de (c[áa]lculo|liquida)|mem[óo]ria de c[áa]lculo|c[áa]lculo de liquida', null,
     'porta do anexo manual da planilha de liquidação'),
  ('implantacao_beneficio','texto','implanta[çc][ãa]o do benef|ceab-dj|apsadj|obriga[çc][ãa]o de fazer.*cumprid', null,
     'medido: 7+6 processos'),
  ('implantacao_beneficio','documento','carta de concess|comprovante de implanta', null,
     'porta do anexo manual da carta de concessão'),
  ('rpv_precatorio','texto','requisi[çc][ãa]o de pequeno valor|requisi[çc][ãa]o de pagamento|\yrpv\y|precat[óo]rio (expedid|requisit)', 'movimenta[çc][ãa]o confidencial',
     'medido: 7 movs RPV + 3 precatório; excluir o placeholder de sigilo que já criava falso pagamento nas 12 estações'),
  ('pagamento','documento','comprovante de pagamento|guia de dep[óo]sito|dep[óo]sito judicial efetuad', null,
     'porta do anexo manual do comprovante')
) s(chave, tipo, padrao, padrao_excluir, motivo) on s.chave = m.chave
where m.board_id in (select id from kanban_boards where name in
  ('BPC JUDICIAL','POP - BPC - Administrativo','Auxílio Acidente',
   'Fluxo Auxílio Doença Acidentário (Administrativo e Judicial)',
   'Fluxo de Pensão por Morte (Adm e Judicial)','Salário Maternidade Urbano'))
  and (s.chave <> 'pagamento' or m.chave = 'pagamento');

-- =============================================================================
-- BLOCO 2 — Vocabulário recursal por competência.
-- JEF federal: acórdão sai da TURMA RECURSAL via RECURSO INOMINADO (17 processos
-- com o termo hoje; o padrão vigente "recurso ordin" é trabalhista e casa 0).
-- Estadual (acidentários): APELAÇÃO ao TJ.
-- =============================================================================
insert into pop_marco_sinais (pop_marco_id, tipo, padrao, padrao_excluir, origem, confirmado, motivo)
select m.id, 'texto',
  'julgad[oa].*recurso inominado|ac[óo]rd[ãa]o.*turma recursal|turma recursal.*(provi|improvi|negad)',
  'pauta de julgamento',
  'manual', true, 'JEF: recurso inominado/TR. Pauta de julgamento excluída — designação não é julgamento.'
from pop_marcos m
where m.chave = 'acordao_2grau' and m.board_id in (select id from kanban_boards where name in
  ('BPC JUDICIAL','POP - BPC - Administrativo','Auxílio Acidente',
   'Fluxo Auxílio Doença Acidentário (Administrativo e Judicial)',
   'Fluxo de Pensão por Morte (Adm e Judicial)','Salário Maternidade Urbano'));

insert into pop_marco_sinais (pop_marco_id, tipo, padrao, padrao_excluir, origem, confirmado, motivo)
select m.id, 'texto',
  'julgad[oa].*apela[çc][ãa]o|conhecid[oa].*apela[çc][ãa]o.*provi|apela[çc][ãa]o c[íi]vel.*(provi|improvi)',
  'interposi[çc][ãa]o|contrarraz',
  'manual', true, 'Acidentário na J. Estadual: apelação/TJ. Interposição e contrarrazões são ato da parte, não julgamento.'
from pop_marcos m
where m.chave = 'acordao_2grau' and m.board_id in (select id from kanban_boards where name in
  ('Auxílio Acidente','Fluxo Auxílio Doença Acidentário (Administrativo e Judicial)'));

-- =============================================================================
-- BLOCO 3 — Só BPC (JUDICIAL + Administrativo): a instrução tem DUAS perícias.
-- O estudo social hoje cai no marco "pericia" genérico (o padrão "laudo de
-- perícia" casa "laudo de perícia social"). Separa em marco próprio e exclui
-- "social" do marco médico NESTES DOIS BOARDS apenas.
-- =============================================================================
do $$
declare
  b record; o_pericia smallint;
begin
  for b in select id from kanban_boards where name in ('BPC JUDICIAL','POP - BPC - Administrativo') loop
    select ordem into o_pericia from pop_marcos where board_id = b.id and chave = 'pericia';
    if o_pericia is null then continue; end if;
    update pop_marcos set ordem = ordem + 1 where board_id = b.id and ordem > o_pericia and atravessa_fases = false and ordem < 20 + 6; -- +6: já conta os shifts do bloco 1
    insert into pop_marcos (board_id, chave, rotulo, ordem, eventual, terminal, atravessa_fases, descricao)
    values (b.id, 'pericia_social', 'Estudo social', o_pericia + 1, true, false, false,
            'Perícia socioeconômica do BPC — a segunda perícia, que os outros benefícios não têm.');
    update pop_marcos set rotulo = 'Perícia médica' where board_id = b.id and chave = 'pericia';
  end loop;
end $$;

insert into pop_marco_sinais (pop_marco_id, tipo, padrao, origem, confirmado, motivo)
select m.id, 'texto', 'estudo social|per[íi]cia social|laudo social|assistente social', 'manual', true,
  'medido: 8 processos BPC com o termo'
from pop_marcos m where m.chave = 'pericia_social';

insert into pop_marco_sinais (pop_marco_id, tipo, padrao, origem, confirmado, motivo)
select m.id, 'documento', 'laudo.*social|estudo social', 'manual', true, 'peça do estudo social'
from pop_marcos m where m.chave = 'pericia_social';

-- exclui o vocabulário social dos sinais de perícia MÉDICA nos boards de BPC
update pop_marco_sinais s set padrao_excluir = coalesce(s.padrao_excluir || '|', '') || 'social'
from pop_marcos m
where s.pop_marco_id = m.id and m.chave = 'pericia' and s.tipo in ('texto','documento')
  and m.board_id in (select id from kanban_boards where name in ('BPC JUDICIAL','POP - BPC - Administrativo'));

-- =============================================================================
-- VERIFICAÇÃO (rodar antes E depois; guardar o antes)
-- =============================================================================
-- select b.name, m.chave, m.ordem, m.eventual from pop_marcos m
--   join kanban_boards b on b.id = m.board_id
--   where b.name in ('BPC JUDICIAL','Auxílio Acidente') order by b.name, m.ordem;
-- select pop_marcos_tick();
-- select * from pop_processo_regua('f3a67175-9b1b-4fe5-bd35-8d66a1b3755a'); -- caso Sidiney
--
-- ROLLBACK: delete from pop_marco_sinais where origem='manual' and created_at::date = current_date;
--           delete from pop_marcos where chave in ('contestacao','replica','liquidacao_calculos',
--             'implantacao_beneficio','rpv_precatorio','pericia_social') and created_at::date = current_date;
--           (as ordens deslocadas voltam com o inverso dos UPDATEs; conferir process_pop_marcos após tick)
