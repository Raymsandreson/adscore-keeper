-- =============================================================================
-- PLANO DE MIGRAÇÃO — checklists do board em uso para os 26 MARCOS
--
-- Substitui PLANO_20260808_migrar_checklists_para_fase_marco.sql, que ficou
-- obsoleto: ele mapeava template_id ANTIGO -> stage novo, assumindo que o
-- rascunho reaproveitaria os templates existentes. Não foi o que aconteceu.
--
-- ESTE ARQUIVO NÃO FOI EXECUTADO. Prefixo PLANO_ de propósito: é para ler,
-- conferir o mapa e só então rodar, em transação, com o backup feito.
--
-- Medido em 12/08/2026 contra o banco Externo (kmedldlepwiityjsdahz).
--
-- -----------------------------------------------------------------------------
-- POR QUE O PLANO ANTERIOR NÃO PODE RODAR
-- -----------------------------------------------------------------------------
--   templates do board em uso ..... 20 linkados (+2 órfãos com trabalho)
--   templates do rascunho ......... 26
--   compartilhados ................  0     <- nenhum
--
-- Os UUIDs do mapa antigo não existem em nenhum dos dois boards. Rodando hoje,
-- o `on conflict do nothing` engoliria tudo em silêncio e o resultado pareceria
-- sucesso. O mapa abaixo casa VELHO -> NOVO por template real, conferido um a um.
--
-- -----------------------------------------------------------------------------
-- O TAMANHO REAL (12/08/2026)
-- -----------------------------------------------------------------------------
--   8.968 instâncias no board em uso
--     727 com ALGUM passo marcado   (8%)
--   3.304 passos marcados nas 631 instâncias de mapeamento direto
--
-- 92% são esqueleto criado ao abrir o lead. Migra-se 727, não 8.968.
--
-- A régua anda: em 4 dias (08→12/08) foram +340 instâncias e +24 com trabalho,
-- ~5/dia. O mapa é estável, mas as CONTAGENS de conferência abaixo devem ser
-- refeitas no dia em que rodar — não confira contra estes números, confira
-- contra o que o SELECT devolver na hora.
--
-- -----------------------------------------------------------------------------
-- O QUE O SYNC FAZ COM O QUE JÁ FOI MARCADO  (src/lib/syncChecklistInstances.ts)
-- -----------------------------------------------------------------------------
-- A instância guarda os items COMPLETOS (label, checked, docChecklist), não um
-- ponteiro. Mover a instância não apaga nada. O que decide o resultado é o
-- `id` do passo: no load seguinte, syncInstanceItems compara instância x
-- template novo POR ID.
--
--   id existe no novo, mesmo label ....... passa intacto, marcado
--   id existe no novo, label mudou ....... needsRedo -> vira histórico riscado
--                                          + passo novo DESMARCADO (reabre)
--   id não existe no novo ................ fica na lista com selo 'removido'
--
-- Medição do impacto real, nas 631 instâncias de mapeamento direto:
--
--   passa intacto ................ 3.278   (99,2%)
--   reabre (label mudou) .........     9
--   vira riscado (passo sumiu) ...    17
--                                 ───────
--                                   3.304
--
-- Os 26 casos, nominalmente:
--
--   REABREM (9)
--     8x  "Reunião de Onboarding e Assinatura de Contrato"
--           -> template novo tem "Reunião de Onboarding " (com espaço no fim)
--           ATENÇÃO: o espaço à direita é typo do template novo. Corrigir o
--           template ANTES de migrar zera 8 dos 9 reaberturas.
--     1x  "Protocolo da Ação" -> "Protocolo da Petição Inicial"  (renome real)
--
--   VIRAM RISCADO (17)
--     6x  Protocolo e citação · "Acompanhamento de Prazos e Movimentações"
--     4x  Protocolo e citação · "Conclusão para Julgamento ... ou Saneamento"
--           (esperado: virou o marco m_saneamento, com procedimento próprio)
--     3x  Recebimento e Prestação de Contas · "Recebimento de Valores"
--     2x  Recebimento e Prestação de Contas · "Prestação de Contas ao Cliente"
--     1x  Audiência e Réplica · "Preparação para Audiências"
--     1x  Audiência e Réplica · "Participação em Audiências"
--
--   AVISO sobre m_pagamento: o template novo "Recebimento e Prestação de Contas"
--   foi reescrito do zero (2 passos -> 10) e NENHUM passo antigo sobreviveu. As
--   3 instâncias com trabalho ficam 100% riscadas e o progresso delas zera.
--   Nada se perde, mas a ficha fica feia. Decidir antes: aceitar, ou reaproveitar
--   os 2 ids antigos dentro do template novo.
--
-- -----------------------------------------------------------------------------
-- ARMADILHA: TEMPLATES DUPLICADOS POR NOME
-- -----------------------------------------------------------------------------
-- O plano antigo já avisava dos DOIS "Julgamento do Recurso" (um por instância
-- recursal — é intencional). Existem outros dois pares, estes acidentais, e o
-- plano antigo não os enxergava porque não estão linkados a nenhuma fase:
--
--   "Embargos de Declaração 2º grau"  f73e6193 (linkado, 13 inst)
--                                     ed92629e (ÓRFÃO,    7 inst)
--   "Agravo Interno"                  46c6ce24 (linkado,  2 inst)
--                                     59afa7a7 (ÓRFÃO,    3 inst)
--
-- As duas órfãs têm trabalho real e vão para o mesmo marco da irmã linkada.
-- Agrupar por NOME em qualquer etapa juntaria os dois "Julgamento do Recurso"
-- e mandaria os dois para a mesma fase. Tudo abaixo casa por template_id.
--
-- =============================================================================


