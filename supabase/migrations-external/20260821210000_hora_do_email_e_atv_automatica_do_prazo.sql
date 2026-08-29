-- ============================================================================
-- Duas coisas que o sino não sabia responder.
-- Banco alvo: Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- 1) "QUE HORAS ISSO CHEGOU?"
--    O card do sino mostra a data da movimentação (que é a data do tribunal) e
--    nada sobre o e-mail que trouxe a notícia. Quem olha às 17h não consegue
--    distinguir o que entrou agora do que entrou às 6h da manhã — e essa é
--    exatamente a diferença entre "já vi isso" e "isso é novo".
--    process_updates passa a guardar de qual e-mail a linha nasceu e a que
--    horas esse e-mail caiu na caixa.
--
-- 2) "E O QUE NINGUÉM CLICOU?"
--    Até aqui, a atividade da movimentação só nascia quando alguém apertava
--    "Criar atv" ou "Notificar". Movimentação que ninguém abriu não virava
--    nada — e prazo não espera clique. Decisão do Raym (21/08/2026): as
--    categorias que fazem PERDER PRAZO (prazo/intimação, audiência, perícia,
--    decisão de mérito) passam a gerar atividade sozinhas, no nome do
--    responsável processual do lead, com prazo no dia útil seguinte.
--    Movimentação comum continua só no feed.
--
-- POR QUE GATILHO NO BANCO, E NÃO NA EDGE:
--    process_updates é alimentada por DOIS caminhos (sync-email-push, de graça
--    e em minutos; e a captura do Escavador, paga e mais lenta). Um gatilho
--    pega os dois com uma implementação só. Na edge seriam duas.
--
-- VOLUME AFERIDO ANTES DE LIGAR (21/08/2026, 7 dias):
--    220 movimentações dessas 4 categorias, espalhadas por 12 responsáveis —
--    o maior deles com 61 na semana (~9/dia). Com a deduplicação por processo
--    e dia (abaixo), 21/08 teria gerado 33 atividades, não 70.
--
-- Rollback:
--   drop trigger if exists trg_atv_automatica_do_prazo on public.process_updates;
--   drop function if exists public.jm_atv_automatica_do_prazo();
--   drop function if exists public.jm_proximo_dia_util(date);
--   drop view if exists public.vw_jm_email_varredura;
--   alter table public.process_updates
--     drop column if exists email_message_id,
--     drop column if exists email_recebido_em;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) De qual e-mail a movimentação veio, e a que horas ele chegou
-- ---------------------------------------------------------------------------
alter table public.process_updates
  add column if not exists email_message_id text,
  add column if not exists email_recebido_em timestamptz;

comment on column public.process_updates.email_message_id is
  'processual_emails.gmail_message_id do push que originou esta linha. Null nas linhas do Escavador e nas anteriores a 21/08/2026.';
comment on column public.process_updates.email_recebido_em is
  'Hora em que o e-mail do tribunal caiu na caixa (processual_emails.received_at). É o "que horas isso chegou" do card do sino — created_at responde outra pergunta: que horas a varredura processou.';

-- A pergunta do card é "desta linha, que horas chegou" — sempre por id. Índice
-- só onde há valor, que é a metade email_push da tabela.
create index if not exists process_updates_email_recebido_idx
  on public.process_updates (email_recebido_em desc)
  where email_recebido_em is not null;

-- Backfill do que dá para saber com certeza: e-mail com CNJ único casado com o
-- processo, na janela em que a linha do feed nasceu. Sem chute — linha que não
-- casa fica null e o card mostra a hora da captura, dizendo que é dela.
with escolha as (
  -- distinct on: o mesmo processo pode ter recebido dois pushes na janela.
  -- Vale o mais recente antes da linha nascer, que é o que a captura leu.
  select distinct on (u.id)
         u.id as update_id, e.gmail_message_id, e.received_at
    from public.process_updates u
    join public.lead_processes p on p.id = u.process_id
    join public.processual_emails e
      on regexp_replace(p.process_number, '\D', '', 'g')
       = regexp_replace(e.process_number, '\D', '', 'g')
   where u.origem = 'email_push'
     and u.email_recebido_em is null
     and e.deleted_at is null
     -- Os dois lados precisam ser CNJ de verdade. Sem isto, número vazio de um
     -- lado normaliza para '' e casa com número vazio do outro — o que grudaria
     -- o e-mail de qualquer processo em processo sem número cadastrado.
     and length(regexp_replace(e.process_number, '\D', '', 'g')) = 20
     and length(regexp_replace(p.process_number, '\D', '', 'g')) = 20
     -- A varredura processa o e-mail depois de recebê-lo, nunca antes; 12h de
     -- folga cobrem a fila mais lenta sem alcançar o push do dia anterior.
     and e.received_at between u.created_at - interval '12 hours' and u.created_at
   order by u.id, e.received_at desc
)
update public.process_updates u
   set email_message_id  = c.gmail_message_id,
       email_recebido_em = c.received_at
  from escolha c
 where c.update_id = u.id;

