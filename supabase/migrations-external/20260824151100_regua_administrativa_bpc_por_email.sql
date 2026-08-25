-- =============================================================================
-- A RÉGUA ADMINISTRATIVA DO BPC, LIDA DO E-MAIL DO INSS
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
-- Depende de: 20260824151000_email_vira_fonte_de_marco.sql
--
-- O POP - BPC - Administrativo (8377ee1b) tem 5 fases. As três primeiras são o
-- ciclo administrativo inteiro — Triagem, CadÚnico, Protocolo/Análise INSS — e
-- estavam com ZERO marco e ZERO sinal. A régua desse POP só sabia falar de
-- processo judicial: ajuizamento em diante. O resultado é que 548 dos 842
-- processos do POP (os que não têm CNJ nenhum, porque ainda são requerimento
-- administrativo) eram invisíveis para a régua POR CONSTRUÇÃO —
-- refresh_process_pop_marcos exigia CNJ com 15 dígitos.
--
-- RENUMERAÇÃO. Os marcos judiciais ocupavam 1..14 e não havia espaço ANTES do
-- ajuizamento. Marco administrativo com ordem maior que a do ajuizamento
-- quebraria as duas coisas que leem ordem: o "presumido" de pop_processo_regua
-- e o "marco mais adiantado" de aplicar_fase_por_marco — um protocolo do INSS
-- passaria na frente de uma sentença. Por isso o judicial desce para 11..24 e
-- os estados vão para 40+. A unique (board_id, ordem) é DEFERRABLE INITIALLY
-- DEFERRED exatamente para permitir a troca em bloco dentro da transação.
--
-- OS MARCOS NOVOS SÃO TODOS eventual = true. Ver o cabeçalho da migration
-- anterior: obrigatório entraria no denominador do percentual dos 842
-- processos e derrubaria o número de quem já está na fase judicial.
--
-- E O INDEFERIMENTO APONTA PARA A FASE JUDICIAL. É o fluxo que o escritório já
-- opera na mão: o POP judicial de BPC vive dos negados do POP administrativo.
-- Detectado o indeferimento no e-mail, o processo passa para "4. Fase Judicial
-- (Caso Indeferido)" sozinho — aplicar_fase_por_marco só avança, então isso
-- nunca puxa ninguém para trás.
--
-- REVERSÃO: ver o cabeçalho de 20260824151000.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Abrir espaço: judicial 1..14 -> 11..24, estados 20/21 -> 40/41
-- ---------------------------------------------------------------------------
update public.pop_marcos pm
   set ordem = m.nova
from (values
  ('ajuizamento', 11), ('pericia', 12), ('audiencia_instrucao', 13),
  ('sentenca', 14), ('embargos_1grau', 15), ('remessa_2grau', 16),
  ('acordao_2grau', 17), ('remessa_superior', 18), ('decisao_superior', 19),
  ('transito_julgado', 20), ('execucao_iniciada', 21), ('alvara_expedido', 22),
  ('pagamento', 23), ('arquivamento_definitivo', 24),
  ('acordo_homologado', 40), ('suspensao', 41)
) as m(chave, nova)
where pm.board_id = '8377ee1b-97a2-4777-9b51-3af9e630b3c6'
  and pm.chave = m.chave;

-- ---------------------------------------------------------------------------
-- 2. A régua administrativa
--
-- exigencia e cancelamento nascem com atravessa_fases = true: são ESTADO, não
-- posição. Exigência vai e volta — tratá-la como fase faria o processo andar
-- para trás toda vez que o INSS pedisse documento, que é o erro dos 61
-- processos de julho/2026 repetido com outro nome.
-- ---------------------------------------------------------------------------
insert into public.pop_marcos
  (board_id, chave, rotulo, ordem, stage_id, eventual, terminal, atravessa_fases, descricao)
