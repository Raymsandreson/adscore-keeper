-- =============================================================================
-- A varredura passa a separar quem ESCREVEU o número: cliente ou a própria casa.
--
-- O ERRO DA MIGRATION ANTERIOR (20260907112131)
-- Ela filtrava `direction = 'inbound'` acreditando que isso significasse "o
-- cliente escreveu". Não significa. Em GRUPO, a mensagem que a instância A
-- envia é RECEBIDA pelas instâncias B, C e D da casa que também estão no grupo,
-- e gravada como `inbound` nas linhas delas. `direction` diz qual instância
-- registrou a linha, não quem digitou.
--
-- Resultado: os 26 candidatos que a primeira passada produziu vieram todos de
-- mensagem escrita pelo PRÓPRIO SISTEMA — o texto delas é o template do robô de
-- notificação ("*Boa tarde Sr(a). X* Referente ao processo n° ..."), e o
-- remetente é 558694473226 / 558694000545, duas instâncias da casa que estão em
-- `dom_numeros_equipe`.
--
-- MEDIDO em 250 grupos operacionais, separando pelo remetente de verdade:
--
--     escrito pela EQUIPE    5.058 ocorrências · 278 CNJ distintos · 161 grupos
--     escrito pelo CLIENTE      37 ocorrências ·   6 CNJ distintos ·   6 grupos
--
-- 99,3% do que parecia "processo citado no grupo" é a casa repetindo um número
-- que já saiu de um sistema nosso.
--
-- POR QUE ISSO NÃO É SÓ UM FILTRO A MAIS
-- Vincular a ficha do cliente a partir da nossa própria mensagem é o sistema
-- lendo a saída dele mesmo e tratando como entrada. Se o número que o robô
-- imprimiu estava errado, o erro volta carimbado de "detectado no WhatsApp" — e
-- já sabemos que pode estar errado: o `0000000-00.2023.8.10.0001` alucinado
-- saiu exatamente desse mesmo template.
--
-- Quando o robô imprime um processo num grupo cujo cliente não tem processo na
-- ficha, o achado é real e vale registrar — mas o conserto é ir buscar de ONDE
-- aquele número saiu (é `notify-inss-update` lendo `inss_admin_processes`, por
-- exemplo) e ligar a ficha à fonte. Reparsear o próprio WhatsApp seria band-aid
-- na tela: troca um vínculo faltando por um vínculo de proveniência duvidosa.
--
-- A METÁFORA
-- Conferir o extrato bancário copiando o número que você mesmo anotou no
-- caderno. Se a anotação estava errada, a conferência confirma o erro.
--
-- O QUE MUDA
--   - coluna `origem` em grupo_processo_detectado: 'cliente' | 'equipe'
--   - status novo `eco_da_casa`: registrado e visível, NUNCA candidato do 6b
--   - só `origem = 'cliente'` pode virar 'sugerido'
--
-- A tabela é limpa e revarrida porque tudo que estava nela veio da passada com
-- o filtro errado, foi gerado por máquina há minutos e nenhuma linha foi tocada
-- por gente (`resolvido_por` nulo em todas).
-- =============================================================================

alter table public.grupo_processo_detectado
  add column if not exists origem text;

comment on column public.grupo_processo_detectado.origem is
  'Quem escreveu o numero: cliente (fonte externa) ou equipe (eco da propria casa).';

alter table public.grupo_processo_detectado
  drop constraint if exists grupo_processo_detectado_status_ck;
alter table public.grupo_processo_detectado
  add constraint grupo_processo_detectado_status_ck check (status in (
    'sugerido',      -- cliente escreveu 1 CNJ, grupo com 1 cliente, cliente sem processo
    'eco_da_casa',   -- quem escreveu foi a propria equipe/robo: registra, nao vincula
    'ignorado',      -- o cliente ja tem esse numero
    'divergente',    -- o cliente tem processo, e este numero nao e nenhum deles
    'ambiguo_cnj',   -- o cliente escreveu 2+ numeros validos
    'ambiguo_lead',  -- o grupo esta ligado a 2+ clientes
    'sem_lead'       -- o grupo nao tem cliente vinculado
  ));

alter table public.grupo_processo_detectado
  drop constraint if exists grupo_processo_detectado_origem_ck;
alter table public.grupo_processo_detectado
  add constraint grupo_processo_detectado_origem_ck
  check (origem is null or origem in ('cliente','equipe'));