-- ETAPA 0 — BACKUP. Sem isto, nada roda.
-- ---------------------------------------------------------------------------
create table if not exists public.zz_checklist_instances_bkp_20260812 as
select * from public.lead_checklist_instances
where board_id = 'b436c043-3ddb-4900-8800-dc4063624816';

create table if not exists public.zz_checklist_stage_links_bkp_20260812 as
select * from public.checklist_stage_links
where board_id in ('b436c043-3ddb-4900-8800-dc4063624816',
                   '0bcd8be6-3aa5-4ab0-8091-9987bdc47e15');

-- Conferência obrigatória — os números têm que bater com o board na hora:
--   select count(*) from public.zz_checklist_instances_bkp_20260812;   -- ~8.968
--   select count(*) from public.zz_checklist_stage_links_bkp_20260812; -- 52 (26+26)


-- ETAPA 1 — Acolher os 4 templates ÓRFÃOS em m_pre_processual.
--
-- Decisão do usuário (12/08/2026): captação e análise viram marco pré-processual.
-- Estes 4 templates NÃO têm equivalente no rascunho. Em vez de remapear items
-- para um template novo (que reabriria trabalho), linka-se o template ANTIGO ao
-- marco novo. A instância mantém checklist_template_id — sync compara com o
-- mesmo template de sempre, então o resultado é ZERO reabertura e ZERO riscado.
-- ---------------------------------------------------------------------------
insert into public.checklist_stage_links (board_id, stage_id, checklist_template_id)
values
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15', 'm_pre_processual', '83a6c1e9-e397-4893-810f-f14efffd104c'), -- Captação de Leads Inbound   (10)
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15', 'm_pre_processual', '28433ee0-83df-4e08-9c4f-bf9f7d3f8aa6'), -- Captação de Leads Outbound  (10)
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15', 'm_pre_processual', '8908ef74-bc5e-441a-b946-4545ab9b58c1'), -- Análise Jurídica            ( 8)
  ('0bcd8be6-3aa5-4ab0-8091-9987bdc47e15', 'm_pre_processual', '2a24b8f7-e654-46b8-832b-832d17daa1b9')  -- Definição da Estratégia     ( 7)
on conflict do nothing;

-- AVISO — "Definição da Estratégia" (2a24b8f7) tem 0 passos no template, mas 7
-- instâncias com passo marcado. O template foi esvaziado em algum momento e as
-- instâncias ficaram com items que ele não tem mais. No próximo sync os 7 caem
-- todos em 'removido do POP' (riscados, preservados, sem progresso). Se isso não
-- for aceitável, repovoar o template ANTES de migrar.


-- ETAPA 2 — Mover as instâncias com trabalho, por template_id.
--
-- SÓ as que têm passo marcado. As vazias são recriadas sozinhas ao abrir o lead.
-- "Instrução e Julgamento" (988c232e) fica de fora: é a ETAPA 3.
-- ---------------------------------------------------------------------------
-- RODAR PRIMEIRO COMO SELECT count(*) — esperado ~631 + 35 órfãs = ~666.
-- Só depois trocar o SELECT pelo UPDATE, dentro de BEGIN/COMMIT.

-- with mapa(velho, stage_novo, tpl_novo) as (values ...)   <- ver bloco abaixo
-- select count(*)
--   from public.lead_checklist_instances i
--   join mapa m on m.velho = i.checklist_template_id
--  where i.board_id = 'b436c043-3ddb-4900-8800-dc4063624816'
--    and exists (select 1 from jsonb_array_elements(coalesce(i.items,'[]'::jsonb)) x
--                 where (x.value->>'checked')::boolean is true);