values
  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6', 'requerimento_protocolado',
   'Requerimento protocolado (INSS)', 1, 'stage_fase_administrativa',
   true, false, false,
   'E-mail "Requerimento realizado com sucesso". A data é a do protocolo, não a do e-mail.'),

  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6', 'analise_administrativa',
   'Em análise no INSS', 2, 'stage_fase_administrativa',
   true, false, false,
   'Status atual = EM ANÁLISE.'),

  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6', 'concessao_administrativa',
   'Benefício concedido pelo INSS', 3, 'stage_pos_deferimento',
   true, true, false,
   'Status CONCLUÍDA cujo despacho concede. Terminal: concedido no administrativo, o ciclo do POP acabou.'),

  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6', 'indeferimento_administrativo',
   'Indeferimento do INSS', 4, 'stage_fase_judicial',
   true, false, false,
   'Status CONCLUÍDA cujo despacho nega. É o gatilho da fase judicial — o POP judicial vive dos negados daqui.'),

  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6', 'exigencia_administrativa',
   'Exigência do INSS', 42, null,
   true, false, true,
   'ESTADO, não fase: exigência vai e volta. atravessa_fases impede que o processo ande para trás a cada pedido de documento.'),

  ('8377ee1b-97a2-4777-9b51-3af9e630b3c6', 'requerimento_cancelado',
   'Requerimento cancelado', 43, null,
   true, false, true,
   'ESTADO. Status atual = CANCELADA.')
on conflict (board_id, chave) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Como cada um é reconhecido no e-mail
--
-- `padrao` e `padrao_excluir` são REGEX aplicadas ao campo em MINÚSCULAS —
-- mesma gramática do sinal 'texto' do Escavador. Alternativas com e sem acento
-- porque o corpo do INSS mistura os dois.
--
-- email_servico trava o POP no benefício certo: os mesmos 1.165 e-mails
-- carregam BPC (718), salário-maternidade (178), auxílio-acidente (83) e
-- benefício por incapacidade (86). Sem esse filtro, o POP de BPC marcaria
-- exigência de pensão por morte.
--
-- A ARMADILHA DO "CONCLUÍDA": concessão e indeferimento chegam no MESMO status
-- e só o despacho separa. Medido em 24/08/2026 sobre as 308 conclusões:
--   despacho nega ....... 250
--   despacho concede .... 31
--   indefinido .......... 27  (não geram marco — mudo é melhor que errado)
-- E o par "foi prorrogado" / "não foi prorrogado" é substring um do outro: por
-- isso a concessão carrega padrao_excluir com a negativa.
-- ---------------------------------------------------------------------------
insert into public.pop_marco_sinais
  (pop_marco_id, tipo, campo_email, email_status, email_servico, padrao, padrao_excluir,
   origem, confirmado, motivo)
select pm.id, 'email', v.campo, v.status, 'benef[íi]cio assistencial', v.padrao, v.excluir,
       'manual', false, v.motivo
