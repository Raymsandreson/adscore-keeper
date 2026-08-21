-- Dom — Assessor Jurídico Virtual
--
-- APLICADO no projeto EXTERNO (kmedldlepwiityjsdahz) em 21/08/2026, em 7 etapas:
--   20260821180030 dom_assessor_juridico_virtual_p1_base
--   20260821180054 dom_assessor_juridico_virtual_p2_contexto
--   20260821180124 dom_assessor_juridico_virtual_p3_acervo
--   20260821180417 dom_grupos_com_caso_materializado
--   20260821180655 dom_backfill_por_grupo
--   20260821180914 dom_busca_ignora_lexema_comum
--   20260821181021 dom_par_util_filtra_lixo_do_acervo
-- Este arquivo é o ESTADO FINAL consolidado das 7. É idempotente: rodá-lo
-- reproduz o mesmo resultado.
--
-- O QUE RESOLVE
-- O agente "DOM-Atendente Processual" (id d6ad8eee-d6a3-452c-b852-b94ef8dd54bf)
-- existe desde antes, desligado, com o base_prompt mandando "Extraia do
-- histórico todos os dados do(s) processo(s)" e "Nunca peça o número do
-- processo" — ou seja, adivinhar o andamento lendo conversa antiga. Aqui ele
-- ganha (1) o andamento REAL, judicial e administrativo, e (2) as respostas que
-- a equipe já deu para perguntas parecidas.
--
-- POR QUE NÃO É FINE-TUNING
-- O aprendizado é por recuperação. Toda resposta nova da equipe entra no acervo
-- pelo gatilho da seção 6, então o Dom melhora sozinho, sem retreino e sem
-- assar dado de cliente dentro de um modelo — o que, além de caro, impediria
-- apagar dado a pedido do titular (LGPD).

-- ---------------------------------------------------------------------------
-- 1. Utilidades
-- ---------------------------------------------------------------------------

-- O JID de grupo é gravado em whatsapp_messages.phone SEM o sufixo @g.us, mas
-- em lead_whatsapp_groups.group_jid COM. Toda junção passa por aqui.
create or replace function dom_jid_curto(p_jid text)
returns text language sql immutable as $$
  select split_part(coalesce(p_jid, ''), '@', 1)
$$;

create or replace function dom_so_digitos(p_txt text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(p_txt, ''), '\D', '', 'g')
$$;

-- Esfera pelo 3º campo do CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO): o dígito J.
create or replace function dom_esfera_cnj(p_cnj text)
returns text language sql immutable as $$
  select case substring(dom_so_digitos(p_cnj) from 14 for 1)
    when '1' then 'STF'
    when '3' then 'STJ'
    when '4' then 'previdenciário (Justiça Federal)'
    when '5' then 'trabalhista'
    when '8' then 'cível (Justiça Estadual)'
    else 'esfera não identificada'
  end
  where length(dom_so_digitos(p_cnj)) = 20
$$;