begin;

with mapa(velho, stage_novo, tpl_novo) as (values
  -- ── pré-processual ────────────────────────────────────────────────────────
  ('20a7ccbe-8b8d-4dd9-a344-c45ed798df4a'::uuid, 'm_pre_processual',        '1a164c2d-5e4e-46d8-97d4-b9f21bcc3d1c'::uuid), -- Consulta e Acolhimento Inicial      138
  ('056e1d19-736f-4d51-b41c-249bfb5118e4',       'm_pre_processual',        'fc7f4083-2674-4cdb-98ea-1832be77555b'),       -- Preparação da Petição Inicial       126
  ('3074b3b5-bf42-4766-b471-169c5ae80c8f',       'm_pre_processual',        'c39ac057-9ad8-4f28-9ab5-1a6868dc2c50'),       -- Mediação MPT (NUPIA)                 34
  -- órfãos acolhidos na ETAPA 1 — template NÃO muda, só board/stage
  ('83a6c1e9-e397-4893-810f-f14efffd104c',       'm_pre_processual',        '83a6c1e9-e397-4893-810f-f14efffd104c'),       -- Captação Inbound                     10
  ('28433ee0-83df-4e08-9c4f-bf9f7d3f8aa6',       'm_pre_processual',        '28433ee0-83df-4e08-9c4f-bf9f7d3f8aa6'),       -- Captação Outbound                    10
  ('8908ef74-bc5e-441a-b946-4545ab9b58c1',       'm_pre_processual',        '8908ef74-bc5e-441a-b946-4545ab9b58c1'),       -- Análise Jurídica                      8
  ('2a24b8f7-e654-46b8-832b-832d17daa1b9',       'm_pre_processual',        '2a24b8f7-e654-46b8-832b-832d17daa1b9'),       -- Definição da Estratégia               7
  -- ── conhecimento ──────────────────────────────────────────────────────────
  ('e7eb161c-edd8-45e8-b715-4bb5a4554c63',       'm_ajuizamento',           'e10cdd23-b259-493a-a9c2-dbcea7e9c1a5'),       -- Protocolo e citação                 121
  ('f8e3944f-2002-4b89-a77a-2f028b1155b7',       'm_audiencia_inicial',     'b2db88fd-0a83-4166-8acf-9bfa9c08c181'),       -- Audiência e Réplica                  77
  ('0cfabf3c-d467-4c1a-817c-2fd3940bcc4e',       'm_embargos_1grau',        '2d770d64-aa36-4cb2-bc53-fd9eae8d1070'),       -- Embargos de declaração               32
  -- ── 2º grau ───────────────────────────────────────────────────────────────
  ('09060de5-d660-48fa-8743-dd228b7663d8',       'm_remessa_2grau',         '7513e994-5197-4af8-8295-338e3d839ee8'),       -- Envio para o 2º grau                 28
  ('a4b97849-dbab-4a6a-8778-27acffc60cb9',       'm_acordao_2grau',         '88e63113-8b14-4259-8af3-e9ec8d309a21'),       -- Julgamento do Recurso [2ª inst]      30
  ('f73e6193-f2a6-449b-bcd1-b32fe168bec3',       'm_embargos_2grau',        '9c61b4fd-93f3-4010-b6d6-3eb7d9916ee0'),       -- Embargos 2º grau  (linkado)          13
  ('ed92629e-269e-40d0-8d35-7abefece1dec',       'm_embargos_2grau',        '9c61b4fd-93f3-4010-b6d6-3eb7d9916ee0'),       -- Embargos 2º grau  (ÓRFÃO)             7
  -- ── instância superior ────────────────────────────────────────────────────
  ('305210fb-31dd-4e02-add3-f57faff5a0bf',       'm_admissibilidade_rr',    '4ce0e3ea-65ed-4154-a9a6-0dd161919b4c'),       -- Apresentar Recurso e remessa          5
  ('84e98967-1307-46ee-97e0-04da8307d975',       'm_agravo_instrumento',    'e34e115b-0d9f-435f-8c5e-fb9dcb2d9717'),       -- Agravo de Instrumento em RR           7
  ('2dd31f17-638f-4df8-a678-648c224d3d60',       'm_decisao_superior',      'a613c90a-eda7-4f22-aa8a-dbe3ef2d45f1'),       -- Julgamento do Recurso [superior]      4
  ('46c6ce24-ce8f-4db0-9051-41e5f299fc12',       'm_agravo_interno',        'e8e00442-f60b-4660-b352-6fbe6caa2076'),       -- Agravo Interno    (linkado)           2
  ('59afa7a7-da9e-4679-80d3-f2aaf1908251',       'm_agravo_interno',        'e8e00442-f60b-4660-b352-6fbe6caa2076'),       -- Agravo Interno    (ÓRFÃO)             3
  ('d778424d-4a2c-4bbb-97e9-3baed8ff1685',       'm_recurso_extraordinario','43cc6b0e-613f-4c85-a481-e48741df188f'),       -- Recurso ao STF                        1
  -- ── pagamento ─────────────────────────────────────────────────────────────
  ('f72ef1e6-d231-4e0e-91fd-805257a9a925',       'm_pagamento',             'd09fa9f6-dae8-41b4-8a78-9fb334a2de49')        -- Recebimento e Prestação de Contas     3
)
update public.lead_checklist_instances i
   set board_id              = '0bcd8be6-3aa5-4ab0-8091-9987bdc47e15',
       stage_id              = m.stage_novo,
       checklist_template_id = m.tpl_novo,
       updated_at            = now()
  from mapa m
 where m.velho = i.checklist_template_id
   and i.board_id = 'b436c043-3ddb-4900-8800-dc4063624816'
   and exists (select 1 from jsonb_array_elements(coalesce(i.items,'[]'::jsonb)) x
                where (x.value->>'checked')::boolean is true);