from (values
  ('requerimento_protocolado', 'evento',   null,
   '^protocolo$', null,
   'e-mail "Requerimento realizado com sucesso" — o único que não traz Status atual'),

  ('analise_administrativa',   'status',   null,
   'em an[áa]lise', null,
   'Status atual = EM ANÁLISE (84 e-mails na base em 24/08/2026)'),

  ('exigencia_administrativa', 'status',   null,
   'exig[êe]ncia', null,
   'Status atual = EXIGÊNCIA (261 e-mails)'),

  ('requerimento_cancelado',   'status',   null,
   'cancelada', null,
   'Status atual = CANCELADA (45 e-mails)'),

  ('indeferimento_administrativo', 'despacho', 'CONCLUÍDA',
   'negad|indeferi|n[ãa]o foi reconhecido|n[ãa]o reconheceu|n[ãa]o foi prorrogado', null,
   'despacho da conclusão que nega — 250 das 308 conclusões medidas em 24/08/2026'),

  ('concessao_administrativa', 'despacho', 'CONCLUÍDA',
   'concedid|implantad|cr[ée]ditos autorizados|foi prorrogado|reconheceu a sua incapacidade',
   'negad|indeferi|n[ãa]o foi reconhecido|n[ãa]o reconheceu|n[ãa]o foi prorrogado',
   'despacho da conclusão que concede. padrao_excluir é obrigatório aqui: "não foi prorrogado" contém "foi prorrogado"')
) as v(chave, campo, status, padrao, excluir, motivo)
join public.pop_marcos pm
  on pm.board_id = '8377ee1b-97a2-4777-9b51-3af9e630b3c6' and pm.chave = v.chave
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. A quinta fonte: o e-mail
--
-- Devolve process_id direto — e não cnj_num como as outras quatro — porque a
-- ligação aqui é por PROTOCOLO. É o ponto todo: 548 dos 842 processos deste
-- POP não têm CNJ nenhum.
--
-- min(data_evento): mesma regra das outras fontes — a primeira vez que o sinal
-- apareceu é a data do marco. Exigência repetida não reescreve a data da
-- primeira.
-- ---------------------------------------------------------------------------
create or replace view public.vw_pop_marcos_email as
with ev as (
  select
    e.protocolo,
    e.data_evento,
    lower(coalesce(e.despacho, ''))    as despacho_l,
    lower(coalesce(e.status, ''))      as status_l,
    lower(coalesce(e.servico, ''))     as servico_l,
    lower(e.tipo_evento)               as evento_l,
    lower(coalesce(pe.subject, ''))    as assunto_l
  from public.inss_requerimento_eventos e
  join public.processual_emails pe on pe.id = e.email_id
),
proc as (
  select lp.id as process_id,
         lp.workflow_id::uuid as board_id,
         regexp_replace(coalesce(lp.protocolo_administrativo, ''), '[^0-9]', '', 'g') as protocolo
  from public.lead_processes lp
  where lp.deleted_at is null
    and lp.workflow_id is not null
    and coalesce(lp.protocolo_administrativo, '') <> ''
)
select
  p.process_id,
  p.board_id,
  pm.chave  as marco_chave,
  pm.ordem,
  pm.rotulo,
  pm.stage_id,
  min(ev.data_evento) as data_detectada,
  'email'::text       as fonte_deteccao,
  count(*)::bigint    as itens
from proc p
join ev on ev.protocolo = p.protocolo
join public.pop_marcos pm on pm.board_id = p.board_id
join public.pop_marco_sinais s on s.pop_marco_id = pm.id and s.tipo = 'email'
join lateral (
  select case coalesce(s.campo_email, 'despacho')
           when 'despacho' then ev.despacho_l
           when 'status'   then ev.status_l
           when 'servico'  then ev.servico_l
           when 'assunto'  then ev.assunto_l
           when 'evento'   then ev.evento_l
         end as texto
) c on true
where (s.email_status  is null or lower(s.email_status) = ev.status_l)
  and (s.email_servico is null or ev.servico_l ~ lower(s.email_servico))
  and c.texto ~ lower(s.padrao)
  and (s.padrao_excluir is null or c.texto !~ lower(s.padrao_excluir))
group by p.process_id, p.board_id, pm.chave, pm.ordem, pm.rotulo, pm.stage_id;

comment on view public.vw_pop_marcos_email is
  'Quinta fonte de marco: e-mail do INSS decomposto, ligado ao processo pelo protocolo administrativo. Devolve process_id (nao cnj_num) porque requerimento administrativo nao tem CNJ.';