-- Nem toda mensagem nossa serve de exemplo. Medido em 21/08/2026 sobre as
-- 61.382 respostas em grupo com texto:
--   - 2.120 têm action_source='agent': foram geradas por um agente de IA.
--     Treinar o Dom nelas é a IA aprendendo com a própria IA, e o erro compõe.
--   - ~9.200 são template disparado ("Referente ao processo n°", "Progresso do
--     caso: X% concluído", "*Bom dia Sr(a). Fulano*"). Ensinariam o Dom a
--     cuspir formulário no lugar de conversar.
-- Sobra o que humano escreveu à mão, que é o que queremos.
create or replace function dom_resposta_aproveitavel(
  p_texto text, p_action_source text, p_campaign_id text)
returns boolean language sql immutable as $$
  select p_texto is not null
     and length(btrim(p_texto)) between 25 and 1200
     and p_campaign_id is null
     and coalesce(p_action_source, 'manual') <> 'agent'
     and p_texto not like '%Progresso do caso%'
     and p_texto not like '%Referente ao processo n%'
     and p_texto !~ '^\*?(Bom dia|Boa tarde|Boa noite) Sr\(a\)'
     and p_texto not like '%_🤖%'
$$;

-- Nem todo par pergunta→resposta ensina alguma coisa. Medido sobre os 5.534
-- pares da carga inicial:
--   - 1.404 (25%) têm resposta que é só menção ou frase de passagem
--     ("Estamos ligando pra você agora", "Boa tarde @96306588565673").
--   - 66 têm como "pergunta" mensagem da própria equipe: em grupo, o recado de
--     outro número do time chega como inbound. Formato "*Nome:*".
--   - 12 são atualização proativa nossa ("Passando pra te atualizar").
create or replace function dom_par_util(p_pergunta text, p_resposta text)
returns boolean language sql immutable as $$
  select
    length(btrim(regexp_replace(coalesce(p_resposta, ''), '@\d+', '', 'g'))) >= 45
    and coalesce(p_pergunta, '') !~ '^\*[^*]{2,40}\s*:\*'
    and coalesce(p_pergunta, '') not ilike '%passando pra te atualiz%'
    and coalesce(p_pergunta, '') not ilike '%passando para te atualiz%'
    and coalesce(p_pergunta, '') not like '%QUESTIONÁRIO PARA GRUPO%'
$$;

-- Mascara PII antes de qualquer texto virar exemplo para o modelo. Número de
-- processo sobrevive porque tem 20 dígitos e formato próprio.
create or replace function dom_mascarar_pii(p_txt text)
returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p_txt, ''),
               '\d{3}\.?\d{3}\.?\d{3}-\d{2}', '[CPF]', 'g'),
             '\d{2}\.?\d{3}\.?\d{3}/\d{4}-\d{2}', '[CNPJ]', 'g'),
           '\(?\d{2}\)?\s?9\d{4}[-\s]?\d{4}', '[TELEFONE]', 'g')
$$;

-- Grupos que têm caso de verdade: processo judicial OU requerimento INSS.
-- Medido em 21/08/2026: das 36.734 respostas aproveitáveis, só 9.748 (27%) vêm
-- dos grupos com processo. As outras 73% saem de 2.378 grupos de prospecção,
-- coleta de documento e BPC, que não têm conteúdo de decisão — e fariam a busca
-- devolver conversa de captação quando o cliente pergunta do andamento.
create or replace view vw_dom_grupos_com_caso as
  select distinct dom_jid_curto(lg.group_jid) as group_jid
  from lead_whatsapp_groups lg
  where lg.lead_id is not null
    and (
      exists (select 1 from lead_processes p
               where p.lead_id = lg.lead_id
                 and p.process_number is not null
                 and p.deleted_at is null)
      or exists (select 1 from inss_admin_processes i
                  where i.lead_id = lg.lead_id
                    and i.deleted_at is null)
    );

-- A view acima é um DISTINCT com dois EXISTS por dentro. Usada linha a linha na
-- carga, era reavaliada o tempo todo e estourava o statement_timeout num lote
-- de 1 mês. Materializada com PK, vira busca por índice.
create table if not exists dom_grupos_com_caso (
  group_jid           text primary key,
  atualizado_em       timestamptz not null default now(),
  acervo_carregado_em timestamptz
);

create or replace function dom_refresh_grupos_com_caso()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_n integer;
begin
  insert into dom_grupos_com_caso (group_jid, atualizado_em)
  select c.group_jid, now() from vw_dom_grupos_com_caso c
  on conflict (group_jid) do update set atualizado_em = excluded.atualizado_em;

  delete from dom_grupos_com_caso d
  where not exists (select 1 from vw_dom_grupos_com_caso c where c.group_jid = d.group_jid);

  select count(*) into v_n from dom_grupos_com_caso;
  return v_n;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Quem o Dom atende
-- ---------------------------------------------------------------------------

create table if not exists dom_grupos_piloto (
  group_jid   text primary key,
  group_name  text,
  lead_id     uuid,
  ativo       boolean not null default true,
  modo        text not null default 'hibrido'
              check (modo in ('hibrido', 'rascunho', 'automatico')),
  observacao  text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid
);

comment on table dom_grupos_piloto is
  'Grupos onde o Dom responde. Fora desta lista ele fica mudo, mesmo com o agente ativo.';
