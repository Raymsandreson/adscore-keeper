-- Telão /tv/atividades — "Modo Corrida" (estilo Corrida Maluca).
-- Guarda a escolha de carro/cor de cada piloto (assessor), chaveada pelo NOME
-- normalizado — mesma chave que o telão já usa pra cor de avatar e iniciais,
-- já que o ranking (tv_atividades_ranking) agrega por nome, sem user_id.
--
-- Sessão do Externo é anônima (signInAnonymously → role authenticated), então
-- a RLS libera authenticated pra gravar e todos pra ler. Sem PII: só nome,
-- id do carro e cor.
--
-- Aplicada no Externo kmedldlepwiityjsdahz via MCP em 2026-07-23.

create table if not exists public.tv_race_cars (
  nome_key   text primary key,
  nome       text not null,
  car_id     text not null,
  color      text,
  updated_at timestamptz not null default now()
);

alter table public.tv_race_cars enable row level security;

drop policy if exists tv_race_cars_read on public.tv_race_cars;
create policy tv_race_cars_read on public.tv_race_cars
  for select using (true);

drop policy if exists tv_race_cars_write on public.tv_race_cars;
create policy tv_race_cars_write on public.tv_race_cars
  for all to authenticated using (true) with check (true);
