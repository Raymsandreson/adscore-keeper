-- =============================================================================
-- Reconstrução dos processos destruídos pela purga de julho/2026
-- Banco: Supabase EXTERNO (kmedldlepwiityjsdahz).  NÃO rodar no Cloud.
-- Autor: levantamento de 03/08/2026.  NADA AQUI RODOU AINDA.
-- =============================================================================
--
-- CONTEXTO
-- A edge `permanent-delete-lead` (botão "Remover" do kanban), antes do fix
-- f22d3681d (14/07/2026), fazia hard delete: apagava lead_activities e
-- lead_processes, nulava legal_cases.lead_id e deletava o lead. Resultado:
-- casos vivos, sem lead, sem processo e sem atividade.
--
-- ASSINATURA usada para achar as vítimas (as FKs são ON DELETE SET NULL, logo
-- um delete de lead sozinho deixaria o processo órfão vivo — e não há NENHUM
-- processo órfão no banco; portanto os processos foram apagados de fato):
--   legal_cases vivo + lead_id IS NULL + 0 processos + 0 atividades
--
-- FONTE DOS DADOS ABAIXO
-- As mensagens do grupo de cada caso preservam o template enviado ao cliente:
--   Referente ao processo n° "<CNJ>" de "<TÍTULO>"
-- Esse template só é gerado a partir de lead_processes + lead_activities, então
-- é prova de que o processo existia, e dá CNJ e título originais. Os 8 processos
-- do bloco 1 vieram todos daí. Nada foi inventado.
-- Outros 3 CNJs ficaram FORA do insert automático, aguardando decisão humana —
-- estão comentados no fim do bloco 1, com o motivo de cada um.
--
-- O QUE ESTE SCRIPT FAZ
--   Bloco 1: recria 8 registros em lead_processes, vinculados ao case_id órfão.
-- O QUE ELE NÃO FAZ
--   - Não recria atividades (foram destruídas; o histórico está nas mensagens,
--     ver bloco 5 para extraí-lo).
--   - Não mexe em nenhum registro existente. Só INSERT.
--   - Não vincula lead (bloco 4, opcional e desligado por padrão).
--
-- COMO RODAR
--   SQL Editor do projeto externo, bloco a bloco, conferindo a saída de cada um.
--   O BEGIN está aberto e o COMMIT comentado de propósito: leia o RETURNING
--   antes de confirmar.
--
-- ROLLBACK: bloco 6. Todo registro criado leva o selo
--   description = '[RECONSTRUIDO 2026-08-03] ...'
-- =============================================================================


-- -----------------------------------------------------------------------------
-- BLOCO 0 — pré-checagem. Rode sozinho primeiro.
-- Esperado: 6 linhas, todas com procs=0 e ativs=0. Se alguma já tiver proc>0,
-- alguém mexeu depois do levantamento — PARE e refaça o diagnóstico.
-- -----------------------------------------------------------------------------
select c.case_number,
       left(c.title, 50) as titulo,
       c.lead_id is null as sem_lead,
       (select count(*) from lead_processes p where p.case_id = c.id and p.deleted_at is null) as procs,
       (select count(*) from lead_activities a where a.case_id = c.id) as ativs
from legal_cases c
where c.id in (
  '2c052925-ab3c-4f14-9d99-f136179904cb',  -- CASO 91
  'e58e07b6-31ab-4c9b-895b-e37c2274dc28',  -- CASO 163
  '4a8fb33f-8601-4f4a-a205-974cbc6d25c5',  -- CASO 207
  '458f76dd-4d50-441d-b5b7-887243874282',  -- 318
  '274c050f-2760-4a05-9928-59a679f44d7e',  -- CASO 161
  'c364de95-8fbe-48ea-90fd-c1174f13da5d'   -- CASO CG 105
)
order by c.case_number;

-- Confirma que nenhum dos CNJs candidatos voltou a existir por outro caminho.
-- Esperado: 0 linhas.
select process_number, lead_id, case_id, created_at
from lead_processes
where replace(process_number, ' ', '') in (
  '0016032-85.2022.5.16.0019','0803353-39.2024.8.10.0060','1001135-74.2024.4.01.3702',
  '0802629-77.2023.8.18.0050','0000104-80.2025.5.23.0056','0000267-94.2024.5.23.0056',
  '1030268-21.2025.8.11.0015','0000740-46.2023.5.05.0661','0905308-13.2025.8.19.0001'
);


-- -----------------------------------------------------------------------------
-- BLOCO 1 — recriação dos 9 processos confirmados.
--
-- CONFIRA LINHA A LINHA ANTES DE RODAR. Só você sabe se o CNJ é mesmo do caso.
-- Cada linha: case_id, número do caso (conferência visual), CNJ, título do
-- template, e o JID do grupo (usado só para puxar a última atualização
-- enviada ao cliente para o campo notes).
-- -----------------------------------------------------------------------------
BEGIN;