create or replace function public.detectar_processos_em_grupos(
  p_limite integer default 50,
  p_group_jid text default null
)
returns TABLE (grupos_varridos integer, cnjs_registrados integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c_re constant text := '\d{7}[-.]?\d{2}[.]?\d{4}[.]?\d[.]?\d{2}[.]?\d{4}';
  v_grupos integer := 0;
  v_cnjs   integer := 0;
begin
  drop table if exists _alvo;
  drop table if exists _equipe;
  drop table if exists _lead_do_grupo;
  drop table if exists _cnjs_do_lead;
  drop table if exists _achado;
  drop table if exists _quantos_cnj;

  create temporary table _alvo on commit drop as
    select g.group_jid
      from public.dom_grupos_piloto g
     where g.ativo
       and g.escopo_status = 'operacional'
       and (p_group_jid is null or g.group_jid = p_group_jid)
       and (p_group_jid is not null or g.processos_varridos_em is null)
     order by g.group_jid
     limit greatest(p_limite, 1);

  select count(*) into v_grupos from _alvo;
  if v_grupos = 0 then
    return query select 0, 0;
    return;
  end if;

  -- Os numeros da casa, montados UMA vez. Duas fontes porque as duas ja sao
  -- usadas como "e nosso" em lugares diferentes do sistema: dom_numeros_equipe
  -- (usada por dom_grupos_para_olhar) e o dono de cada instancia ativa (usado
  -- pelo bloco de agente em grupo do webhook). Comparacao pelos ultimos 8
  -- digitos, que e a heuristica que o webhook ja aplica — o nono digito do
  -- celular brasileiro entra e sai conforme a origem do cadastro.
  create temporary table _equipe on commit drop as
    select distinct right(regexp_replace(phone, '\D', '', 'g'), 8) as fim
      from public.dom_numeros_equipe where ativo and phone is not null
    union
    select distinct right(regexp_replace(owner_phone, '\D', '', 'g'), 8)
      from public.whatsapp_instances where is_active and owner_phone is not null;

  create temporary table _lead_do_grupo on commit drop as
    select a.group_jid,
           count(distinct lg.lead_id) as leads,
           (array_agg(distinct lg.lead_id))[1] as lead_id
      from _alvo a
      left join public.lead_whatsapp_groups lg
             on public.jid_chave(lg.group_jid) = public.jid_chave(a.group_jid)
     group by a.group_jid;

  create temporary table _cnjs_do_lead on commit drop as
    select l.group_jid, public.cnj_digitos(p.process_number) as cnj
      from _lead_do_grupo l
      join public.lead_processes p
        on p.lead_id = l.lead_id and p.deleted_at is null
     where length(public.cnj_digitos(p.process_number)) = 20;

  create temporary table _achado on commit drop as
    with brutos as (
      select a.group_jid, m.id as msg_id, m.created_at,
             right(regexp_replace(
               coalesce(m.metadata -> 'message' ->> 'sender_pn',
                        m.metadata -> 'message' ->> 'sender', ''), '\D', '', 'g'), 8) as fim_remetente,
             (regexp_matches(m.message_text, c_re, 'g'))[1] as bruto
        from _alvo a
        join public.whatsapp_messages m on m.phone = a.group_jid
       where m.message_text ~ c_re
    ),
    validos as (
      select group_jid, public.cnj_digitos(bruto) as cnj, msg_id, created_at,
             case when fim_remetente = '' or fim_remetente is null then 'equipe'
                  when exists (select 1 from _equipe e where e.fim = brutos.fim_remetente) then 'equipe'
                  else 'cliente' end as origem
        from brutos
       where public.cnj_valido(bruto)
    )
    -- Um mesmo CNJ pode aparecer pelas duas bocas. Quando aparece pela do
    -- cliente em algum momento, a origem do registro e 'cliente': foi ele quem
    -- deu a informacao, mesmo que a casa tenha repetido depois.
    select group_jid, cnj,
           min(origem) as origem,   -- 'cliente' < 'equipe' em ordem alfabetica
           count(*)::integer as ocorrencias,
           min(created_at) as primeira_em,
           max(created_at) as ultima_em,
           (array_agg(msg_id order by (origem = 'cliente') desc, created_at))[1] as primeira_msg_id
      from validos
     group by 1, 2;

  -- Quantos numeros o CLIENTE escreveu. Eco da casa nao conta para ambiguidade:
  -- o robo repetir tres numeros nao torna o caso ambiguo, so barulhento.
  create temporary table _quantos_cnj on commit drop as
    select group_jid, count(*) filter (where origem = 'cliente') as cnjs_do_cliente
      from _achado group by 1;

  insert into public.grupo_processo_detectado as d
    (group_jid, cnj, status, origem, lead_id, ocorrencias, primeira_msg_id, primeira_em, ultima_em)
  select
    a.group_jid,
    a.cnj,
    case
      when exists (select 1 from _cnjs_do_lead c
                    where c.group_jid = a.group_jid and c.cnj = a.cnj) then 'ignorado'
      when a.origem = 'equipe'            then 'eco_da_casa'
      when l.leads is null or l.leads = 0 then 'sem_lead'
      when l.leads > 1                    then 'ambiguo_lead'
      when exists (select 1 from _cnjs_do_lead c
                    where c.group_jid = a.group_jid)                   then 'divergente'
      when q.cnjs_do_cliente > 1          then 'ambiguo_cnj'
      else 'sugerido'
    end,
    a.origem,
    case when coalesce(l.leads, 0) = 1 then l.lead_id else null end,
    a.ocorrencias, a.primeira_msg_id, a.primeira_em, a.ultima_em
  from _achado a
  join _quantos_cnj q on q.group_jid = a.group_jid
  left join _lead_do_grupo l on l.group_jid = a.group_jid
  on conflict (group_jid, cnj) do update
     set status = excluded.status,
         origem = excluded.origem,
         lead_id = excluded.lead_id,
         ocorrencias = excluded.ocorrencias,
         primeira_msg_id = excluded.primeira_msg_id,
         primeira_em = least(d.primeira_em, excluded.primeira_em),
         ultima_em = greatest(d.ultima_em, excluded.ultima_em),
         atualizado_em = now();

  get diagnostics v_cnjs = row_count;

  -- Pendencias so para o que o CLIENTE escreveu. Eco da casa nao vira fila de
  -- decisao humana: nao ha o que decidir sobre o robo repetir o proprio dado.
  insert into public.pendencias_vinculo (tipo, group_jid, lead_id, payload)
  select 'ambiguidade_lead', l.group_jid, null,
         jsonb_build_object('leads', l.leads,
                            'motivo', 'grupo ligado a mais de um cliente')
    from _lead_do_grupo l
   where l.leads > 1
     and exists (select 1 from _achado a
                  where a.group_jid = l.group_jid and a.origem = 'cliente')
  on conflict do nothing;

  insert into public.pendencias_vinculo (tipo, group_jid, lead_id, payload)
  select 'ambiguidade_processo', d.group_jid, (array_agg(d.lead_id))[1],
         jsonb_build_object(
           'candidatos', jsonb_agg(jsonb_build_object(
             'cnj', d.cnj, 'ocorrencias', d.ocorrencias, 'msg_id', d.primeira_msg_id)),
           'motivo', 'o cliente citou mais de um processo e a ficha nao tem nenhum')
    from public.grupo_processo_detectado d
    join _alvo a on a.group_jid = d.group_jid
   where d.status = 'ambiguo_cnj'
   group by d.group_jid
  on conflict do nothing;

  insert into public.pendencias_vinculo (tipo, group_jid, lead_id, payload)
  select 'divergencia_processo', d.group_jid, (array_agg(d.lead_id))[1],
         jsonb_build_object(
           'novos', jsonb_agg(jsonb_build_object(
             'cnj', d.cnj, 'ocorrencias', d.ocorrencias, 'msg_id', d.primeira_msg_id)),
           'ja_cadastrados', (select jsonb_agg(distinct c.cnj) from _cnjs_do_lead c
                               where c.group_jid = d.group_jid),
           'motivo', 'o cliente citou processo que nao esta na ficha dele')
    from public.grupo_processo_detectado d
    join _alvo a on a.group_jid = d.group_jid
   where d.status = 'divergente'
   group by d.group_jid
  on conflict do nothing;

  update public.dom_grupos_piloto g
     set processos_varridos_em = now()
    from _alvo a
   where g.group_jid = a.group_jid;

  return query select v_grupos, v_cnjs;
end $$;

comment on function public.detectar_processos_em_grupos(integer, text) is
  'Le mensagens de grupo, separa quem escreveu o numero (cliente x casa), valida por modulo 97 e classifica. NAO escreve em lead_processes.';

-- Limpa o que a passada com o filtro errado produziu. Tudo aqui nasceu de
-- maquina ha minutos e nada foi tocado por gente — conferido: resolvido_por
-- nulo em todas as linhas.
delete from public.pendencias_vinculo where resolvido_por is null and resolvido_em is null;
truncate table public.grupo_processo_detectado;
update public.dom_grupos_piloto set processos_varridos_em = null;

-- =============================================================================
-- ROLLBACK: junto com o da 20260907112131 — as duas tabelas e a coluna somem.
-- Nenhuma ficha de cliente, processo ou mensagem foi tocada em nenhuma das duas.
-- =============================================================================
