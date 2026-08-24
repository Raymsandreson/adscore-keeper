-- =============================================================================
-- O E-MAIL VIRA A QUINTA FONTE DE MARCO
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- POR QUE (24/08/2026). A régua já lê quatro fontes — DataJud (TPU), documento,
-- Escavador (texto/grau) e a capa do processo. E-mail não. Medido nesta data:
--
--   processual_emails ......................... 6.382 (6.352 com corpo)
--   views de marco que leem essa tabela ....... ZERO
--   e-mails do INSS (noreply@inss.gov.br) ..... 1.165
--     └─ com bloco estruturado ............... 1.135 (97,4%)
--        Concluída 308 · Exigência 261 · Em Análise 84 · Cancelada 45
--        · Pendente 36 · "Requerimento realizado com sucesso" 401
--
-- O POP - BPC - Administrativo é alimentado por e-mail por natureza, e as suas
-- três primeiras fases (Triagem, CadÚnico, Protocolo/Análise INSS) tinham ZERO
-- marco e ZERO sinal. 733 mudanças de status do INSS estavam paradas na caixa
-- de entrada sem mover régua nenhuma.
--
-- O E-MAIL DO INSS NÃO PRECISA DE IA. Ele é estruturado:
--     Prezado(a) Sr(a) NOME ,
--     Protocolo : 1113540276
--     Serviço : BENEFÍCIO ASSISTENCIAL À PESSOA COM DEFICIÊNCIA
--     Data do Protocolo : 17/06/2026
--     Unidade responsável : ...
--     Status atual : CONCLUÍDA
--     Despacho: <o motivo, e é ele que separa concessão de indeferimento>
-- Extração determinística cobre 1.135 de 1.165. Os 30 restantes são
-- "Cancelamento de Agendamento" (28) e dois e-mails escritos por gente.
--
-- O QUE ESTAVA FALTANDO DE VERDADE: A CHAVE.
-- O e-mail do INSS não tem CNJ. Tem PROTOCOLO — e não existia campo de
-- protocolo em lead_processes. As alternativas foram medidas e reprovadas:
--   leads.cpf ......... preenchido em 673 de 21.425 leads
--   leads.lead_name ... é o título do card ("PREV 1556 | ... - KAROLYNE"),
--                       não o nome do segurado: 0 de 1.127 casaram
--   contacts.full_name  78 de 522 nomes distintos (15%)
-- Casar por nome seria chute com convicção. Esta migration cria a chave certa
-- (protocolo_administrativo) e uma FILA de vínculo para o passado; o presente
-- passa a se ligar sozinho assim que o protocolo é anotado uma vez.
--
-- POR QUE OS MARCOS NOVOS NASCEM eventual = TRUE. O denominador do percentual
-- conta marco obrigatório + eventual atingido (pop_processo_regua). Marco
-- administrativo obrigatório entraria no denominador dos 842 processos do POP
-- e derrubaria o percentual de todo mundo que já está na fase judicial. Como
-- eventual, ele só passa a contar em quem de fato o atingiu — e enquanto
-- nenhum protocolo estiver vinculado, NADA muda na tela.
--
-- REVERSÃO (nesta ordem):
--   drop function if exists public.inss_vincular_protocolo(uuid, text);
--   drop view if exists public.vw_inss_requerimento_sem_dono;
--   drop view if exists public.vw_pop_marcos_email;
--   drop function if exists public.refresh_inss_requerimentos();
--   drop table if exists public.inss_requerimento_eventos;
--   delete from public.pop_marco_sinais where tipo = 'email';
--   delete from public.pop_marcos
--    where board_id = '8377ee1b-97a2-4777-9b51-3af9e630b3c6'
--      and chave in ('requerimento_protocolado','analise_administrativa',
--                    'concessao_administrativa','indeferimento_administrativo',
--                    'exigencia_administrativa','requerimento_cancelado');
--   -- e devolver as ordens do board: 11..24 -> 1..14, 40 -> 20, 41 -> 21
--   alter table public.pop_marco_sinais
--     drop column campo_email, drop column email_status, drop column email_servico;
--   alter table public.lead_processes drop column protocolo_administrativo;
--   -- e recriar refresh_process_pop_marcos com a definição de 20260812191000
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. A CHAVE. Protocolo administrativo no processo.
--
-- Guardado como veio; toda comparação normaliza para dígitos, do mesmo jeito
-- que o CNJ já é comparado na régua.
-- ---------------------------------------------------------------------------
alter table public.lead_processes
  add column if not exists protocolo_administrativo text;

create index if not exists idx_lead_processes_protocolo_adm
  on public.lead_processes (regexp_replace(coalesce(protocolo_administrativo,''), '[^0-9]', '', 'g'))
  where protocolo_administrativo is not null;