with mapa (case_id, caso, cnj, titulo, jid) as (values
  -- CASO 91 — Antônio Filho/MA — grupo "Caso 91 Antônio Filho MA"
  ('2c052925-ab3c-4f14-9d99-f136179904cb'::uuid, 'CASO 91',     '0016032-85.2022.5.16.0019', 'ACIDENTE DE TRABALHO',                          '120363039421060979'),
  ('2c052925-ab3c-4f14-9d99-f136179904cb'::uuid, 'CASO 91',     '0803353-39.2024.8.10.0060', 'Seguro de Vida',                                '120363039421060979'),
  ('2c052925-ab3c-4f14-9d99-f136179904cb'::uuid, 'CASO 91',     '1001135-74.2024.4.01.3702', 'PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL (436)',  '120363039421060979'),
  -- CASO 163 — Esperantina/PI, Cláudio Gomes
  ('e58e07b6-31ab-4c9b-895b-e37c2274dc28'::uuid, 'CASO 163',    '0802629-77.2023.8.18.0050', 'Processo',                                      '120363172132004025'),
  -- CASO 207 — Wesle Castro, Senador Guiomard/AC
  ('4a8fb33f-8601-4f4a-a205-974cbc6d25c5'::uuid, 'CASO 207',    '0000267-94.2024.5.23.0056', 'ACIDENTE DE TRABALHO',                          '120363283206530858'),
  -- 318 — Sinop/MT, Caroline x Acometal
  ('458f76dd-4d50-441d-b5b7-887243874282'::uuid, '318',         '1030268-21.2025.8.11.0015', 'AÇÃO DE INDENIZAÇÃO',                           '120363421340432441'),
  -- CASO 161 — Alcântaras/CE
  ('274c050f-2760-4a05-9928-59a679f44d7e'::uuid, 'CASO 161',    '0000740-46.2023.5.05.0661', 'Processo',                                      '120363144484942820'),
  -- CASO CG 105 — Orismar x OI
  ('c364de95-8fbe-48ea-90fd-c1174f13da5d'::uuid, 'CASO CG 105', '0905308-13.2025.8.19.0001', 'Processo',                                      '120363336471612637')

  -- ------------------------------------------------------------------------
  -- PENDENTE 1 — CNJ 0000104-80.2025.5.23.0056 (Wesle Castro): é do CASO 207
  -- ou do CASO 207.1? A mensagem que o anuncia começa com "Sr(a). Família
  -- 207.1/cc1431 - Wesle Castro", o que aponta para o 207.1 — mas os dois
  -- casos dividem o mesmo grupo de WhatsApp, e o 207.1 (2 atividades, ambas
  -- "RAZÕES FINAIS") não tem process_title que confirme. Escolha UMA linha:
  -- ,('4a8fb33f-8601-4f4a-a205-974cbc6d25c5'::uuid,'CASO 207',  '0000104-80.2025.5.23.0056','ACIDENTE DE TRABALHO','120363283206530858')
  -- ,('9e88de15-858c-466e-8e19-2b4ea4eb7f84'::uuid,'CASO 207.1','0000104-80.2025.5.23.0056','ACIDENTE DE TRABALHO','120363283206530858')
  --
  -- PENDENTE 2 — CASO 163. Estes dois CNJs aparecem no texto das mensagens do
  -- grupo, mas NUNCA no template "Referente ao processo n° ...", ou seja: não
  -- há prova de que estivessem cadastrados. Podem ser citação de processo de
  -- terceiro. Recriar sem conferir polui a base.
  -- ,('e58e07b6-31ab-4c9b-895b-e37c2274dc28'::uuid,'CASO 163','0000648-76.2023.5.23.0076','A CONFERIR','120363172132004025')
  -- ,('e58e07b6-31ab-4c9b-895b-e37c2274dc28'::uuid,'CASO 163','1002453-80.2025.8.11.0037','A CONFERIR','120363172132004025')
  -- ------------------------------------------------------------------------
)
insert into lead_processes (
  lead_id, case_id, process_number, title, process_type, status,
  started_at, ano_inicio, description, notes, created_by
)
select
  null,                                   -- caso está órfão; ver bloco 4
  m.case_id,
  trim(m.cnj),
  m.titulo,
  'judicial',                             -- todos são CNJ
  'em_andamento',
  null,                                   -- data real de distribuição: deixa o Escavador preencher
  substring(trim(m.cnj) from 12 for 4)::int,   -- ano vem do próprio CNJ
  '[RECONSTRUIDO 2026-08-03] Recriado após purga do permanent-delete-lead (jul/2026). Origem: template de atividade nas mensagens do grupo.',
  -- última atualização que o cliente recebeu sobre este processo:
  (select mm.message_text
     from whatsapp_messages mm
    where mm.phone in (m.jid, m.jid || '@g.us')
      and mm.message_text like '%' || trim(m.cnj) || '%'
      and mm.message_text like '%Assunto da atividade%'
    order by mm.created_at desc
    limit 1),
  null                                    -- sem autor: não foi pessoa que criou
