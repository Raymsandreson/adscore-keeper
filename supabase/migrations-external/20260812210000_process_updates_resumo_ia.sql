-- ============================================================================
-- Resumo do que o e-mail do tribunal disse, escrito pela IA na CAPTURA.
--
-- O card do sino mostra o texto cru ("Certidão Automática de Ciência por
-- Domicílio Eletrônico | Certidão (RESTRITO)") e os eventos ficam escondidos
-- atrás de um clique. Quem varre 100 linhas não lê nada disso.
--
-- Por que coluna e não geração na hora de olhar: o sino abre com até 100 cards,
-- e resumir no render seriam 100 chamadas de IA por abertura. Aqui o resumo é
-- calculado UMA vez, quando a movimentação chega, e depois é só texto.
--
-- `resumo_ia_at` separa "ainda não resumido" (null) de "resumido e deu vazio":
-- sem isso o varredor tentaria de novo, para sempre, as movimentações que a IA
-- não conseguiu resumir.
-- ============================================================================
alter table public.process_updates
  add column if not exists resumo_ia text,
  add column if not exists resumo_ia_at timestamptz;

-- Índice parcial: a fila do varredor é "o que ainda não tem resumo", e ela
-- encolhe até quase zero. Índice cheio custaria manutenção em toda inserção
-- para responder uma pergunta que só interessa às linhas novas.
create index if not exists idx_process_updates_sem_resumo
  on public.process_updates (created_at desc)
  where resumo_ia_at is null;

comment on column public.process_updates.resumo_ia is
  'Resumo em 1-2 frases do que a movimentação/e-mail do tribunal diz, gerado na captura (Railway: summarize-process-updates).';
comment on column public.process_updates.resumo_ia_at is
  'Quando o resumo foi tentado. Preenchido mesmo quando a IA não devolveu texto, para a linha não voltar à fila.';
