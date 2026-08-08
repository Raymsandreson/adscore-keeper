-- =============================================================================
-- MARCOS POR POP — cada POP passa a ter a sua própria régua.
--
-- POR QUE: até aqui a régua era global e fixa em 6 lugares (banco, parser,
-- IA, front, hook, rótulos). Um POP de acidente de trabalho trabalhista e um
-- POP de BPC administrativo não têm o mesmo ciclo, e forçar os dois na mesma
-- escala de 12 estações foi o que produziu o "Salário Maternidade" mandando
-- os 5 status possíveis para sentenca_1grau em kanban_boards.settings.
--
-- ADITIVO POR DECISÃO: as 12 estações globais e process_movements continuam
-- funcionando e servindo a ficha do processo. Esta migration NÃO as toca, não
-- migra dado e não muda nenhuma tela. Ela cria o lugar onde a régua por POP
-- passa a morar; a troca de quem manda na ficha é passo separado, depois da
-- calibragem.
--
-- REVERSÃO: drop table pop_marco_sinais, pop_marcos;  (nada mais depende delas)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. A régua de um POP
-- ---------------------------------------------------------------------------
create table if not exists public.pop_marcos (
  id                uuid primary key default gen_random_uuid(),
  board_id          uuid not null references public.kanban_boards(id) on delete cascade,

  chave             text not null,      -- estável, usada em código: 'acordao_2grau'
  rotulo            text not null,      -- o que a pessoa lê: 'Acórdão (2º grau)'
  ordem             smallint not null,  -- posição na régua DESTE POP
  descricao         text,

  -- Fase do POP a que o marco pertence (kanban_boards.stages[].id).
  -- Sem FK: stages é jsonb, não tabela. Validação fica na aplicação.
  stage_id          text,

  -- Encerra o ciclo do POP (trânsito, arquivamento, indeferimento final).
  terminal          boolean not null default false,

  -- Só aparece na linha do tempo se houver evidência — nunca é previsto.
  -- Mesma regra que hoje vale para cumprimento de sentença e precatório:
  -- prever execução em todo processo poluiria a linha de quem nunca executa.
  eventual          boolean not null default false,

  -- Quanto o escritório ESPERA levar deste marco até o próximo. É meta, não
  -- medição: o tempo observado sai da calibragem contra processos concluídos.
  prazo_alvo_dias   integer,

  -- Para onde este marco empurra o recebível. Ver skill whatsjud-fluxo-vocabulario:
  -- o estágio real é da PARCELA (por processo x cliente) e se decide por valor
  -- certo / data certa / acesso. O marco é ENTRADA dessa decisão, nunca a saída
  -- — por isso "sugerido". Um acórdão fixa valor sem data: CONDENACAO.
  estagio_financeiro_sugerido text
    check (estagio_financeiro_sugerido is null or estagio_financeiro_sugerido in (
      'PROJETADO', 'CONDENACAO', 'A_RECEBER', 'VENCIDO',
      'EM_EXECUCAO', 'DEPOSITADO_EM_JUIZO', 'PAGO', 'INDEFERIDO'
    )),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint pop_marcos_chave_unica unique (board_id, chave)
);

-- Reordenar a régua troca várias ordens numa transação só — daí deferrable.
alter table public.pop_marcos drop constraint if exists pop_marcos_ordem_unica;
alter table public.pop_marcos add constraint pop_marcos_ordem_unica
  unique (board_id, ordem) deferrable initially deferred;

create index if not exists idx_pop_marcos_board_ordem on public.pop_marcos (board_id, ordem);

-- ---------------------------------------------------------------------------
-- 2. Como o sistema RECONHECE que o marco aconteceu
--
-- Um marco pode ser reconhecido por mais de um sinal, e as fontes são
-- diferentes por natureza do processo:
--   judicial       -> código TPU/CNJ da movimentação (determinístico)
--   administrativo -> texto do e-mail do INSS (não há código)
--   qualquer       -> proposta da IA, que nasce não-confirmada
-- ---------------------------------------------------------------------------
create table if not exists public.pop_marco_sinais (
  id                  uuid primary key default gen_random_uuid(),
  pop_marco_id        uuid not null references public.pop_marcos(id) on delete cascade,

  tipo                text not null check (tipo in ('tpu', 'texto')),

  -- tipo='tpu': código do movimento CNJ. grau null = qualquer grau.
  codigo              integer,
  grau                text check (grau is null or grau in ('G1', 'G2', 'SUP')),
  complemento_pattern text,

  -- tipo='texto': padrão a casar no título/corpo (e-mail do INSS, movimentação
  -- sem código). Guardado como texto simples, não regex, para poder ser lido e
  -- corrigido por quem é do jurídico e não escreve regex.
  padrao              text,

  -- Quem propôs o sinal. 'ia' entra sempre com confirmado = false: a IA sugere
  -- o de-para, a validação contra gabarito é que promove.
  origem              text not null default 'manual' check (origem in ('manual', 'ia')),
  confirmado          boolean not null default false,
  motivo              text,             -- por que a IA propôs, ou por que foi confirmado

  created_at          timestamptz not null default now(),

  -- tpu exige código; texto exige padrão.
  constraint pop_marco_sinais_coerente check (
    (tipo = 'tpu'   and codigo is not null) or
    (tipo = 'texto' and padrao is not null and length(btrim(padrao)) > 0)
  )
);

create unique index if not exists idx_pop_marco_sinais_unico
  on public.pop_marco_sinais (
    pop_marco_id, tipo,
    coalesce(codigo, -1),
    coalesce(grau, ''),
    coalesce(complemento_pattern, ''),
    coalesce(padrao, '')
  );

create index if not exists idx_pop_marco_sinais_codigo
  on public.pop_marco_sinais (codigo, grau) where tipo = 'tpu';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- A sessão do Externo é anônima (signInAnonymously), então a policy tem que
-- abrir para `authenticated` — auth.uid() = user_id devolveria 0 linhas em
-- silêncio, que é exatamente o erro que já custou uma investigação nesta base.
-- ---------------------------------------------------------------------------
alter table public.pop_marcos       enable row level security;
alter table public.pop_marco_sinais enable row level security;

drop policy if exists pop_marcos_all on public.pop_marcos;
create policy pop_marcos_all on public.pop_marcos
  for all to authenticated using (true) with check (true);

drop policy if exists pop_marco_sinais_all on public.pop_marco_sinais;
create policy pop_marco_sinais_all on public.pop_marco_sinais
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. updated_at
-- ---------------------------------------------------------------------------
create or replace function public.tg_pop_marcos_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_pop_marcos_touch on public.pop_marcos;
create trigger trg_pop_marcos_touch before update on public.pop_marcos
  for each row execute function public.tg_pop_marcos_touch();

comment on table public.pop_marcos is
  'Régua de marcos própria de cada POP (kanban_boards). Aditiva: as 12 estações globais seguem valendo até a calibragem promover esta.';
comment on table public.pop_marco_sinais is
  'Como cada marco é reconhecido: código TPU (judicial) ou padrão de texto (administrativo/e-mail). Sinal proposto por IA nasce confirmado=false.';
