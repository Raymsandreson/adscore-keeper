-- De quem é cada pendência do cliente: a cascata vira VIEW, em um lugar só.
--
-- A regra nasceu dentro de `tv_atividades_ranking` (migration 20260806190000).
-- Com a caixa de pendências (o painel que lista todas as conversas por data), o
-- front precisa responder a mesma pergunta — e regra duplicada diverge. Aqui a
-- cascata passa a viver na view, e o telão lê dela.
--
-- Cascata (o primeiro que existir):
--   1. responsável do processo mais recente do lead
--   2. responsável processual do lead
--   3. último assessor que trabalhou o lead
-- Sem nenhum dos três, `owner_user_id` fica nulo — a pendência existe, mas não
-- é cobrada de ninguém.
--
-- security_invoker: a view respeita as policies de quem consulta, em vez de
-- rodar com os direitos do dono. Sem isso ela viraria um furo no RLS de
-- `lead_client_commitments` e `leads`.
--
-- Conferido antes de trocar a função do telão: os números por pessoa ficaram
-- idênticos (Maria Lydia 19, Keliane 14, Vanessa 3, José Francisco 2,
-- Wanessa 2, Andressa 1, Luana 1).
--
-- Rollback: `drop view public.vw_client_commitments_owner;` e reaplicar
-- 20260806190000 (que traz a cascata inline na função do telão).

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
      order by a.created_at desc limit 1)
  ) as owner_user_id
from public.lead_client_commitments c
left join public.leads l on l.id = c.lead_id;

alter view public.vw_client_commitments_owner set (security_invoker = true);

grant select on public.vw_client_commitments_owner to authenticated;

-- O telão passa a ler a view em vez de repetir a cascata.
-- (aplicado no banco por transformação da definição corrente; este bloco
--  documenta a mudança para quem for reconstruir o schema do zero)
--
-- pend_cli as (
--   select v.owner_user_id as ext_user, count(*)::int as pend_cliente
--   from vw_client_commitments_owner v
--   where v.status in ('combinado','cobrado') and v.owner_user_id is not null
--   group by 1
-- ),
