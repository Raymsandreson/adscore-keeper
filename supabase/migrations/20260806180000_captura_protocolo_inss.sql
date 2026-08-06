-- =============================================================================
-- Captura do PROTOCOLO INSS no ato: quem protocolou, quando de verdade, e a
-- certidão como prova. Decisões do usuário em 06/08/2026.
--
-- PROBLEMA MEDIDO: linked_by está vazio em 838 de 838 requerimentos — o sistema
-- nunca soube quem protocolou. E protocol_date só é escrito por um lugar, o
-- robô que lê o e-mail do INSS (gmail-inss-sync), com atraso mediano de 9 DIAS.
-- Hoje a firma não sabe quem protocolou nem a data real; sabe quando o e-mail
-- chegou. O próprio código já registrava isso: "nada é capturado no ato".
--
-- DECISÕES:
--   a) registro pela aba de requerimentos INSS, botão no próprio requerimento
--   b) certidão de protocolo OBRIGATÓRIA — sem anexo não grava (NOT NULL)
--   c) o e-mail do INSS CONTINUA sobrescrevendo (é a fonte oficial), mas a
--      sobrescrita passa a deixar aviso com data anterior, data nova e motivo
--   d) sem backfill: vale do lançamento em diante
--   e) mede produtividade por assessor E agilidade (fechar -> protocolar)
--
-- POR QUE O AVISO É TRIGGER E NÃO CÓDIGO DO RAILWAY: o trigger pega QUALQUER
-- caminho de escrita — robô, tela, SQL manual, backfill futuro. Se dependesse
-- do gmail-inss-sync, uma sobrescrita por outra via passaria calada, que é
-- exatamente o tipo de perda silenciosa que já aconteceu nesta base.
--
-- ROLLBACK:
--   drop view public.inss_protocolo_metricas;
--   drop trigger trg_inss_protocol_override on public.inss_admin_processes;
--   drop function public.inss_registra_override_protocolo();
--   drop trigger trg_inss_protocol_reg_aplica on public.inss_protocol_registrations;
--   drop function public.inss_aplica_protocolo_manual();
--   drop table public.inss_protocol_registrations;
--   alter table public.inss_admin_processes drop column protocol_override;
--   delete from storage.buckets where id = 'inss-protocolos';
-- =============================================================================

-- 1. Histórico append-only dos registros feitos por gente. Nunca sobrescrever:
--    duas pessoas podem registrar o mesmo requerimento, e saber disso importa.
create table if not exists public.inss_protocol_registrations (
  id                uuid primary key default gen_random_uuid(),
  inss_process_id   uuid not null references public.inss_admin_processes(id) on delete cascade,
  protocol_date     date not null,
  -- Caminho no bucket privado inss-protocolos. NOT NULL = a certidão é
  -- obrigatória, por decisão do usuário.
  certidao_path     text not null,
  certidao_nome     text,
  -- UUID do usuário NO EXTERNO (ver src/hooks/useExternalUserId.ts). O app faz
  -- signInAnonymously no Externo, então auth.uid() aqui é anônimo e NÃO serve
  -- para identificar a pessoa — o front tem que mandar o ext_uuid explícito.
  registrado_por    uuid not null,
  registrado_em     timestamptz not null default now(),
  observacao        text
);

create index if not exists idx_inss_prot_reg_processo
  on public.inss_protocol_registrations(inss_process_id, registrado_em desc);
create index if not exists idx_inss_prot_reg_autor
  on public.inss_protocol_registrations(registrado_por, registrado_em desc);

alter table public.inss_protocol_registrations enable row level security;

-- TO authenticated, não TO public. As policies das tabelas INSS vizinhas foram
-- criadas com TO public e expunham 839 requerimentos com CPF à chave anon
-- (corrigido em 20260806165000). Não repetir o erro na tabela nova.
create policy inss_protocol_registrations_rw
  on public.inss_protocol_registrations
  for all to authenticated using (true) with check (true);

-- 2. Aviso de sobrescrita, na tabela principal.
alter table public.inss_admin_processes
  add column if not exists protocol_override jsonb;

comment on column public.inss_admin_processes.protocol_override is
  'Aviso de que a data de protocolo informada por uma pessoa foi sobrescrita. '
  'Chaves: data_anterior, data_nova, motivo, detectado_em, registrado_por. '
  'Preenchido pelo trigger trg_inss_protocol_override.';