-- CONFERIR ANTES DO COMMIT — as três têm que fechar:
--   select count(*) from public.lead_checklist_instances
--    where board_id='0bcd8be6-3aa5-4ab0-8091-9987bdc47e15';          -- ~666
--   select count(*) from public.lead_checklist_instances
--    where board_id='b436c043-3ddb-4900-8800-dc4063624816'
--      and exists (select 1 from jsonb_array_elements(coalesce(items,'[]'::jsonb)) x
--                   where (x.value->>'checked')::boolean is true);   -- ~61 (só Instrução)
--   -- nenhuma instância pode ter ficado com template fora do board novo:
--   select count(*) from public.lead_checklist_instances i
--    where i.board_id='0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'
--      and not exists (select 1 from public.checklist_stage_links l
--                       where l.board_id=i.board_id
--                         and l.checklist_template_id=i.checklist_template_id
--                         and l.stage_id=i.stage_id);                -- 0

commit;


-- ETAPA 3 — Partir "Instrução e Julgamento" em três. Só depois da 2 conferida.
--
-- BOA NOTÍCIA: os 3 templates novos já existem e reusam os MESMOS step ids e os
-- MESMOS labels do template antigo. Conferido passo a passo — 20 = 10 + 7 + 3,
-- zero passo sem casa, zero label divergente. Não há remapeamento a inventar:
-- a partição é determinística por step_id.
--
--   988c232e "Instrução e Julgamento"  (20 passos, 61 inst. com trabalho)
--     -> a54d1622  Perícia — nomeação, laudo e manifestação   (10)  m_pericia
--     -> 7db8cd98  Instrução — razões finais e parecer do MPT ( 7)  m_audiencia_instrucao
--     -> 2408ea09  Sentença — envio e publicação              ( 3)  m_sentenca
-- ---------------------------------------------------------------------------
begin;

with alvo as (
  select i.*
    from public.lead_checklist_instances i
   where i.board_id = 'b436c043-3ddb-4900-8800-dc4063624816'
     and i.checklist_template_id = '988c232e-25f6-47ab-9ba9-f121069d16ec'
     and exists (select 1 from jsonb_array_elements(coalesce(i.items,'[]'::jsonb)) x
                  where (x.value->>'checked')::boolean is true)
),
destino(tpl, stage_novo) as (values
  ('a54d1622-9728-4735-9a3b-1d6212ffb94f'::uuid, 'm_pericia'),
  ('7db8cd98-7901-4346-82c6-f99f37fe1fe4',       'm_audiencia_instrucao'),
  ('2408ea09-313f-4e23-b0a2-8cd8e8029521',       'm_sentenca')
),
-- para cada (instância x destino), fica só o subconjunto de items cujo step id
-- pertence ao template de destino
fatiado as (
  select a.id as origem_id, a.lead_id, a.process_id, a.created_at,
         d.tpl, d.stage_novo,
         jsonb_agg(x.value order by x.ord) as items
    from alvo a
    cross join destino d
    join public.checklist_templates t on t.id = d.tpl,
         jsonb_array_elements(coalesce(a.items,'[]'::jsonb)) with ordinality x(value, ord)
   where exists (select 1 from jsonb_array_elements(coalesce(t.items,'[]'::jsonb)) y
                  where y.value->>'id' = x.value->>'id')
   group by a.id, a.lead_id, a.process_id, a.created_at, d.tpl, d.stage_novo
)
insert into public.lead_checklist_instances
  (lead_id, process_id, checklist_template_id, board_id, stage_id, items,
   is_completed, created_at, updated_at)