comment on column dom_grupos_piloto.modo is
  'hibrido = envia o factual e enfileira o sensível; rascunho = enfileira tudo; automatico = envia tudo.';

-- CUIDADO: whatsapp_ai_agents é uma VIEW sobre wjia_command_shortcuts, não uma
-- tabela — ALTER TABLE nela falha. A coluna entra na tabela de baixo e a view é
-- recriada para expor.
--
-- Na mesma linha: a view devolve sign_messages como `false` LITERAL, então a
-- assinatura do Dom não pode depender dela. Ela é feita no código de
-- whatsapp-ai-agent-reply, que é o único lugar onde realmente sai.
alter table wjia_command_shortcuts
  add column if not exists contexto_processual boolean not null default false;

create or replace view whatsapp_ai_agents as
 SELECT id,
    shortcut_name AS name,
    'lovable'::text AS provider,
    COALESCE(model, 'google/gemini-2.5-flash'::text) AS model,
    COALESCE(base_prompt, prompt_instructions) AS base_prompt,
    COALESCE(temperature, 0.7)::integer AS temperature,
    COALESCE(max_tokens, 4096) AS max_tokens,
    false AS sign_messages,
    true AS read_messages,
    is_active,
    NULL::text AS uazapi_agent_id,
    NULL::jsonb AS uazapi_config,
    NULL::text AS created_by,
    created_at,
    updated_at,
    COALESCE(response_delay_seconds, 3) AS response_delay_seconds,
    followup_steps IS NOT NULL AND jsonb_array_length(COALESCE(followup_steps, '[]'::jsonb)) > 0 AS followup_enabled,
    60 AS followup_interval_minutes,
    3 AS followup_max_attempts,
    NULL::text AS followup_message,
    false AS auto_call_enabled,
    'immediate'::text AS auto_call_mode,
    30 AS auto_call_delay_seconds,
    5 AS auto_call_no_response_minutes,
    NULL::text AS auto_call_instance_name,
    COALESCE(human_reply_pause_minutes, 30) AS human_pause_minutes,
    NULL::text AS followup_prompt,
    NULL::uuid AS call_assigned_to,
    COALESCE(split_messages, true) AS split_messages,
    COALESCE(split_delay_seconds, 2) AS split_delay_seconds,
    COALESCE(respond_in_groups, false) AS respond_in_groups,
    COALESCE(reply_with_audio, false) AS reply_with_audio,
    reply_voice_id,
    NULL::text AS stt_prompt,
    max_tts_chars,
    COALESCE(send_call_followup_audio, false) AS send_call_followup_audio,
    handoff_config,
    COALESCE(describe_documents_in_groups, true) AS describe_documents_in_groups,
    assistants_enabled,
    assistants_config,
    COALESCE(contexto_processual, false) AS contexto_processual
   FROM wjia_command_shortcuts;

-- ---------------------------------------------------------------------------
-- 3. Fila de aprovação (o lado "sensível" do modo híbrido)
-- ---------------------------------------------------------------------------

create table if not exists dom_respostas_pendentes (
  id                uuid primary key default gen_random_uuid(),
  group_jid         text not null,
  group_name        text,
  instance_name     text not null,
  lead_id           uuid,
  pergunta          text,
  pergunta_autor    text,
  resposta_sugerida text not null,
  motivo_revisao    text,
  contexto_usado    jsonb,
  status            text not null default 'pendente'
                    check (status in ('pendente', 'aprovada', 'editada', 'descartada', 'enviada')),
  resposta_final    text,
  revisado_por      uuid,
  revisado_em       timestamptz,
  enviado_em        timestamptz,
  erro_envio        text,
  criado_em         timestamptz not null default now()
);

create index if not exists idx_dom_pendentes_status
  on dom_respostas_pendentes (status, criado_em desc);
create index if not exists idx_dom_pendentes_grupo
  on dom_respostas_pendentes (group_jid, criado_em desc);

-- ---------------------------------------------------------------------------
-- 4. Contexto processual do grupo — judicial E administrativo
-- ---------------------------------------------------------------------------