-- 3. Registro manual passa a valer na hora (o e-mail do INSS corrige depois).
create or replace function public.inss_aplica_protocolo_manual()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.inss_admin_processes
     set protocol_date = new.protocol_date,
         updated_at    = now()
   where id = new.inss_process_id
     and (protocol_date is distinct from new.protocol_date);
  return new;
end;
$$;

create trigger trg_inss_protocol_reg_aplica
  after insert on public.inss_protocol_registrations
  for each row execute function public.inss_aplica_protocolo_manual();

-- 4. Sobrescrita deixa rastro. Só dispara quando havia registro humano e a data
--    nova diverge dele — corrigir de NULL para uma data não é sobrescrita.
create or replace function public.inss_registra_override_protocolo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  ultimo record;
begin
  if new.protocol_date is not distinct from old.protocol_date then
    return new;
  end if;

  select r.protocol_date, r.registrado_por, r.registrado_em
    into ultimo
    from public.inss_protocol_registrations r
   where r.inss_process_id = new.id
   order by r.registrado_em desc
   limit 1;

  -- Sem registro humano, ou a data nova bate com o que a pessoa informou:
  -- nada a avisar.
  if ultimo is null or ultimo.protocol_date is not distinct from new.protocol_date then
    return new;
  end if;

  new.protocol_override := jsonb_build_object(
    'data_anterior',  ultimo.protocol_date,
    'data_nova',      new.protocol_date,
    'motivo',         coalesce(
                        'sobrescrito pelo e-mail do INSS' ||
                        coalesce(' (' || nullif(trim(new.last_email_subject), '') || ')', ''),
                        'sobrescrito por atualização automática'),
    'detectado_em',   now(),
    'registrado_por', ultimo.registrado_por,
    'registrado_em',  ultimo.registrado_em
  );
  return new;
end;
$$;

create trigger trg_inss_protocol_override
  before update of protocol_date on public.inss_admin_processes
  for each row execute function public.inss_registra_override_protocolo();

-- 5. Bucket PRIVADO. Dos 8 buckets existentes, 7 são públicos — a certidão traz
--    CPF e nome do segurado e não pode ficar num deles. Espelha jm-autos, o
--    único privado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inss-protocolos', 'inss-protocolos', false, 20971520,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy inss_protocolos_leitura
  on storage.objects for select to authenticated
  using (bucket_id = 'inss-protocolos');

create policy inss_protocolos_escrita
  on storage.objects for insert to authenticated
  with check (bucket_id = 'inss-protocolos');

-- 6. As duas métricas pedidas.
create or replace view public.inss_protocolo_metricas
with (security_invoker = on) as
select
  r.id,
  r.inss_process_id,
  r.registrado_por,
  r.registrado_em,
  r.protocol_date,
  r.certidao_path,
  i.requerimento_number,
  i.case_id,
  i.protocol_override is not null as teve_sobrescrita,

  -- Produtividade: uma linha por registro, agrupar por registrado_por e dia.
  (r.registrado_em at time zone 'America/Sao_Paulo')::date as dia_registro,

  -- Agilidade: do caso existir até o protocolo sair. Só vale onde há caso
  -- vinculado — hoje 294 dos 839 requerimentos têm case_id, então este número
  -- cobre uma parte, e cresce à medida que a vinculação melhorar.
  case when c.created_at is not null
       then (r.protocol_date - (c.created_at at time zone 'America/Sao_Paulo')::date)
  end as dias_do_caso_ate_protocolo,

  -- Atraso da papelada: quanto tempo entre protocolar e alguém registrar aqui.
  ((r.registrado_em at time zone 'America/Sao_Paulo')::date - r.protocol_date)
    as dias_ate_registrar
from public.inss_protocol_registrations r
join public.inss_admin_processes i on i.id = r.inss_process_id
left join public.legal_cases c on c.id = i.case_id;

comment on view public.inss_protocolo_metricas is
  'Métricas da captura de protocolo INSS. Produtividade: contar por registrado_por + dia_registro. '
  'Agilidade: dias_do_caso_ate_protocolo (só onde há case_id). dias_ate_registrar mede o atraso '
  'da papelada — antes da captura no ato, o atraso mediano do e-mail do INSS era de 9 dias.';