from mapa m
where not exists (
  select 1 from lead_processes p
   where replace(p.process_number, ' ', '') = trim(m.cnj)
     and p.deleted_at is null
)
returning id, case_id, process_number, title, ano_inicio, left(notes, 80) as notes_ini;

-- Confira o RETURNING acima: devem ser 8 linhas, cada notes_ini com o texto da
-- última atualização real enviada ao cliente. Se estiver certo:
-- COMMIT;
-- Se algo destoar:
-- ROLLBACK;


-- -----------------------------------------------------------------------------
-- BLOCO 2 — verificação pós-commit. Esperado: 6 casos, somando 8 processos
-- (CASO 91 com 3; CASO 207, 163, 318, 161 e CG 105 com 1 cada).
-- -----------------------------------------------------------------------------
select c.case_number, count(p.id) as procs_agora,
       string_agg(p.process_number, ', ' order by p.process_number) as numeros
from legal_cases c
join lead_processes p on p.case_id = c.id and p.deleted_at is null
where c.id in (
  '2c052925-ab3c-4f14-9d99-f136179904cb','e58e07b6-31ab-4c9b-895b-e37c2274dc28',
  '4a8fb33f-8601-4f4a-a205-974cbc6d25c5','458f76dd-4d50-441d-b5b7-887243874282',
  '274c050f-2760-4a05-9928-59a679f44d7e','c364de95-8fbe-48ea-90fd-c1174f13da5d'
)
group by c.case_number order by c.case_number;


-- -----------------------------------------------------------------------------
-- BLOCO 3 — re-enriquecimento pelo Escavador (rodar depois do commit).
-- Puxa movimentações, tribunal, órgão julgador, partes e datas por CNJ.
-- Um por vez, conferindo o retorno. Requer o saldo do Escavador ativo.
--   curl -X POST 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-process-compromissos' \
--     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
--     -H 'Content-Type: application/json' \
--     -d '{"process_id":"<id retornado no bloco 1>"}'
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- BLOCO 4 — OPCIONAL e DESLIGADO: devolver um lead ao caso.
--
-- POR QUE ISSO EXISTE: com lead_id NULL o processo aparece na aba do caso
-- (CasesPage carrega por case_id), mas a UI fica capenga — CasesPage.tsx:541
-- recusa cadastrar processo em caso sem lead ("Caso sem lead vinculado"). Foi
-- por isso que o CASO 382 acabou refeito como lead+caso NOVOS, deixando o
-- antigo como "CASO 382 - COM ERRO". Vincular um lead casca ao caso que já
-- existe evita repetir essa duplicação.
--
-- POR QUE ESTÁ DESLIGADO: criar lead mexe em contagem de funil, dashboard e
-- métricas. É decisão de negócio, não técnica. E o board abaixo
-- (2dcd54b5 = "Acidente de Trabalho") é o que a equipe usou no 382 — confirme
-- que serve para cada caso antes de aplicar.
--
-- Rode um caso por vez, trocando os dois valores marcados.
-- -----------------------------------------------------------------------------
/*
BEGIN;
with novo as (
  insert into leads (lead_name, board_id, status, created_by)
  select c.title,
         '2dcd54b5-502b-413b-b795-5e24a20797d2'::uuid,   -- <<< CONFIRMAR O BOARD
         'closed',
         null
  from legal_cases c
  where c.id = '<CASE_ID>'::uuid                          -- <<< UM CASO POR VEZ
    and c.lead_id is null
  returning id
)
update legal_cases c set lead_id = n.id, updated_at = now()
from novo n where c.id = '<CASE_ID>'::uuid
returning c.case_number, c.lead_id;
-- COMMIT;
*/


-- -----------------------------------------------------------------------------
-- BLOCO 5 — histórico das atividades apagadas (consulta, não escreve).
-- As atividades não voltam, mas todo texto enviado ao cliente está preservado.
-- Troque o JID pelo do caso desejado (ver bloco 1) para ler a linha do tempo.
-- -----------------------------------------------------------------------------
/*
select distinct on (m.message_text)
       m.created_at::date as data, m.message_text
from whatsapp_messages m
where m.phone in ('120363039421060979', '120363039421060979@g.us')   -- <<< JID
  and m.message_text like '%Assunto da atividade%'
order by m.message_text, m.created_at
;
*/


-- -----------------------------------------------------------------------------
-- BLOCO 6 — ROLLBACK. Desfaz exatamente o bloco 1, nada mais.
-- -----------------------------------------------------------------------------
/*
-- Confira o que será apagado:
select id, case_id, process_number, title, created_at
from lead_processes
where description like '[RECONSTRUIDO 2026-08-03]%';

-- Depois de conferir:
-- delete from lead_processes where description like '[RECONSTRUIDO 2026-08-03]%';
*/