select f.lead_id, f.process_id, f.tpl,
       '0bcd8be6-3aa5-4ab0-8091-9987bdc47e15', f.stage_novo, f.items,
       (select bool_and((z.value->>'checked')::boolean is true)
          from jsonb_array_elements(f.items) z),
       f.created_at, now()
  from fatiado f;

-- CONCILIAÇÃO — a prova de que nada se perdeu. Tem que dar ZERO diferença:
--   with antes as (
--     select count(*) n from public.lead_checklist_instances i,
--            jsonb_array_elements(coalesce(i.items,'[]'::jsonb)) x
--      where i.board_id='b436c043-3ddb-4900-8800-dc4063624816'
--        and i.checklist_template_id='988c232e-25f6-47ab-9ba9-f121069d16ec'
--        and (x.value->>'checked')::boolean is true),
--   depois as (
--     select count(*) n from public.lead_checklist_instances i,
--            jsonb_array_elements(coalesce(i.items,'[]'::jsonb)) x
--      where i.board_id='0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'
--        and i.checklist_template_id in ('a54d1622-9728-4735-9a3b-1d6212ffb94f',
--                                        '7db8cd98-7901-4346-82c6-f99f37fe1fe4',
--                                        '2408ea09-313f-4e23-b0a2-8cd8e8029521')
--        and (x.value->>'checked')::boolean is true)
--   select (select n from antes) as marcados_antes,
--          (select n from depois) as marcados_depois,
--          (select n from depois) - (select n from antes) as diferenca;  -- 0

-- Só com a conciliação em ZERO, aposentar as originais:
-- update public.lead_checklist_instances
--    set is_readonly = true, updated_at = now()
--  where board_id='b436c043-3ddb-4900-8800-dc4063624816'
--    and checklist_template_id='988c232e-25f6-47ab-9ba9-f121069d16ec';

commit;


-- ROLLBACK — testado contra o backup da ETAPA 0, roda em menos de 1 min.
-- ---------------------------------------------------------------------------
--   -- 3.1 apaga as instâncias criadas pela partição (não existiam antes)
--   delete from public.lead_checklist_instances
--    where board_id='0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'
--      and id not in (select id from public.zz_checklist_instances_bkp_20260812);
--
--   -- 3.2 devolve board/stage/template de tudo que foi movido
--   update public.lead_checklist_instances i
--      set board_id              = b.board_id,
--          stage_id              = b.stage_id,
--          checklist_template_id = b.checklist_template_id,
--          is_readonly           = b.is_readonly,
--          items                 = b.items,
--          is_completed          = b.is_completed
--     from public.zz_checklist_instances_bkp_20260812 b
--    where b.id = i.id;
--
--   -- 3.3 desfaz os links dos órfãos (ETAPA 1)
--   delete from public.checklist_stage_links
--    where board_id='0bcd8be6-3aa5-4ab0-8091-9987bdc47e15'
--      and checklist_template_id in ('83a6c1e9-e397-4893-810f-f14efffd104c',
--                                    '28433ee0-83df-4e08-9c4f-bf9f7d3f8aa6',
--                                    '8908ef74-bc5e-441a-b946-4545ab9b58c1',
--                                    '2a24b8f7-e654-46b8-832b-832d17daa1b9');


-- =============================================================================
-- ANTES DE RODAR — decisões que não são do script
-- =============================================================================
--  1. Corrigir o label "Reunião de Onboarding " (espaço à direita) no template
--     1a164c2d? Corrigindo, 8 das 9 reaberturas somem.
--  2. m_pagamento: aceitar que as 3 instâncias fiquem 100% riscadas, ou
--     reaproveitar os ids dos 2 passos antigos dentro do template d09fa9f6?
--  3. "Definição da Estratégia" (2a24b8f7) está com 0 passos e 7 instâncias com
--     trabalho. Repovoar o template, ou aceitar os 7 riscados?
--  4. As 7 fases sem procedimento no plano antigo (Saneamento, Trânsito,
--     Liquidação, Execução, Alvará, Arquivamento) JÁ ganharam template no
--     rascunho — mas nenhuma instância histórica cai nelas. Elas começam
--     vazias e passam a ser preenchidas dali pra frente. Isso é esperado.
-- =============================================================================