comment on column public.lead_processes.protocolo_administrativo is
  'Protocolo do requerimento administrativo (INSS). E a chave que liga o e-mail ao processo: o e-mail do INSS nao traz CNJ. Anotado uma vez, todo e-mail futuro daquele protocolo vira marco sozinho.';

-- ---------------------------------------------------------------------------
-- 2. O e-mail do INSS decomposto — append-only, uma linha por e-mail
--
-- Tabela e não view: a extração custa regex sobre 6.382 corpos e a régua roda
-- de 30 em 30 minutos. Mesma decisão de process_pop_marcos.
--
-- email_id como chave natural: o push do Gmail reentrega e-mail, e sem isso o
-- mesmo "Exigência" viraria dois eventos.
-- ---------------------------------------------------------------------------
create table if not exists public.inss_requerimento_eventos (
  id               uuid primary key default gen_random_uuid(),
  email_id         uuid not null references public.processual_emails(id) on delete cascade,
  gmail_message_id text,

  protocolo        text not null,          -- só dígitos
  nome_segurado    text,
  servico          text,                   -- 'BENEFÍCIO ASSISTENCIAL À PESSOA COM DEFICIÊNCIA'
  unidade          text,

  -- 'protocolo' = "Requerimento realizado com sucesso" (não traz Status atual)
  -- 'status'    = "O status do requerimento N foi alterado para X"
  tipo_evento      text not null check (tipo_evento in ('protocolo','status')),
  status           text,                   -- CONCLUÍDA | EXIGÊNCIA | EM ANÁLISE | CANCELADA | PENDENTE
  despacho         text,                   -- é ele que separa concessão de indeferimento

  data_protocolo   date,
  data_evento      date not null,
  received_at      timestamptz not null,
  criado_em        timestamptz not null default now(),

  constraint inss_requerimento_eventos_email_unico unique (email_id)
);

create index if not exists idx_inss_req_protocolo on public.inss_requerimento_eventos (protocolo, data_evento);
create index if not exists idx_inss_req_servico   on public.inss_requerimento_eventos (servico);
create index if not exists idx_inss_req_status    on public.inss_requerimento_eventos (status);

alter table public.inss_requerimento_eventos enable row level security;
drop policy if exists inss_requerimento_eventos_all on public.inss_requerimento_eventos;
-- Sessão do Externo é anônima (signInAnonymously): policy por auth.uid()
-- devolveria zero linha em silêncio.
create policy inss_requerimento_eventos_all on public.inss_requerimento_eventos
  for all to authenticated using (true) with check (true);

comment on table public.inss_requerimento_eventos is
  'E-mail do INSS decomposto em campos. Extracao deterministica por regex - o corpo do e-mail do INSS e estruturado e nao precisa de IA. Uma linha por e-mail.';

-- ---------------------------------------------------------------------------
-- 3. A extração
--
-- Cuidados que custaram medição:
--   - o nome para na PRIMEIRA vírgula ([^,]{3,120}?): sem isso o grupo engolia
--     o corpo inteiro (786 caracteres no primeiro teste);
--   - "Data do Protocolo : Optional[18/06/2026]" — o INSS às vezes serializa o
--     Optional do Java direto no e-mail;
--   - o despacho vai até o fim do corpo. Recortar em 255 caracteres escondia o
--     veredito: 165 indeferimentos anunciam a negativa depois disso.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_inss_requerimentos()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare v_linhas integer;
begin
  with lido as (
    select
      e.id as email_id,
      e.gmail_message_id,
      e.received_at,
      regexp_replace(substring(e.body_text from 'Protocolo\s*:\s*([0-9]{6,20})'), '[^0-9]', '', 'g') as protocolo,
      btrim(substring(e.body_text from 'Prezado\(a\) Sr\(a\)\s+([^,]{3,120}?)\s*,'))                 as nome_segurado,
      btrim(substring(e.body_text from 'Serviço\s*:\s*(.{3,120}?)\s+Data do Protocolo'))             as servico,
      btrim(substring(e.body_text from 'Unidade responsável\s*:\s*(.{3,120}?)\s+(?:Status atual|O atendimento|É possível)')) as unidade,
      btrim(substring(e.body_text from 'Status atual\s*:\s*([A-ZÀ-Úa-zà-ú ]{3,40}?)\s*(?:Despacho|$)')) as status,
      btrim(substring(e.body_text from 'Despacho:(.*)$'))                                            as despacho,
      to_date(substring(e.body_text from 'Data do Protocolo\s*:\s*(?:Optional\[)?([0-9]{2}/[0-9]{2}/[0-9]{4})'), 'DD/MM/YYYY') as data_protocolo
    from public.processual_emails e
    where e.deleted_at is null
      and e.from_addr ilike '%inss.gov.br%'
      and e.body_text is not null
  ),
  valido as (
    select l.*,
           case when l.status is null or btrim(l.status) = '' then 'protocolo' else 'status' end as tipo_evento
    from lido l
    where l.protocolo is not null and length(l.protocolo) >= 6
  )
  insert into public.inss_requerimento_eventos
    (email_id, gmail_message_id, protocolo, nome_segurado, servico, unidade,
     tipo_evento, status, despacho, data_protocolo, data_evento, received_at)
  select
    v.email_id, v.gmail_message_id, v.protocolo, v.nome_segurado, upper(v.servico), v.unidade,
    v.tipo_evento,
    nullif(upper(v.status), ''),
    nullif(v.despacho, ''),
    v.data_protocolo,
    -- O e-mail de protocolo carrega a data do ato; o de status chega no dia.
    case when v.tipo_evento = 'protocolo'
         then coalesce(v.data_protocolo, v.received_at::date)
         else v.received_at::date end,
    v.received_at
  from valido v
  on conflict (email_id) do update
    set protocolo      = excluded.protocolo,
        nome_segurado  = excluded.nome_segurado,
        servico        = excluded.servico,
        unidade        = excluded.unidade,
        tipo_evento    = excluded.tipo_evento,
        status         = excluded.status,
        despacho       = excluded.despacho,
        data_protocolo = excluded.data_protocolo,
        data_evento    = excluded.data_evento;

  get diagnostics v_linhas = row_count;
  return v_linhas;
