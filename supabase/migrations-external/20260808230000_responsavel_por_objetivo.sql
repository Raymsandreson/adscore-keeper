-- =============================================================================
-- Responsável por fase, objetivo e passo — com herança.
--
-- Pedido do usuário (08/08/2026): designar responsável em cada nível, e definir
-- num nível de cima abranger os de baixo.
--
-- ONDE CADA UM MORA
--   fase     → kanban_boards.stages[].assigneeId        (jsonb, sem migration)
--   objetivo → checklist_stage_links.assignee_id        (esta migration)
--   passo    → checklist_templates.items[].assigneeId   (jsonb, sem migration)
--
-- POR QUE O OBJETIVO FICA NO LINK E NÃO NO TEMPLATE: checklist_templates é
-- reaproveitável entre POPs — "Protocolo e citação" pode existir no trabalhista
-- e no cível com responsáveis diferentes. O link é a única linha que conhece a
-- combinação (POP, fase, objetivo); é lá que o responsável pertence. Guardar no
-- template faria a escolha vazar de um POP para outro.
--
-- HERANÇA (src/lib/popResponsavel.ts, 7 testes):
--   passo → objetivo → fase → responsável processual do lead
-- O primeiro preenchido vence. Definir na fase alcança todos os objetivos e
-- passos dela; definir no objetivo alcança todos os seus passos.
--
-- POR QUE HERANÇA E NÃO PREENCHER TUDO: o POP trabalhista tem 24 fases e ~200
-- passos. Exigir responsável passo a passo garantiria que ninguém preencheria e
-- a atividade nasceria sem dono — que é exatamente o problema que isto resolve.
-- Uma escolha na fase cobre dezenas de passos.
--
-- CUIDADO REGISTRADO: campo vazio no formulário chega como '' e não como null.
-- Sem tratar, um passo "limpo" na tela bloquearia a herança e a atividade
-- nasceria órfã. resolverResponsavel() trata, e há teste para isso.
-- =============================================================================

alter table public.checklist_stage_links
  add column if not exists assignee_id uuid;

comment on column public.checklist_stage_links.assignee_id is
  'Responsavel padrao do objetivo nesta fase deste POP. Herda para os passos que nao tiverem responsavel proprio.';
