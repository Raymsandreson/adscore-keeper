-- Fix 4 — Copiar nome/CPF da procuração para o lead (dado dentro do cadastro).
--
-- Contexto: o outorgante_name/outorgante_cpf são extraídos do PDF da procuração
-- DEPOIS da assinatura (por zapsign-enrich-from-detail). Um gatilho na
-- zapsign_documents pega esse momento — independente de qual função populou —
-- e copia pro lead (victim_name / cpf) quando o lead ainda está vazio.
--
-- Assim o nome/CPF do cliente aterrissa no cadastro, e o processo (que lê do
-- lead vinculado) passa a exibir o dado. Não sobrescreve dado já preenchido.
--
-- Seguro: só preenche campo vazio; EXCEPTION pra nunca bloquear o update do doc.

create or replace function public.copy_zapsign_data_to_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is not null
     and ( coalesce(btrim(new.outorgante_name), '') <> ''
        or coalesce(btrim(new.outorgante_cpf), '')  <> '' ) then
    update public.leads l
       set victim_name = case
             when coalesce(btrim(l.victim_name), '') = '' and coalesce(btrim(new.outorgante_name), '') <> ''
             then btrim(new.outorgante_name) else l.victim_name end,
           cpf = case
             when coalesce(btrim(l.cpf), '') = '' and coalesce(btrim(new.outorgante_cpf), '') <> ''
             then btrim(new.outorgante_cpf) else l.cpf end
     where l.id = new.lead_id
       and ( (coalesce(btrim(l.victim_name), '') = '' and coalesce(btrim(new.outorgante_name), '') <> '')
          or (coalesce(btrim(l.cpf), '') = '' and coalesce(btrim(new.outorgante_cpf), '') <> '') );
  end if;
  return new;
exception when others then
  raise warning '[fix4] copy_zapsign_data_to_lead falhou para doc %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_copy_zapsign_to_lead on public.zapsign_documents;
create trigger trg_copy_zapsign_to_lead
  after insert or update of outorgante_name, outorgante_cpf, lead_id on public.zapsign_documents
  for each row
  execute function public.copy_zapsign_data_to_lead();