end $fn$;

grant execute on function public.refresh_inss_requerimentos() to authenticated, anon, service_role;

comment on function public.refresh_inss_requerimentos() is
  'Le processual_emails do INSS e materializa os campos em inss_requerimento_eventos. Idempotente por email_id.';

-- ---------------------------------------------------------------------------
-- 4. O sinal de e-mail
--
-- Mesma gramática dos sinais que já existem: `padrao` e `padrao_excluir` são
-- REGEX POSIX aplicadas sobre o texto em minúsculas — igual ao sinal 'texto'
-- do Escavador. Novidade: onde casar.
--
--   campo_email  = 'despacho' | 'status' | 'servico' | 'assunto' | 'evento'
--   email_status = exige este Status atual (opcional, igualdade)
--   email_servico= exige este Serviço     (opcional, regex)
--
-- Os dois filtros existem porque "concedido" e "indeferido" chegam no MESMO
-- status (CONCLUÍDA) e só se distinguem pelo despacho. Um sinal com
-- campo_email='despacho' e email_status='CONCLUÍDA' diz exatamente isso.
-- ---------------------------------------------------------------------------
alter table public.pop_marco_sinais drop constraint if exists pop_marco_sinais_tipo_check;
alter table public.pop_marco_sinais
  add constraint pop_marco_sinais_tipo_check check (tipo in ('tpu','texto','documento','grau','email'));

alter table public.pop_marco_sinais add column if not exists campo_email   text;
alter table public.pop_marco_sinais add column if not exists email_status  text;
alter table public.pop_marco_sinais add column if not exists email_servico text;

alter table public.pop_marco_sinais drop constraint if exists pop_marco_sinais_campo_email_check;
alter table public.pop_marco_sinais
  add constraint pop_marco_sinais_campo_email_check check (
    campo_email is null or campo_email in ('despacho','status','servico','assunto','evento')
  );

-- O CHECK de coerência ganha o ramo 'email', que também exige padrao — sem ele
-- o sinal casaria com tudo. Os outros três ramos ficam LITERALMENTE como
-- estavam: 'grau' identifica-se pelo grau e as suas 20 linhas não têm padrao;
-- reescrever o check sem esse ramo derrubaria a migration na validação.
alter table public.pop_marco_sinais drop constraint if exists pop_marco_sinais_coerente;
alter table public.pop_marco_sinais add constraint pop_marco_sinais_coerente check (
  (tipo = 'tpu'  and codigo is not null)
  or (tipo = 'grau' and grau is not null)
  or (tipo in ('texto','documento','email')
      and padrao is not null and length(btrim(padrao)) > 0)
);

comment on column public.pop_marco_sinais.campo_email is
  'Sinal tipo=email: em qual campo do e-mail casar o padrao. despacho | status | servico | assunto | evento.';
comment on column public.pop_marco_sinais.email_status is
  'Sinal tipo=email: exige este "Status atual" do INSS. Concessao e indeferimento chegam ambos como CONCLUIDA e so o despacho separa.';
comment on column public.pop_marco_sinais.email_servico is
  'Sinal tipo=email: regex que o campo Servico do INSS precisa casar. Impede o POP de capturar e-mail de outro beneficio.';
