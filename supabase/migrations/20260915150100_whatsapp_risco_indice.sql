-- Índice que o monitor de risco precisa: última mensagem por instância.
--
-- Separado da migration principal porque CREATE INDEX CONCURRENTLY não roda
-- dentro de transação. CONCURRENTLY é obrigatório aqui: whatsapp_messages tem
-- 7,8 GB e 1,76 M linhas, e um CREATE INDEX comum travaria escrita na tabela
-- por onde passa TODA mensagem do escritório — inclusive as que estão chegando
-- de cliente agora.
--
-- Sem ele, saber há quanto tempo uma instância está muda custa uma varredura
-- da tabela inteira por instância (o teste estourou 60s).
--
-- ROLLBACK: drop index concurrently if exists idx_wam_inst_lower_created;
create index concurrently if not exists idx_wam_inst_lower_created
  on public.whatsapp_messages (lower(instance_name), created_at desc);
