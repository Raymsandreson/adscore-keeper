-- Conversa marcada como "não é lead" — a decisão de triagem vira dado.
--
-- BANCO: Supabase EXTERNO (kmedldlepwiityjsdahz), onde moram `leads`,
-- `contacts`, `whatsapp_messages` e as irmãs desta tabela
-- (`whatsapp_private_conversations`, `whatsapp_muted_chats`). Não aplicar no Cloud.
--
-- Motivação (evidência colhida em 14/09/2026):
--   * O filtro "Sem lead" da caixa de entrada
--     (src/components/whatsapp/WhatsAppConversationList.tsx:636) é
--     `conversations.filter(c => !c.lead_id)` — ou seja, AUSÊNCIA de vínculo.
--     Ele mistura duas coisas opostas: "ainda não triei" e "já triei e não é
--     lead". Hoje são 481 conversas na mesma pilha, e quem abre amanhã não sabe
--     quais já foram olhadas.
--   * Nenhuma marcação de triagem existia: `grep -rn "is_lead|nao_e_lead"` em
--     src/ e supabase/ não devolve nada além de variáveis locais (isLeadStagnant,
--     isLeadClosed). Confirmado também no information_schema do Externo.
--   * Sem a marcação, as automações continuam criando lead para o mesmo
--     telefone: `execute-agent-automations/index.ts:294` (ação `create_lead` do
--     agente IA) e `whatsapp-webhook/index.ts:2114` (auto_create_lead do CTWA)
--     só checam se JÁ existe lead, nunca se alguém decidiu que não deve existir.
--
-- Por que TABELA PRÓPRIA e não coluna em `contacts` ou `leads`:
--   A decisão é sobre a CONVERSA, e a conversa não é linha de tabela — ela é
--   derivada de `whatsapp_messages` agrupada por telefone
--   (useWhatsAppMessages.ts:145, getConversationKey). Conversa sem contato e sem
--   lead — justamente o caso que esta feature atende — não teria onde pendurar a
--   coluna. Mesmo desenho já usado por `whatsapp_private_conversations`.
--
-- Por que a chave é o TELEFONE e não (telefone + instância):
--   O lead é criado por telefone (`leads.lead_phone`), não por instância. Se a
--   chave fosse o par, marcar "não é lead" na instância A e a pessoa escrever na
--   instância B recriaria o lead — o furo que a feature existe para fechar.
--   `instance_name` fica como registro de ONDE foi marcado, fora da chave.
--
-- Privacidade/LGPD: guarda telefone (o mesmo dado que `whatsapp_messages` já
--   guarda, no mesmo banco e região) e um motivo curto digitado pelo usuário.
--   NÃO guarda conteúdo de conversa.
--
-- Rollback (<1min, nada existente é alterado — a tabela só é criada):
--   DROP TABLE public.whatsapp_nao_lead;

CREATE TABLE IF NOT EXISTS public.whatsapp_nao_lead (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Só dígitos, com DDI — o mesmo formato que `whatsapp_messages.phone` grava no
  -- inbound. UNIQUE: a marcação vale para a pessoa, em qualquer instância.
  phone text NOT NULL UNIQUE,

  -- De qual número da casa a conversa estava aberta quando alguém marcou.
  -- Fora da chave: serve para auditoria ("marquei pelo número do comercial"),
  -- não para restringir o bloqueio.
  instance_name text,

  -- Por que não é lead, em uma linha ("parceiro", "fornecedor", "grupo da
  -- família"). Opcional: exigir texto faria o time pular a marcação.
  motivo text,

  marcado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_nao_lead IS
  'Conversas triadas e decididas como "não é lead, é só contato". Bloqueia a criação automática de lead para o telefone (agente IA e CTWA) e separa, no filtro da caixa de entrada, o que já foi olhado do que ainda não foi.';

-- O bloqueio é lido no caminho quente do webhook (toda mensagem que chega de
-- conversa sem lead). O UNIQUE de `phone` já cria o índice que essa busca usa;
-- este aqui cobre a listagem por instância na tela de triagem.
CREATE INDEX IF NOT EXISTS whatsapp_nao_lead_instance_idx
  ON public.whatsapp_nao_lead (instance_name);

ALTER TABLE public.whatsapp_nao_lead ENABLE ROW LEVEL SECURITY;

-- Leitura: todo mundo do time precisa ver a marcação, senão dois atendentes
-- triam a mesma conversa.
DROP POLICY IF EXISTS "Authenticated users can read nao_lead" ON public.whatsapp_nao_lead;
CREATE POLICY "Authenticated users can read nao_lead"
  ON public.whatsapp_nao_lead FOR SELECT
  TO authenticated
  USING (true);

-- Marcar: fica registrado quem marcou (mesmo desenho de
-- whatsapp_private_conversations."Users can mark conversations private").
DROP POLICY IF EXISTS "Users can mark conversation as nao_lead" ON public.whatsapp_nao_lead;
CREATE POLICY "Users can mark conversation as nao_lead"
  ON public.whatsapp_nao_lead FOR INSERT
  TO authenticated
  WITH CHECK (marcado_por = auth.uid());

-- Desmarcar: QUALQUER pessoa autenticada, de propósito — diferente de
-- "conversa privada", que é decisão pessoal. Triagem errada é do time, e travar
-- o desfazer no autor deixaria o lead bloqueado até ele voltar de férias.
DROP POLICY IF EXISTS "Users can unmark conversation as nao_lead" ON public.whatsapp_nao_lead;
CREATE POLICY "Users can unmark conversation as nao_lead"
  ON public.whatsapp_nao_lead FOR DELETE
  TO authenticated
  USING (true);