create or replace function dom_contexto_processual(p_group_jid text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with g as (
    select lg.lead_id, lg.group_name
    from lead_whatsapp_groups lg
    where dom_jid_curto(lg.group_jid) = dom_jid_curto(p_group_jid)
      and lg.lead_id is not null
    order by lg.created_at desc
    limit 1
  ),
  proc as (
    select p.id, p.process_number,
           dom_so_digitos(p.process_number) as cnj_digitos,
           p.title, p.status, p.situacao,
           p.tribunal, p.tribunal_sigla, p.grau, p.classe,
           p.assunto_principal, p.orgao_julgador,
           p.data_distribuicao, p.data_ultima_movimentacao,
           p.arquivado, p.segredo_justica,
           p.resultado_atingido, p.resultado_atingido_tipo, p.resultado_atingido_data
    from lead_processes p
    join g on g.lead_id = p.lead_id
    where p.process_number is not null
      and p.deleted_at is null
  )
  select jsonb_build_object(
    'tem_vinculo', exists (select 1 from g),
    'grupo',       (select group_name from g),
    'lead_id',     (select lead_id from g),

    -- Lado ADMINISTRATIVO (INSS). 958 requerimentos na base, 243 leads com
    -- grupo e requerimento. O `despacho` é o que mais gera pergunta no grupo
    -- ("liguem no 135 e agendem a perícia em até 30 dias") e é onde o cliente
    -- perde benefício por não agir a tempo.
    'requerimentos_inss', coalesce((
      select jsonb_agg(jsonb_build_object(
               'numero',             i.requerimento_number,
               'beneficio',          btrim(split_part(coalesce(i.benefit_type, ''), 'Data do Protocolo', 1)),
               'servico',            i.servico,
               'status',             i.current_status,
               'protocolado_em',     i.protocol_date,
               'resultado',          i.resultado,
               'despacho',           left(i.despacho, 600),
               'em_exigencia_desde', i.exigencia_since,
               'numero_beneficio',   i.benefit_number
             ) order by i.protocol_date desc nulls last)
      from inss_admin_processes i
      join g on g.lead_id = i.lead_id
      where i.deleted_at is null
    ), '[]'::jsonb),

    'processos', coalesce((
      select jsonb_agg(x order by ord desc nulls last)
      from (
        select
          pr.data_ultima_movimentacao as ord,
          jsonb_build_object(
            'numero',              pr.process_number,
            'esfera',              dom_esfera_cnj(pr.process_number),
            'titulo',              pr.title,
            'status',              coalesce(pr.situacao, pr.status),
            'tribunal',            coalesce(pr.tribunal_sigla, pr.tribunal),
            'grau',                pr.grau,
            'classe',              pr.classe,
            'assunto',             pr.assunto_principal,
            'orgao',               pr.orgao_julgador,
            'distribuido_em',      pr.data_distribuicao,
            'ultima_movimentacao', pr.data_ultima_movimentacao,
            'arquivado',           pr.arquivado,
            'segredo_justica',     pr.segredo_justica,
            'resultado',           case
                                     when pr.resultado_atingido is not null
                                     then jsonb_build_object(
                                            'situacao', pr.resultado_atingido,
                                            'tipo',     pr.resultado_atingido_tipo,
                                            'data',     pr.resultado_atingido_data)
                                   end,

            'andamentos', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'data',      u.data_movimentacao,
                       'categoria', u.categoria,
                       'titulo',    u.titulo,
                       'resumo',    coalesce(u.resumo_ia, left(u.descricao, 400))
                     ) order by u.data_movimentacao desc)
              from (
                select u2.* from process_updates u2
                where dom_so_digitos(u2.numero_cnj) = pr.cnj_digitos
                   or u2.process_id = pr.id
                order by u2.data_movimentacao desc
                limit 8
              ) u
            ), '[]'::jsonb),

            'decisoes', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'data',      d.data_decisao,
                       'tipo',      d.tipo_evento,
                       'instancia', d.instancia,
                       'titulo',    d.titulo,
                       'orgao',     d.orgao
                     ) order by d.data_decisao desc)
              from (
                select d2.* from jm_decisoes d2
                where dom_so_digitos(d2.processo_cnj) = pr.cnj_digitos
                order by d2.data_decisao desc
                limit 5
              ) d
            ), '[]'::jsonb),

            'audiencias', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'data',   h.hearing_date,
                       'hora',   h.hearing_time,
                       'tipo',   h.hearing_type,
                       'status', h.status,
                       'local',  h.location
                     ) order by h.hearing_date)
              from hearings h
              where (dom_so_digitos(h.process_number) = pr.cnj_digitos
                     or h.process_id = pr.id)
                and h.deleted_at is null
                and h.hearing_date >= current_date - 30
            ), '[]'::jsonb)
          ) as x
        from proc pr
      ) s
    ), '[]'::jsonb)
  )
