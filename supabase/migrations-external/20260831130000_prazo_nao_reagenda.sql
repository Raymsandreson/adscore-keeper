-- =============================================================================
-- Prazo não se reagenda — regra do usuário (31/08/2026), Supabase EXTERNO.
--
-- Contexto: no 1017247-47.2025.4.01.3100 o prazo real era 16/07 (estava até no
-- título da atividade), o campo deadline foi posto em 31/07 e a réplica entrou
-- 03/08 — 18 dias depois do decurso certificado pelo cartório. A partir de
-- agora, atividade do tipo 'prazo' (do robô ou manual) só aceita deadline
-- andando PARA TRÁS (antecipar é sempre permitido). Adiar ou apagar a data
-- levanta exceção. Prazo novo de verdade (nova intimação) = atividade nova.
--
-- ROLLBACK (<1 min):
--   drop trigger if exists lead_activities_prazo_nao_reagenda on public.lead_activities;
--   drop function if exists public.prazo_nao_reagenda();
-- =============================================================================

create or replace function public.prazo_nao_reagenda() returns trigger
language plpgsql as $$
begin
  if old.activity_type = 'prazo'
     and old.deadline is not null
     and (new.deadline is null or new.deadline > old.deadline) then
    raise exception
      'Prazo não pode ser adiado (de % para %). Prazo se cumpre, não se reagenda — regra de 31/08/2026. Se o juízo abriu prazo novo (nova intimação), crie uma atividade nova.',
      old.deadline, coalesce(new.deadline::text, 'sem data');
  end if;
  return new;
end $$;

drop trigger if exists lead_activities_prazo_nao_reagenda on public.lead_activities;
create trigger lead_activities_prazo_nao_reagenda
  before update of deadline on public.lead_activities
  for each row execute function public.prazo_nao_reagenda();
