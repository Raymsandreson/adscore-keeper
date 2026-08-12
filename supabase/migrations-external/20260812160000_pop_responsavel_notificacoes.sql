-- =============================================================================
-- Quinto degrau da cascata de responsável: quem recebe as notificações de
-- atualização dos processos vinculados a um POP.
--
-- PEDIDO (Raym, 12/08/2026): "quando não tiver [responsável do passo] manda a
-- notificação para uma pessoa só, por POP; e em caso de não tiver responsável,
-- notifica todo mundo".
--
-- POR QUE ISTO PRECISOU EXISTIR: a cascata de 08/08 (passo → objetivo → fase →
-- processo) terminava em "ninguém", e "ninguém" virava silêncio. Medido em
-- 12/08: dos 314 leads que aparecem no sino, 97 não têm
-- leads.processual_responsible_id. Quase um terço das movimentações não tinha
-- para quem ir — e movimentação sem destinatário é movimentação que ninguém lê.
--
-- ONDE ENTRA NA ORDEM (mais específico vence, mesmo princípio de 08/08):
--   passo → objetivo → fase → processo → POP → todo mundo
--
-- O POP vem DEPOIS do responsável do lead de propósito. Quem cuida daquele caso
-- é mais específico do que quem cuida do POP inteiro; inverter faria uma pessoa
-- só receber as 217 movimentações que já têm dono certo, e o dono certo não
-- receber nada. Assim o degrau do POP atende justamente os 97 órfãos.
--
-- E "todo mundo" é último recurso deliberado, não descuido: antes disso o
-- realtime avisava todo mundo SEMPRE, que é o mesmo que não avisar. Como
-- fundo de poço ele só dispara quando os cinco degraus falharam — e aí é
-- melhor a equipe inteira ver do que a movimentação morrer calada.
--
-- COLUNA E NÃO settings: é valor com forma de chave estrangeira, e o mesmo
-- roteamento vai servir a um notificador do lado do servidor (WhatsApp/e-mail)
-- depois — join em jsonb ali é ruim. Também deixa o degrau do POP simétrico
-- com o do objetivo (checklist_stage_links.assignee_id), que já é coluna.
--
-- REVERSÃO:
--   alter table public.kanban_boards drop column notificacoes_assignee_id;
-- =============================================================================

alter table public.kanban_boards
  add column if not exists notificacoes_assignee_id uuid;

comment on column public.kanban_boards.notificacoes_assignee_id is
  'Quem recebe as notificacoes de atualizacao dos processos vinculados a este POP. Penultimo degrau da cascata de responsavel (passo -> objetivo -> fase -> processo -> POP -> todo mundo); ver src/lib/popResponsavel.ts.';