$$;

comment on function dom_contexto_processual is
  'Dado o JID de um grupo (com ou sem @g.us), devolve o andamento real dos processos judiciais e requerimentos INSS daquele cliente.';

-- ---------------------------------------------------------------------------
-- 5. Acervo de respostas da equipe (o "treino")
-- ---------------------------------------------------------------------------

create table if not exists dom_qa_pares (
  id             uuid primary key default gen_random_uuid(),
  resposta_id    uuid not null unique,
  group_jid      text not null,
  pergunta       text not null,
  resposta       text not null,
  respondido_em  timestamptz not null,
  origem         text not null default 'historico'
                 check (origem in ('historico', 'equipe', 'dom_aprovado', 'dom_corrigido')),
  busca          tsvector
);

create index if not exists idx_dom_qa_busca on dom_qa_pares using gin (busca);
create index if not exists idx_dom_qa_data  on dom_qa_pares (respondido_em desc);

create or replace function dom_qa_atualiza_busca()
returns trigger language plpgsql set search_path = public, extensions
as $$
begin
  new.busca := to_tsvector('portuguese', unaccent(coalesce(new.pergunta, '')));
  return new;
end
$$;

drop trigger if exists trg_dom_qa_busca on dom_qa_pares;
create trigger trg_dom_qa_busca
  before insert or update of pergunta on dom_qa_pares
  for each row execute function dom_qa_atualiza_busca();

-- A busca casava por "bom dia" e devolvia exemplo irrelevante. Medido em
-- 21/08/2026 sobre os pares carregados: "nao" aparece em 23,8% deles, "pra"
-- 18,4%, "ta" 16,5%, "dia" 15,2%, "bom" 14,8%. Termo que está em toda conversa
-- não distingue nada — só empurra ruído para o topo.
--
-- Em vez de chutar uma lista de stopwords, ela sai do próprio acervo: lexema
-- presente em mais de 5% dos pares é descartado da consulta. Recalculável, se
-- ajusta sozinha conforme o acervo cresce.
create table if not exists dom_lexemas_comuns (
  lexema text primary key,
  ndoc   integer not null,
  pct    numeric not null
);

create or replace function dom_refresh_lexemas_comuns(p_corte_pct numeric default 5.0)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_total integer;
  v_n     integer;
begin
  select count(*) into v_total from dom_qa_pares;
  if coalesce(v_total, 0) = 0 then return 0; end if;

  delete from dom_lexemas_comuns;

  insert into dom_lexemas_comuns (lexema, ndoc, pct)
  select word, ndoc, round(100.0 * ndoc / v_total, 2)
  from ts_stat('select busca from dom_qa_pares')
  where 100.0 * ndoc / v_total > p_corte_pct;

  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Busca as respostas que a equipe já deu para perguntas parecidas.
