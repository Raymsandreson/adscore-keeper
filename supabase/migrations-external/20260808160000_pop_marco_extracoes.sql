-- =============================================================================
-- O QUE A IA LEU DENTRO DO DOCUMENTO
--
-- Par de railway-server/src/functions/extract-acordo-from-ata.ts.
--
-- Existe porque acordo homologado em audiência muitas vezes não aparece em
-- movimentação nenhuma — só na ata. O 0016074-62.2016.5.16.0014 é o caso que
-- provou: R$ 400.000 em 27 parcelas homologados em 09/11/2016, fonte "Termo de
-- audiência PJe", e nada nas 97 movimentações baixadas do processo.
--
-- REVISADO = FALSE É O ESTADO NORMAL. Extração de IA não entra na régua
-- sozinha. Um falso "acordo homologado" faz duas estragos ao mesmo tempo: move
-- o processo de estação na linha do tempo E reclassifica dinheiro de PROJETADO
-- para A RECEBER no relatório do fundo. Falso negativo custa muito menos, e o
-- prompt da função é escrito com esse viés.
--
-- houve = false TAMBÉM É GRAVADO, e é resultado útil: diz que aquela ata foi
-- lida e não continha acordo, para a fila não reprocessar o mesmo PDF.
--
-- REVERSÃO: drop table pop_marco_extracoes;
-- =============================================================================

create table if not exists public.pop_marco_extracoes (
  id             uuid primary key default gen_random_uuid(),
  documento_id   bigint not null references public.jm_documentos(id) on delete cascade,
  processo_cnj   text not null,
  marco_chave    text not null,

  houve          boolean not null,
  data_extraida  date,

  -- Campos do acordo: valor_total, n_parcelas, valor_parcela, devedor,
  -- parcial, prossegue_contra, por_reclamante[]. Livre por marco.
  -- por_reclamante importa no litisconsórcio (cônjuge + filhos + pais): a régua
  -- financeira é por (processo x cliente), não por processo.
  dados          jsonb not null default '{}'::jsonb,

  confianca      text not null default 'baixa' check (confianca in ('alta','media','baixa')),
  motivo         text,
  modelo         text,
  -- Citação literal da ata que sustenta a resposta. Sem isso a revisão humana
  -- teria que reabrir o PDF para conferir cada linha.
  trecho         text,

  revisado       boolean not null default false,
  revisado_por   uuid,
  revisado_em    timestamptz,
  aprovado       boolean,

  criado_em      timestamptz not null default now(),
  constraint pop_marco_extracoes_unica unique (documento_id, marco_chave)
);

create index if not exists idx_pop_marco_extracoes_cnj
  on public.pop_marco_extracoes (processo_cnj, marco_chave);
create index if not exists idx_pop_marco_extracoes_pendentes
  on public.pop_marco_extracoes (revisado) where houve;

alter table public.pop_marco_extracoes enable row level security;
drop policy if exists pop_marco_extracoes_all on public.pop_marco_extracoes;
create policy pop_marco_extracoes_all on public.pop_marco_extracoes
  for all to authenticated using (true) with check (true);

comment on table public.pop_marco_extracoes is
  'O que a IA leu dentro do documento. Acordo homologado em audiencia nao aparece em movimentacao nenhuma — so na ata. Nao entra na regua sem revisao (revisado + aprovado).';
