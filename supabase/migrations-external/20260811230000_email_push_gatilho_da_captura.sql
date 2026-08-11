-- =============================================================================
-- E-mail de push dos tribunais como GATILHO da captura paga.
-- Banco alvo: Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- O CUSTO É O MOTIVO (ver jm_esc_rotina, 20260811163000):
--   R$ 0,20 por processo; 329 processos = R$ 65,80 por varredura completa.
--   Reconsultar todo mundo todo dia daria ~R$ 1.974/mês, e por isso a rotina
--   nasceu sem cron de reabertura — a frequência ficou como decisão do usuário.
--
-- A decisão (Raym, 11/08/2026): quem diz o que reconsultar passa a ser o e-mail.
-- Os tribunais mandam push de graça, em minutos — ~200 e-mails em 20 dias na
-- caixa processual@ — e o número CNJ vem no assunto ou no corpo. A edge
-- sync-email-push lê esses e-mails, alimenta o feed do sino sem custo nenhum e
-- chama jm_esc_reabrir_por_cnj SÓ para os processos que de fato mexeram.
-- Deixa de ser "R$ 65,80 por varredura" e passa a ser "R$ 0,20 x o que moveu".
--
-- Rollback:
--   drop function if exists public.jm_esc_reabrir_por_cnj(text[]);
--   drop table if exists public.email_push_processados;
--   alter table public.process_updates drop column if exists origem;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) De onde veio cada linha do feed do sino
-- ---------------------------------------------------------------------------
alter table public.process_updates
  add column if not exists origem text not null default 'escavador';

comment on column public.process_updates.origem is
  'escavador (sync-process-compromissos) ou email_push (sync-email-push). O e-mail chega antes e de graça; o Escavador traz o detalhe depois.';

create index if not exists process_updates_origem_idx
  on public.process_updates (origem);

-- ---------------------------------------------------------------------------
-- 2) E-mails já processados — a caixa não se esvazia sozinha
-- ---------------------------------------------------------------------------
create table if not exists public.email_push_processados (
  message_id text primary key,
  processado_em timestamptz not null default now(),
  remetente text,
  assunto text,
  -- Quantas movimentações o parser extraiu e quantos processos casaram com o
  -- cadastro. movimentacoes > 0 e casados = 0 significa push de processo que
  -- não está na base — é o sinal de cadastro faltando, não de erro.
  movimentacoes integer not null default 0,
  casados integer not null default 0
);

create index if not exists email_push_processados_em_idx
  on public.email_push_processados (processado_em desc);

alter table public.email_push_processados enable row level security;

create policy "Authenticated users can view processed push emails"
  on public.email_push_processados for select
  to authenticated
  using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- 3) Reabertura SELETIVA da fila do Escavador
-- ---------------------------------------------------------------------------
-- Este é o único ponto do fluxo do e-mail que gasta dinheiro. Recebe os CNJs
-- que tiveram push e devolve quantas linhas foram reabertas — que multiplicado
-- por R$ 0,20 é exatamente a conta do dia.
create or replace function public.jm_esc_reabrir_por_cnj(p_cnjs text[])
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reabertos integer := 0;
  v_novos integer := 0;
begin
  if p_cnjs is null or array_length(p_cnjs, 1) is null then
    return 0;
  end if;

  -- Só linhas fechadas voltam para a fila. Quem está em A_ENVIAR/ENVIANDO/
  -- PENDENTE já vai ser consultado neste ciclo — reabrir de novo pagaria duas
  -- vezes pelo mesmo processo.
  with alvo as (
    select unnest(p_cnjs) as cnj
  ),
  reabertos as (
    update public.jm_esc_solicitacoes s
       set status = 'A_ENVIAR',
           criado_em = now(),
           concluido_em = null,
           motivo_erro = null,
           escavador_id = null
      from alvo a
     where regexp_replace(s.processo_cnj, '\D', '', 'g') = regexp_replace(a.cnj, '\D', '', 'g')
       and s.status in ('SUCESSO', 'ERRO')
    returning s.id
  )
  select count(*) into v_reabertos from reabertos;

  -- Processo que tem push mas nunca entrou na fila entra agora.
  insert into public.jm_esc_solicitacoes (processo_cnj, status, criado_em)
  select distinct a.cnj, 'A_ENVIAR', now()
    from unnest(p_cnjs) as a(cnj)
   where not exists (
     select 1 from public.jm_esc_solicitacoes s
      where regexp_replace(s.processo_cnj, '\D', '', 'g') = regexp_replace(a.cnj, '\D', '', 'g')
   );
  get diagnostics v_novos = row_count;

  return v_reabertos + v_novos;
end;
$function$;

comment on function public.jm_esc_reabrir_por_cnj(text[]) is
  'Reabre no Escavador APENAS os processos com push de e-mail no dia (chamada por sync-email-push). Cada linha reaberta custa R$ 0,20.';

-- ---------------------------------------------------------------------------
-- 4) Agendamento — NÃO aplicado junto de propósito
-- ---------------------------------------------------------------------------
-- Rodar de hora em hora só faz sentido depois de (a) a edge sync-email-push
-- estar publicada e (b) a conta do Google ser reconectada com o escopo
-- gmail.readonly. Antes disso a função roda e não acha e-mail nenhum.
--
-- Aferição feita em 11/08/2026 sobre o push real de 2 dias, para dimensionar:
--   30 processos com push  →  26 estão cadastrados  →  ~13 por dia
--   13 x R$ 0,20 = R$ 2,60/dia (~R$ 78/mês)
--   contra R$ 65,80 por varredura completa (~R$ 1.974/mês se fosse diária)
-- Os 4 que não casaram são processos sem cadastro — aparecem em
-- email_push_processados com movimentacoes > 0 e casados = 0.
--
-- Quando for a hora:
--   select cron.schedule(
--     'sync-email-push-horario',
--     '5 * * * *',
--     $$
--     select net.http_post(
--       url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-email-push',
--       headers := jsonb_build_object('Content-Type','application/json',
--         'Authorization','Bearer <anon key do projeto>'),
--       body := '{"dias": 1, "limite": 100}'::jsonb,
--       timeout_milliseconds := 120000
--     )
--     $$
--   );