-- A PII é mascarada aqui, no ponto de saída: o modelo nunca vê CPF nem telefone.
create or replace function dom_respostas_parecidas(p_pergunta text, p_limit int default 6)
returns table (pergunta text, resposta text, respondido_em timestamptz, score real)
language sql stable security definer set search_path = public, extensions
as $$
  with termos as (
    select lex
    from unnest(tsvector_to_array(
           to_tsvector('portuguese', unaccent(coalesce(p_pergunta, ''))))) as lex
    where lex not in (select lexema from dom_lexemas_comuns)
      and length(lex) > 2
  ),
  q as (
    -- OR entre os termos restantes; ts_rank ordena por quantos bateram. Com AND
    -- (plainto_tsquery) a busca devolvia 0 resultados: "quando vai ser a
    -- audiência do processo" virava `quando & vai & ser & audiencia & processo`.
    select nullif(string_agg(quote_literal(lex), ' | '), '')::tsquery as tsq
    from termos
  )
  select dom_mascarar_pii(p.pergunta),
         dom_mascarar_pii(p.resposta),
         p.respondido_em,
         ts_rank(p.busca, q.tsq) as score
  from dom_qa_pares p, q
  where q.tsq is not null
    and p.busca @@ q.tsq
    -- Abaixo disso é coincidência de palavra solta, não pergunta parecida.
    and ts_rank(p.busca, q.tsq) >= 0.02
  order by
    -- Correção da equipe sobre resposta do Dom vale mais que histórico solto.
    case p.origem
      when 'dom_corrigido' then 0
      when 'equipe'        then 1
      when 'dom_aprovado'  then 2
      else 3
    end,
    ts_rank(p.busca, q.tsq) desc,
    p.respondido_em desc
  limit greatest(1, least(coalesce(p_limit, 6), 20))
$$;

-- ---------------------------------------------------------------------------
-- 6. Carga do acervo, e o gatilho que o mantém vivo
-- ---------------------------------------------------------------------------

