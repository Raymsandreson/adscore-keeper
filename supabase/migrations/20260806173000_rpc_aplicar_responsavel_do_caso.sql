-- Propaga o responsável do caso para as atividades dele — 06/08/2026.
--
-- Trocar o responsável em "Editar Caso" mexia só na linha de legal_cases; as
-- atividades que já existiam ficavam com o dono antigo. Esta RPC fecha isso.
--
-- Regras (as mesmas do backfill 20260806160000 e do resolveProcessAssignment):
--   - só atividades VIVAS (pendente/em_andamento). Concluída é o registro de
--     quem executou o trabalho e não se reescreve.
--   - cada atividade segue a trilha do SEU processo: process_type 'jud%' puxa
--     legal_cases.assigned_to_judicial, o resto puxa assigned_to. Atividade sem
--     process_id conta como administrativa.
--   - trilha sem responsável definido no caso não mexe em nada.
--   - PULA atividades que colidiriam no índice único
--     lead_activities_dedup_pending_idx (lead_id, lower(trim(title)),
--     activity_type, assigned_to) WHERE status='pendente'. Sem isso, um caso com
--     duas pendentes de mesmo título estoura 23505 e derruba o salvamento
--     inteiro do caso. Quem já está no alvo fica com a vaga; empate desempata
--     pela mais antiga.
--
-- Devolve o que fez, por trilha, para a interface poder avisar o usuário em vez
-- de propagar em silêncio.

create or replace function public.aplicar_responsavel_do_caso_nas_atividades(
  p_case_id uuid
)
returns table (trilha text, atualizadas integer, puladas integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_adm       uuid;
  v_jud       uuid;
  v_adm_nome  text;
  v_jud_nome  text;
begin
  select c.assigned_to, c.assigned_to_judicial
    into v_adm, v_jud
    from legal_cases c
   where c.id = p_case_id
     and c.deleted_at is null;

  if not found then
    return;
  end if;

  select p.full_name into v_adm_nome from profiles p where p.user_id = v_adm;
  select p.full_name into v_jud_nome from profiles p where p.user_id = v_jud;

  return query
  with candidatas as (
    select a.id, a.lead_id, lower(btrim(a.title)) as k, a.activity_type,
           a.created_at, a.assigned_to,
           case when lower(coalesce(pr.process_type,'')) like 'jud%'
                then 'judicial' else 'administrativo' end as t,
           case when lower(coalesce(pr.process_type,'')) like 'jud%'
                then v_jud else v_adm end as novo,
           case when lower(coalesce(pr.process_type,'')) like 'jud%'
                then v_jud_nome else v_adm_nome end as novo_nome
      from lead_activities a
      left join lead_processes pr on pr.id = a.process_id
     where a.case_id = p_case_id
       and a.deleted_at is null
       and a.status in ('pendente','em_andamento')
  ), mudariam as (
    select * from candidatas
     where novo is not null
       and assigned_to is distinct from novo
  ), estado_final as (
    -- Como ficaria o índice dedup depois da troca. Precisa varrer TODAS as
    -- pendentes dos leads envolvidos, não só as deste caso: a colisão pode ser
    -- com uma atividade de outro caso do mesmo lead.
    select a.id, a.lead_id, lower(btrim(a.title)) as k, a.activity_type,
           a.created_at,
           coalesce(m.novo, a.assigned_to,
                    '00000000-0000-0000-0000-000000000000'::uuid) as dono,
           (m.novo is null and a.assigned_to is not null) as fica_parada
      from lead_activities a
      left join mudariam m on m.id = a.id
     where a.deleted_at is null
       and a.status = 'pendente'
       and a.lead_id is not null
       and a.lead_id in (select distinct lead_id from mudariam where lead_id is not null)
  ), pulados as (
    select id from (
      select id, row_number() over (
               partition by lead_id, k, activity_type, dono
               order by fica_parada desc, created_at) as rn
        from estado_final
    ) x where rn > 1
  ), aplicadas as (
    update lead_activities act
       set assigned_to      = m.novo,
           assigned_to_name = m.novo_nome
      from mudariam m
     where m.id = act.id
       and m.id not in (select id from pulados)
    returning act.id, m.t
  )
  select c.t,
         count(*) filter (where c.id in (select id from aplicadas))::int,
         count(*) filter (where c.id in (select id from pulados))::int
    from mudariam c
   group by c.t;
end;
$$;

comment on function public.aplicar_responsavel_do_caso_nas_atividades(uuid) is
  'Propaga legal_cases.assigned_to / assigned_to_judicial para as atividades VIVAS do caso, cada uma pela trilha do seu processo. Pula colisões do índice lead_activities_dedup_pending_idx. Chamada por CasesPage ao salvar Editar Caso.';