-- ---------------------------------------------------------------------------
-- 2) Quando a caixa foi varrida pela última vez
-- ---------------------------------------------------------------------------
-- O sino mostra o que chegou. Sem isto não dá para distinguir "não chegou
-- nada" de "faz seis horas que ninguém olha a caixa" — que foi o que passou
-- despercebido entre 09/07 e 11/08/2026 na fila do Escavador.
create or replace view public.vw_jm_email_varredura as
select
  (select max(created_at)   from public.processual_emails)      as ultima_varredura,
  (select max(received_at)  from public.processual_emails)      as ultimo_email_recebido,
  (select max(processado_em) from public.email_push_processados) as ultimo_push_processado,
  (select count(*) from public.processual_emails e
    where e.deleted_at is null
      and not exists (select 1 from public.email_push_processados x
                       where x.message_id = e.gmail_message_id)) as na_fila;

comment on view public.vw_jm_email_varredura is
  'Uma linha: quando a caixa processual foi varrida por último (gmail-processual-sync), quando o e-mail mais novo chegou, quando o push foi processado (sync-email-push) e quantos e-mails ainda não passaram pelo parser.';

grant select on public.vw_jm_email_varredura to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Dia útil seguinte
-- ---------------------------------------------------------------------------
-- "No dia seguinte" com prazo caindo em sábado é prazo que ninguém abre. Não
-- entra feriado aqui de propósito: feriado forense varia por tribunal e o
-- cadastro não existe — errar para MAIS cedo é o lado seguro do erro.
create or replace function public.jm_proximo_dia_util(p_base date)
returns date
language sql
immutable
as $function$
  select case extract(isodow from p_base + 1)
           when 6 then p_base + 3   -- sábado  -> segunda
           when 7 then p_base + 2   -- domingo -> segunda
           else p_base + 1
         end;
$function$;

comment on function public.jm_proximo_dia_util(date) is
  'Dia útil seguinte a p_base (pula sábado e domingo; não conhece feriado forense).';

-- ---------------------------------------------------------------------------
-- 4) A atividade que nasce sozinha
-- ---------------------------------------------------------------------------
create or replace function public.jm_atv_automatica_do_prazo()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_dono         uuid;
  v_dono_nome    text;
  v_lead_nome    text;
  v_board        uuid;
  v_prazo        date;
  v_titulo       text;
