-- =============================================================================
-- SUSPENSÃO VOLTA A SER ESTADO NO POP EM USO
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Pego no PRIMEIRO tick da fase automática (12/08/2026): 9 processos foram
-- posicionados na fase "Suspensão". É o mesmo erro que custou 61 processos em
-- julho, agora pela porta da frente — 'suspensao' tem a MAIOR ordem da régua
-- (21) e "maior ordem vence", então qualquer processo com um sobrestamento no
-- histórico passava a morar ali, escondendo onde ele está de verdade.
--
-- No board rascunho isso já estava certo (atravessa_fases = true desde
-- 20260808170000); no POP EM USO ficou false e ninguém tinha percebido porque
-- até hoje nenhum processo era posicionado em fase nenhuma.
--
-- Regra do usuário, literal: "marco pela etimologia da palavra não pode ser um
-- estado". Acordo homologado fica como está por ora — ordem 7, stage de
-- cumprimento: quando ele é o marco mais adiantado, "Cumprimento de Sentença"
-- é de fato onde o processo está.
--
-- REVERSÃO: update pop_marcos set atravessa_fases = false
--            where board_id = 'b436c043-…624816' and chave = 'suspensao';
--           (as 9 fases não voltam sozinhas — o tick seguinte as reescreve)
-- =============================================================================
update public.pop_marcos
   set atravessa_fases = true
 where board_id = 'b436c043-3ddb-4900-8800-dc4063624816'
   and chave = 'suspensao';

-- Desfaz só o que a régua escreveu com esse marco. Fase movida na mão não é
-- tocada; o tick seguinte recoloca cada processo no marco real.
update public.lead_processes
   set workflow_stage_id = null,
       workflow_stage_origem = null,
       workflow_stage_marco = null,
       workflow_stage_em = null
 where workflow_stage_origem = 'marco'
   and workflow_stage_marco = 'suspensao';
