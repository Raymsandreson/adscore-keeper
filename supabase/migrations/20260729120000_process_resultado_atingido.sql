-- "Resultado do processo" na ficha (lead_processes): ESPERADO (herdado do POP) x
-- ATINGIDO (detectado automaticamente das movimentações do Escavador para POP
-- judicial, ou da intimação por e-mail para POP administrativo). Tira a
-- atualização da mão do usuário: o sistema detecta e o assessor só confirma
-- quando o marco é ambíguo.
--
-- Decisões do produto (jul/2026):
--   Q1) A aba mostra ESPERADO (alvo) + ATINGIDO (detectado) + data de cada.
--       O valor esperado NÃO vira coluna aqui — é lido do POP vinculado
--       (kanban_boards.settings.resultado_esperado_id). Só a data-alvo
--       (prognóstico) fica por-processo.
--   Q2) Auto-grava status='confirmado' só para marco inequívoco
--       (transito_julgado, acordo, pagamento). Todo o resto — e todo resultado
--       vindo de e-mail — entra como 'sugerido' e o assessor confirma.
--
-- Fase 1 (esta migration): só colunas em lead_processes. Aditiva, nullable,
-- metadata-only (não reescreve as ~1.6k linhas). NÃO toca kanban_boards, leads,
-- nem as views do telão (tv_atividades_ranking, vw_jm_*). O espelhamento no
-- ranking é a Fase 2, separada.
--
-- Rollback:
--   alter table public.lead_processes
--     drop column if exists resultado_atingido,
--     drop column if exists resultado_atingido_tipo,
--     drop column if exists resultado_atingido_data,
--     drop column if exists resultado_atingido_fonte,
--     drop column if exists resultado_atingido_ref,
--     drop column if exists resultado_atingido_status,
--     drop column if exists resultado_esperado_data_alvo,
--     drop column if exists resultado_esperado_id_override;
--
-- Aplicar no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

alter table public.lead_processes
  -- Resultado detectado (rótulo legível — ex: "Trânsito em julgado", "Acordo homologado").
  add column if not exists resultado_atingido text,
  -- Marco tipado que originou o resultado (espelha process_movements.tipo_movimentacao).
  add column if not exists resultado_atingido_tipo text,
  -- Data do marco/intimação que caracterizou o resultado.
  add column if not exists resultado_atingido_data date,
  -- Origem da detecção, para auditoria e regra de confiança.
  add column if not exists resultado_atingido_fonte text
    check (resultado_atingido_fonte in ('escavador', 'email_intimacao', 'manual')),
  -- Referência rastreável à evidência: id da process_movements ou do processual_emails.
  add column if not exists resultado_atingido_ref text,
  -- Fluxo de confiança: 'sugerido' (assessor confirma) | 'confirmado' (vale pro ranking).
  add column if not exists resultado_atingido_status text
    check (resultado_atingido_status in ('sugerido', 'confirmado')),
  -- Prognóstico por-processo: até quando se espera o resultado. Opcional.
  add column if not exists resultado_esperado_data_alvo date,
  -- Override por-processo do resultado esperado. NULL = herda do POP
  -- (kanban_boards.settings.resultado_esperado_id). Preenchido só em caso atípico.
  add column if not exists resultado_esperado_id_override text;

comment on column public.lead_processes.resultado_atingido is
  'Resultado detectado do processo (rótulo legível). Preenchido pelo detector de movimentações/e-mail, não pelo usuário.';
comment on column public.lead_processes.resultado_atingido_status is
  'sugerido = aguarda confirmação do assessor; confirmado = vale para o ranking (Fase 2).';
comment on column public.lead_processes.resultado_atingido_ref is
  'Auditoria: id da process_movements (judicial) ou processual_emails (administrativo) que disparou o resultado.';