begin
  -- Só o que faz perder prazo. 'movimentacao' e 'despacho' continuam só no
  -- feed: juntada de petição virando atividade soterraria a fila de todo mundo
  -- (1.455 movimentações comuns em 30 dias, contra 323 destas quatro).
  if new.categoria not in ('prazo', 'audiencia', 'pericia', 'decisao_merito') then
    return new;
  end if;

  -- Sem lead não há dono nem cliente — a linha existe para o feed e para o
  -- alerta de cadastro faltando, não para virar tarefa de ninguém.
  if new.lead_id is null then
    return new;
  end if;

  -- Notícia velha não vira tarefa. Sem esta guarda, um backfill da caixa (ou a
  -- releitura de 2.819 e-mails) despejaria centenas de atividades de meses
  -- atrás na fila de quem já tem 11.957 pendentes.
  if new.data_movimentacao is not null
     and new.data_movimentacao < (current_date - 7) then
    return new;
  end if;

  -- Dono do processo, na ordem que o Raym escolheu (21/08/2026):
  --   responsável processual do lead -> responsável de notificações do quadro.
  -- O passo aberto do POP fica de fora aqui de propósito: ler o passo exige
  -- percorrer lead_steps/templates, e um gatilho de INSERT não é lugar para
  -- isso. Quem abre pelo sino continua vendo o responsável do passo sugerido
  -- no formulário, e pode trocar antes de salvar.
  -- O cast é obrigatório: lead_processes.workflow_id é TEXT e leads.board_id é
  -- UUID. O coalesce direto estoura "COALESCE types text and uuid cannot be
  -- matched" — e o EXCEPTION lá embaixo engole o erro, então a atividade
  -- simplesmente não nasceria, sem nada na tela. Foi o que o primeiro teste do
  -- gatilho pegou (21/08/2026).
  select l.processual_responsible_id,
         l.lead_name,
         coalesce(
           case when p.workflow_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                then p.workflow_id::uuid end,
           l.board_id)
    into v_dono, v_lead_nome, v_board
    from public.leads l
    left join public.lead_processes p on p.id = new.process_id
   where l.id = new.lead_id;

  if v_dono is null and v_board is not null then
    select b.notificacoes_assignee_id into v_dono
      from public.kanban_boards b where b.id = v_board;
  end if;

  -- Sem dono a atividade não nasce: atividade sem responsável some da fila de
  -- todo mundo, e o objetivo aqui é o contrário disso. O lead sem responsável
  -- processual é o problema a resolver, e ele já aparece na tela do lead.
  if v_dono is null then
    return new;
  end if;

  select pr.full_name into v_dono_nome
    from public.profiles pr where pr.user_id = v_dono;

  -- "Sempre para o outro dia": a movimentação chega hoje, a tarefa vence no
  -- próximo dia útil. É o que dá 24h de folga sobre qualquer prazo que tenha
  -- começado a correr com a intimação.
  v_prazo := public.jm_proximo_dia_util(current_date);

  -- Mesmo processo, mesmo dia, mesmo dono: uma tarefa só. Um push do PJe traz
  -- várias movimentações do mesmo processo no mesmo e-mail — sem isto, os 70
  -- movimentos de 21/08 virariam 70 tarefas para 33 processos.
  if exists (
    select 1 from public.lead_activities a
     where a.process_id = new.process_id
       and a.assigned_to = v_dono
       and a.deadline = v_prazo
       and a.status = 'pendente'
       and a.deleted_at is null
       and a.process_update_id is not null
  ) then
    return new;
  end if;

  v_titulo := coalesce(nullif(trim(new.titulo), ''), 'Movimentação') ||
              case when v_lead_nome is not null then ' — ' || v_lead_nome else '' end;

  insert into public.lead_activities (
    title, description, activity_type, priority, status,
    assigned_to, assigned_to_name,
    deadline, notification_date,
    lead_id, lead_name, case_id, process_id, process_title, workflow_id,
    process_update_id, is_system,
    current_status_notes, next_steps
  ) values (
    left(v_titulo, 200),
    concat_ws(
      E'\n\n',
      case when new.data_movimentacao is not null
           then '📌 ' || to_char(new.data_movimentacao, 'DD/MM/YYYY') end,
      nullif(new.descricao, ''),
      case when new.numero_cnj is not null then '⚖️ Processo ' || new.numero_cnj || '.' end,
      'Atividade aberta automaticamente pela captura, porque esta movimentação tem prazo.'
    ),
    -- Mesmo mapa do TIPO_ATV do sino (ProcessUpdatesBell): perícia entra como
    -- 'audiencia' porque não existe tipo 'pericia' no catálogo, e tipo fora do
    -- catálogo some dos filtros da tela de Atividades.
    case new.categoria
      when 'audiencia' then 'audiencia'
      when 'pericia'   then 'audiencia'
      when 'prazo'     then 'prazo'
      else 'tarefa'
    end,
    'alta',
    'pendente',
    v_dono, v_dono_nome,
    v_prazo, v_prazo,
    new.lead_id, v_lead_nome, new.case_id, new.process_id,
    coalesce(new.processo_titulo, new.numero_cnj), v_board,
    new.id, false,
    coalesce(new.resumo_ia, nullif(new.descricao, '')),
    'Ler a movimentação, decidir a providência e avisar o cliente.'
  );

  return new;
exception
  -- A captura NÃO PODE cair por causa da tarefa. Se a inserção falhar (tipo de
  -- atividade fora do catálogo, RLS, o que for), a movimentação entra no feed
  -- do mesmo jeito e o erro fica no log do Postgres.
  when others then
    raise warning 'jm_atv_automatica_do_prazo falhou para process_update %: %', new.id, sqlerrm;
    return new;
end;
$function$;

comment on function public.jm_atv_automatica_do_prazo() is
  'Abre atividade no nome do responsável processual do lead quando entra movimentação de prazo/audiência/perícia/decisão, com prazo no próximo dia útil. Uma por processo/dia/dono.';

drop trigger if exists trg_atv_automatica_do_prazo on public.process_updates;
create trigger trg_atv_automatica_do_prazo
  after insert on public.process_updates
  for each row execute function public.jm_atv_automatica_do_prazo();