-- ---------------------------------------------------------------------------
-- 5. A régua passa a somar as cinco fontes
--
-- Duas mudanças em refresh_process_pop_marcos:
--   1. `alvo` aceita processo SEM CNJ desde que tenha protocolo administrativo.
--      Sem isso os 548 requerimentos puros continuavam fora — e, pior, o DELETE
--      de recálculo também não os alcançava, então marco de e-mail entraria e
--      nunca mais sairia.
--   2. o e-mail entra como prioridade 2. A régua por CNJ (movimentação,
--      documento, Escavador, capa) VENCE o e-mail no mesmo marco: o e-mail do
--      INSS avisa a decisão administrativa, os autos provam o ato judicial.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_process_pop_marcos(p_process_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare v_linhas integer;
begin
  with alvo as (
    select lp.id as process_id,
           lp.workflow_id::uuid as board_id,
           regexp_replace(coalesce(lp.process_number, ''), '[^0-9]', '', 'g') as cnj_num
    from public.lead_processes lp
    where lp.deleted_at is null
      and lp.workflow_id is not null
      and (
        length(regexp_replace(coalesce(lp.process_number, ''), '[^0-9]', '', 'g')) >= 15
        or coalesce(lp.protocolo_administrativo, '') <> ''
      )
      and (p_process_id is null or lp.id = p_process_id)
  ),
  candidatos as (
    select a.process_id, r.board_id, r.marco_chave, r.ordem, r.rotulo, r.stage_id,
           r.data_detectada, r.fonte_deteccao, r.tem_prova_documental, 1 as prioridade
    from alvo a
    join public.vw_pop_marcos_regua r
      on r.cnj_num = a.cnj_num and r.board_id = a.board_id
    where length(a.cnj_num) >= 15
    union all
    select e.process_id, e.board_id, e.marco_chave, e.ordem, e.rotulo, e.stage_id,
           e.data_detectada, e.fonte_deteccao, false, 2
    from public.vw_pop_marcos_email e
    join alvo a on a.process_id = e.process_id
  ),
  novos as (
    select distinct on (process_id, marco_chave)
           process_id, board_id, marco_chave, ordem, rotulo, stage_id,
           data_detectada, fonte_deteccao, tem_prova_documental
    from candidatos
    order by process_id, marco_chave, prioridade, data_detectada
  ),
  apagados as (
    delete from public.process_pop_marcos m
    using alvo a
    where m.process_id = a.process_id
    returning 1
  )
  insert into public.process_pop_marcos
    (process_id, board_id, marco_chave, ordem, rotulo, stage_id,
     data_detectada, fonte, tem_prova_documental, atualizado_em)
  select process_id, board_id, marco_chave, ordem, rotulo, stage_id,
         data_detectada, fonte_deteccao, tem_prova_documental, now()
  from novos
  on conflict (process_id, marco_chave) do update
    set ordem = excluded.ordem,
        rotulo = excluded.rotulo,
        stage_id = excluded.stage_id,
        data_detectada = excluded.data_detectada,
        fonte = excluded.fonte,
        tem_prova_documental = excluded.tem_prova_documental,
        atualizado_em = now();

  get diagnostics v_linhas = row_count;
  return v_linhas;
end $fn$;

grant execute on function public.refresh_process_pop_marcos(uuid) to authenticated, anon, service_role;

comment on function public.refresh_process_pop_marcos(uuid) is
  'Materializa as cinco fontes de marco em process_pop_marcos: regua por CNJ (DataJud, documento, Escavador, capa) e e-mail por protocolo. Sem argumento, recalcula a base inteira.';

-- ---------------------------------------------------------------------------
-- 6. A fila: requerimento do INSS que não é de ninguém
--
-- Enquanto o protocolo não estiver anotado num processo, o e-mail não vira
-- marco. Esta view é o que a tela precisa mostrar para alguém ligar os dois.
--
-- A sugestão por nome é SUGESTÃO, e fraca de propósito: leads.lead_name é o
-- título do card do kanban e casou 0 de 1.127; leads.victim_name e
-- contacts.full_name cobrem ~15%. Serve para adiantar o clique, nunca para
-- vincular sozinha.
-- ---------------------------------------------------------------------------
create or replace view public.vw_inss_requerimento_sem_dono as
with agrupado as (
  select
    ev.protocolo,
    max(ev.nome_segurado)  as nome_segurado,
    max(ev.servico)        as servico,
    min(ev.data_protocolo) as data_protocolo,
    max(ev.data_evento)    as ultimo_evento,
    count(*)               as eventos,
    (array_agg(ev.status order by ev.data_evento desc, ev.received_at desc)
       filter (where ev.status is not null))[1] as status_atual
  from public.inss_requerimento_eventos ev
  where not exists (
    select 1 from public.lead_processes lp
    where lp.deleted_at is null
      and regexp_replace(coalesce(lp.protocolo_administrativo, ''), '[^0-9]', '', 'g') = ev.protocolo
  )
  group by ev.protocolo
)
select
  a.*,
  sug.lead_id       as lead_sugerido_id,
  sug.lead_rotulo   as lead_sugerido_rotulo
from agrupado a
left join lateral (
  select l.id as lead_id, l.lead_name as lead_rotulo
  from public.leads l
  where a.nome_segurado is not null
    and upper(btrim(coalesce(l.victim_name, ''))) = upper(btrim(a.nome_segurado))
  limit 1
) sug on true;

comment on view public.vw_inss_requerimento_sem_dono is
  'Requerimentos do INSS cujo protocolo nao esta anotado em nenhum lead_process. Enquanto estiverem aqui, os e-mails deles nao viram marco. lead_sugerido e sugestao por nome (cobertura ~15%), nunca vinculo automatico.';

-- ---------------------------------------------------------------------------
-- 7. Ligar um protocolo a um processo, e já recalcular
--
-- Devolve o que aconteceu para a tela poder dizer "3 marcos entraram" em vez
-- de só "salvo".
-- ---------------------------------------------------------------------------
create or replace function public.inss_vincular_protocolo(
  p_process_id uuid,
  p_protocolo  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_protocolo text := regexp_replace(coalesce(p_protocolo, ''), '[^0-9]', '', 'g');
  v_eventos   integer;
  v_marcos    integer;
  v_fases     integer;
begin
  if length(v_protocolo) < 6 then
    raise exception 'Protocolo invalido: % (esperado ao menos 6 digitos)', p_protocolo;
  end if;

  select count(*) into v_eventos
  from public.inss_requerimento_eventos where protocolo = v_protocolo;

  update public.lead_processes
     set protocolo_administrativo = v_protocolo, updated_at = now()
   where id = p_process_id and deleted_at is null;

  if not found then
    raise exception 'Processo % nao encontrado', p_process_id;
  end if;

  v_marcos := public.refresh_process_pop_marcos(p_process_id);
  select count(*) into v_fases from public.aplicar_fase_por_marco(p_process_id);

  return jsonb_build_object(
    'protocolo', v_protocolo,
    'eventos_do_protocolo', v_eventos,
    'marcos', v_marcos,
    'fases_movidas', v_fases
  );
end $fn$;

grant execute on function public.inss_vincular_protocolo(uuid, text) to authenticated, anon, service_role;

comment on function public.inss_vincular_protocolo(uuid, text) is
  'Anota o protocolo administrativo no processo e ja recalcula a regua dele. Devolve quantos eventos aquele protocolo tinha e quantos marcos entraram.';

-- ---------------------------------------------------------------------------
-- 8. O tick passa a ler o e-mail antes de recalcular
--
-- Ordem importa: extrair o e-mail, DEPOIS materializar o marco, DEPOIS mover a
-- fase. Invertido, o marco do e-mail que chegou nesta meia hora só apareceria
-- na próxima.
-- ---------------------------------------------------------------------------
create or replace function public.pop_marcos_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_emails integer;
  v_marcos integer;
  v_fases  integer;
begin
  v_emails := public.refresh_inss_requerimentos();
  v_marcos := public.refresh_process_pop_marcos();
  select count(*) into v_fases from public.aplicar_fase_por_marco();
  return jsonb_build_object(
    'emails_inss', v_emails, 'marcos', v_marcos,
    'fases_movidas', v_fases, 'em', now()
  );
end $fn$;

grant execute on function public.pop_marcos_tick() to authenticated, anon, service_role;

comment on function public.pop_marcos_tick() is
  'Le o e-mail do INSS, recalcula os marcos de todos os processos e reposiciona as fases, nesta ordem. Chamado pelo cron pop-marcos-tick.';
