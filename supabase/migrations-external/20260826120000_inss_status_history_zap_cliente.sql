-- Fila de mensagem para o grupo do cliente quando o INSS mexe no pedido.
--
-- Por que fila e não envio direto: 28% dos e-mails do INSS chegam entre 20h e
-- 8h (572 de 2.039 medidos em 26/08/2026). Mandar na hora significa mensagem
-- de madrugada no grupo do cliente; segurar sem registrar significa perder a
-- notícia. Estas colunas guardam o texto já redigido até a janela abrir.
--
-- zap_status:
--   'enviado'    — foi para o grupo (zap_enviado_at preenchido)
--   'agendado'   — texto pronto, esperando a janela de 8h–20h
--   'silencio'   — status que não vira mensagem (Em Análise, Pendente,
--                  Cancelada, conclusão sem veredito)
--   'sem_grupo'  — lead sem grupo, ou com vários e sem desempate
--   'repetido'   — cliente já foi avisado desse mesmo desfecho
--   'retroativo' — evento anterior ao corte de ativação
--   'suprimido'  — evento mais antigo do mesmo lote; só o mais recente avisa
--   'erro'       — UazAPI recusou (motivo em zap_erro)
--   NULL         — evento anterior a esta migration, nunca avaliado
alter table public.inss_status_history
  add column if not exists zap_status     text,
  add column if not exists zap_tipo       text,
  add column if not exists zap_texto      text,
  add column if not exists zap_enviado_at timestamptz,
  add column if not exists zap_erro       text;

comment on column public.inss_status_history.zap_status is
  'Situação da mensagem ao cliente: enviado|agendado|silencio|sem_grupo|repetido|retroativo|suprimido|erro';
comment on column public.inss_status_history.zap_tipo is
  'protocolado|exigencia|deferido|indeferido|arquivado_decurso';
comment on column public.inss_status_history.zap_texto is
  'Texto exato que foi (ou será) enviado ao grupo';
