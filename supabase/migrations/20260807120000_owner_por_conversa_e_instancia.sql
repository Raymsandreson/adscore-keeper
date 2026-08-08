-- Pendência do cliente passa a ter dono mesmo quando o lead não tem processo.
--
-- Problema (medido em 07/08/2026, Externo): das 256 pendências abertas, 207
-- apareciam como "sem responsável definido". A cascata da view
-- (20260806220000) só olhava para lead/processo:
--   1. responsável do processo mais recente
--   2. responsável processual do lead
--   3. último assessor que trabalhou o lead
-- Quem é parceiro/acolhedor não tem nenhum dos três — some da cobrança, mesmo
-- com a conversa acontecendo numa linha com dono conhecido. Caso concreto: a
-- pendência "Tentar ligar para a família novamente" (lead Grazielle Ass.
-- Social) roda na instância "Analyne Oliveira", que tem dono cadastrado, e
-- ainda assim saía sem responsável.
--
-- Dois degraus novos, DEPOIS dos três antigos — nenhuma pendência que já tinha
-- dono muda de dono:
--   4. dono da conversa (`whatsapp_cloud_assignees`) — quem respondeu primeiro
--      assume; é o sinal mais específico que existe, e vale por telefone+linha.
--   5. dono da instância (`whatsapp_instances.owner_user_id`) — a linha
--      responde por quem ninguém assumiu ainda.
--
-- Por que 4 antes de 5: uma instância compartilhada tem vários atendentes; o
-- dono da conversa diz quem está cuidando daquele papo, o dono da linha é só o
-- padrão de quem responde por ela.
--
-- Namespace conferido antes de escrever: os `owner_user_id` das duas tabelas
-- são IDs do auth EXTERNO (os 12 donos de instância existem em auth.users do
-- Externo; as 73 linhas de assignees também). Mesmo espaço de `assigned_to` —
-- não passa por `auth_uuid_mapping`.
--
-- Efeito medido (dry-run antes de aplicar): 31 das 207 sem dono ganham
-- responsável, todas pelo degrau 5. O degrau 4 não muda nada hoje (nenhuma das
-- 207 tem linha em `whatsapp_cloud_assignees`) — entra agora porque a atribuição
-- por conversa é o caminho para as demais.
--
-- Não resolvido de propósito: 193 das 207 são conversas de GRUPO, sendo 174 da
-- instância "Atendimento Previdenciário" (que não tem dono cadastrado). Grupo
-- tem vários processos no mesmo lugar; atribuir tudo a uma pessoa seria pior que
-- deixar em branco. Fica para decisão separada.
--
-- security_invoker segue ligado: a view respeita as policies de quem consulta.
-- `whatsapp_cloud_assignees` e `whatsapp_instances` já são legíveis por
-- `authenticated` (policies "read assignees" e "Authenticated users can view
-- instances"), então os degraus novos não abrem furo nem somem por RLS.
--
-- Atenção ao subir: `tv_atividades_ranking` lê esta view, então o telão passa a
-- contar essas 31 pendências para Analyne (13), João Manoel (11), Dr. Prudêncio
-- (7) e Israel (2). É o comportamento pretendido, mas é visível para a equipe.
--
-- Rollback (<1min): reaplicar 20260806220000_view_client_commitments_owner.sql,
-- que traz a cascata de 3 degraus.

create or replace view public.vw_client_commitments_owner as
select
  c.*,
  l.lead_name,
  coalesce(
    (select pr.responsible_user_id from lead_processes pr
      where pr.lead_id = c.lead_id and pr.responsible_user_id is not null
      order by pr.created_at desc limit 1),
    (select le.processual_responsible_id from leads le where le.id = c.lead_id),
    (select a.assigned_to from lead_activities a
      where a.lead_id = c.lead_id and a.deleted_at is null and a.assigned_to is not null
      order by a.created_at desc limit 1),
    -- 4. quem assumiu a conversa (telefone + linha, como a inbox grava)
    (select wca.assigned_user_id from whatsapp_cloud_assignees wca
      where wca.phone = c.phone
        and lower(wca.instance_name) = lower(c.instance_name)
      limit 1),
    -- 5. dono da linha por onde a conversa acontece
    (select wi.owner_user_id from whatsapp_instances wi
      where lower(wi.instance_name) = lower(c.instance_name)
        and wi.owner_user_id is not null
      limit 1)
  ) as owner_user_id
from public.lead_client_commitments c
left join public.leads l on l.id = c.lead_id;

alter view public.vw_client_commitments_owner set (security_invoker = true);

grant select on public.vw_client_commitments_owner to authenticated;