-- Carregar por JANELA DE TEMPO não funciona: o filtro por created_at varre
-- centenas de milhares de linhas de whatsapp_messages (1,5 milhão) antes de
-- afunilar para os grupos com caso, e estoura o statement_timeout — um lote de
-- 1 mês já derruba. Por GRUPO, o índice idx_wam_inst_phone_created resolve cada
-- um em milissegundos.
create or replace function dom_backfill_grupo(p_group_jid text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_n integer;
begin
  insert into dom_qa_pares (resposta_id, group_jid, pergunta, resposta, respondido_em, origem)
  select o.id, o.phone, i.message_text, o.message_text, o.created_at, 'historico'
  from whatsapp_messages o
  cross join lateral (
    -- A última mensagem do cliente antes da nossa resposta, janela de 6h.
    select m.message_text
    from whatsapp_messages m
    where m.instance_name = o.instance_name
      and m.phone = o.phone
      and m.direction = 'inbound'
      and m.message_text is not null
      and length(btrim(m.message_text)) >= 8
      and m.created_at < o.created_at
      and m.created_at > o.created_at - interval '6 hours'
    order by m.created_at desc
    limit 1
  ) i
  where o.phone = p_group_jid
    and o.direction = 'outbound'
    and dom_resposta_aproveitavel(o.message_text, o.action_source, o.campaign_id)
    and dom_par_util(i.message_text, o.message_text)
  on conflict (resposta_id) do nothing;

  get diagnostics v_n = row_count;
  update dom_grupos_com_caso set acervo_carregado_em = now() where group_jid = p_group_jid;
  return v_n;
end
$$;

-- Processa os próximos N grupos ainda não carregados. Chamar em loop até
-- devolver 0 grupos.
create or replace function dom_backfill_lote(p_limite int default 25)
returns table (grupos integer, pares integer)
language plpgsql security definer set search_path = public
as $$
declare
  r        record;
  v_grupos integer := 0;
  v_pares  integer := 0;
begin
  for r in
    select group_jid from dom_grupos_com_caso
    where acervo_carregado_em is null
    order by group_jid
    limit greatest(1, least(coalesce(p_limite, 25), 200))
  loop
    v_pares  := v_pares + dom_backfill_grupo(r.group_jid);
    v_grupos := v_grupos + 1;
  end loop;
  return query select v_grupos, v_pares;
end
$$;

-- A partir daqui o acervo se alimenta sozinho: toda resposta que a equipe manda
-- em grupo com caso vira exemplo para a próxima pergunta parecida.
create or replace function dom_captura_resposta_equipe()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_pergunta text;
begin
  if new.direction <> 'outbound'
     or new.phone is null
     or new.phone not like '1203%'
     or length(new.phone) <= 15
     or not dom_resposta_aproveitavel(new.message_text, new.action_source, new.campaign_id) then
    return new;
  end if;

  if not exists (select 1 from dom_grupos_com_caso c where c.group_jid = new.phone) then
    return new;
  end if;

  select m.message_text into v_pergunta
  from whatsapp_messages m
  where m.instance_name = new.instance_name
    and m.phone = new.phone
    and m.direction = 'inbound'
    and m.message_text is not null
    and length(btrim(m.message_text)) >= 8
    and m.created_at < new.created_at
    and m.created_at > new.created_at - interval '6 hours'
  order by m.created_at desc
  limit 1;

  if v_pergunta is null or not dom_par_util(v_pergunta, new.message_text) then
    return new;
  end if;

  insert into dom_qa_pares (resposta_id, group_jid, pergunta, resposta, respondido_em, origem)
  values (new.id, new.phone, v_pergunta, new.message_text, new.created_at, 'equipe')
  on conflict (resposta_id) do nothing;

  return new;
exception when others then
  -- O acervo nunca pode derrubar a gravação de uma mensagem.
  return new;
end
$$;

drop trigger if exists trg_dom_captura_resposta on whatsapp_messages;
create trigger trg_dom_captura_resposta
  after insert on whatsapp_messages
  for each row execute function dom_captura_resposta_equipe();

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------

alter table dom_grupos_piloto       enable row level security;
alter table dom_respostas_pendentes enable row level security;
alter table dom_qa_pares            enable row level security;
alter table dom_grupos_com_caso     enable row level security;

drop policy if exists dom_piloto_rw on dom_grupos_piloto;
create policy dom_piloto_rw on dom_grupos_piloto
  for all to authenticated using (true) with check (true);

drop policy if exists dom_pendentes_rw on dom_respostas_pendentes;
create policy dom_pendentes_rw on dom_respostas_pendentes
  for all to authenticated using (true) with check (true);

drop policy if exists dom_grupos_com_caso_ro on dom_grupos_com_caso;
create policy dom_grupos_com_caso_ro on dom_grupos_com_caso
  for select to authenticated using (true);

-- dom_qa_pares guarda conversa de cliente em texto puro. Nenhuma policy para
-- `authenticated`, de propósito: acesso só pela RPC dom_respostas_parecidas
-- (security definer, que mascara PII) ou pelo service_role das edge functions.

-- ---------------------------------------------------------------------------
-- 8. Operação
-- ---------------------------------------------------------------------------
--
-- a) Carga do acervo (feita em 21/08/2026: 481 grupos, 4.068 pares úteis):
--
--      select dom_refresh_grupos_com_caso();      -- 481 grupos com caso
--      select * from dom_backfill_lote(150);      -- repetir até grupos = 0
--      select dom_refresh_lexemas_comuns(5.0);    -- 47 lexemas ignorados
--
--    Reexecutar dom_refresh_lexemas_comuns periodicamente conforme o acervo
--    cresce, e dom_refresh_grupos_com_caso quando entrarem processos novos.
--
-- b) Escolher os grupos do piloto (10 a 20):
--
--      insert into dom_grupos_piloto (group_jid, group_name, lead_id, modo)
--      values ('120363409273118609', 'CASO 378 — Diany x OMEGA', '<lead_id>', 'hibrido');
--
-- c) Ligar o agente — UPDATE na TABELA, não na view (a view não é atualizável):
--
--      update wjia_command_shortcuts
--         set contexto_processual = true, is_active = true
--       where id = 'd6ad8eee-d6a3-452c-b852-b94ef8dd54bf';  -- DOM-Atendente Processual
--
--    A assinatura "_🤖 Dom — Assessor Jurídico Virtual_" sai automaticamente
--    para quem tem contexto_processual ligado; não depende de sign_messages,
--    que a view devolve como false fixo.
--
-- d) O base_prompt do agente ainda manda "Extraia do histórico todos os dados
--    do(s) processo(s)" e "Nunca peça o número do processo". As duas viram
--    mentira quando o bloco de andamento passa a existir, e instrução
--    contraditória faz o modelo escolher sozinho qual seguir. Remover as duas.
