-- Aviso de lead novo no WhatsApp do acolhedor.
--
-- BANCO: Supabase EXTERNO (kmedldlepwiityjsdahz), onde moram `leads`,
-- `kanban_boards` e `whatsapp_instances`. NÃO aplicar no Cloud.
--
-- POR QUE EXISTE (pedido do Raym em 14/09/2026)
--   O acolhedor vive no WhatsApp, não na tela. Para saber que entrou lead do
--   tráfego pago ele precisa abrir o sistema — e enquanto não abre, o lead
--   esfria. O aviso leva para o WhatsApp dele o que ele precisa para agir sem
--   abrir nada: quem preencheu, o nome da criança, as respostas de
--   qualificação e um link `wa.me` que abre a conversa com o cliente JÁ COM a
--   primeira mensagem escrita.
--
-- EVIDÊNCIA DE VOLUME (banco real, board BPC, 14/09/2026)
--   2.641 leads em 30 dias. No pior dia medido (10/09): Karolyne 60, Mateus 58,
--   Israel 29. Um aviso por lead pode chegar a ~60 mensagens/dia por pessoa —
--   daí o teto por rodada e a janela de horário do lado da função.
--
-- POR QUE DUAS TABELAS, E NÃO COLUNA EM `leads`
--   `leads` tem 6 dígitos de linhas e é o caminho quente de criação de lead
--   (dois crons escrevendo). ALTER TABLE ali para um controle de notificação
--   troca risco alto por conveniência. Tabela ao lado isola o experimento: se
--   der errado, `DROP TABLE` e nada mais no sistema muda.
--
-- PRIVACIDADE / LGPD
--   `acolhedor_aviso_config.whatsapp` é telefone de FUNCIONÁRIO. Fica só aqui,
--   nunca no repositório e nunca em log (a função loga lead_id e operador, não
--   número). RLS habilitado e SEM policy: só service_role (os crons do Railway)
--   enxerga. Navegador autenticado não lê nem escreve.
--   `lead_aviso_acolhedor` NÃO guarda o texto enviado nem o telefone do
--   cliente: guarda o id do lead, que já é a fonte do dado.
--
-- ROLLBACK (< 1 min, nada existente é alterado)
--   DROP TABLE public.lead_aviso_acolhedor;
--   DROP TABLE public.acolhedor_aviso_config;
--   (e tirar AVISO_LEAD_ACOLHEDOR das env vars do Railway)

-- =============================================================================
-- QUEM RECEBE O AVISO
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.acolhedor_aviso_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Nome do operador como `casaOperador` (lib/leadAdsSheet.ts) devolve:
  -- 'Israel', 'Mateus', 'Karolyne', 'Edilan', 'Cris'... É o mesmo rótulo que
  -- entra em `leads.source` ("Meta Lead Ads — Israel"), e é por ele que a
  -- função sabe de quem é o lead. Operador sem linha aqui não gera aviso —
  -- silêncio por ausência de cadastro, nunca por adivinhação.
  operador text NOT NULL,

  -- Board do funil. Permite ligar o aviso no BPC sem ligar em todo lugar.
  board_id uuid NOT NULL,

  -- Como chamar a pessoa no aviso (só para leitura humana).
  nome_exibicao text,

  -- Telefone de DESTINO, só dígitos com DDI (ex: 5586999999999).
  -- É o celular pessoal dele (decisão do Raym em 14/09/2026). Consequência
  -- aceita e registrada: a conversa que nascer do clique acontece fora das
  -- instâncias monitoradas, então ela NÃO é gravada em `whatsapp_messages` e o
  -- painel continua marcando esse lead como "ninguém respondeu".
  whatsapp text NOT NULL,

  -- Instância UazAPI que MANDA o aviso. NULL = usa o padrão da env var
  -- AVISO_LEAD_INSTANCIA do Railway.
  instancia_remetente text,

  -- Textos da 1ª mensagem que o link `wa.me` já deixa escrita.
  -- `{crianca}` é o único marcador. NULL = usa o padrão do código.
  mensagem_com_crianca text,
  mensagem_sem_crianca text,

  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  -- Uma linha por pessoa por funil.
  CONSTRAINT acolhedor_aviso_config_operador_board_key UNIQUE (operador, board_id)
);

COMMENT ON TABLE public.acolhedor_aviso_config IS
  'Quem recebe aviso de lead novo no WhatsApp, por operador e por board. Telefone de funcionário: só service_role lê.';

-- =============================================================================
-- O QUE JÁ FOI AVISADO — a trava contra aviso repetido
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.lead_aviso_acolhedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- UNIQUE é a idempotência: dois crons criam lead no mesmo board e a varredura
  -- roda de minuto em minuto. Sem isso, a mesma mãe vira três avisos e o
  -- acolhedor silencia a conversa — e aviso silenciado é aviso que não existe.
  lead_id uuid NOT NULL,

  operador text,
  -- Instância que mandou, para auditar de qual número saiu.
  instancia_remetente text,

  -- Preenchido SÓ depois que o envio deu certo. Marcar antes transforma uma
  -- falha de envio em lead que ninguém nunca mais vai ver (mesma lição do
  -- dom-avisar-atendente).
  enviado_em timestamptz,
  erro text,
  tentativas integer NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lead_aviso_acolhedor_lead_id_key UNIQUE (lead_id)
);

COMMENT ON TABLE public.lead_aviso_acolhedor IS
  'Registro de aviso de lead novo enviado ao acolhedor. lead_id UNIQUE = trava de idempotência.';

-- A varredura pergunta "quem ainda não recebeu aviso e ainda pode ser
-- retentado". Índice parcial: só as linhas pendentes, que são poucas.
CREATE INDEX IF NOT EXISTS idx_lead_aviso_pendente
  ON public.lead_aviso_acolhedor (criado_em)
  WHERE enviado_em IS NULL;

-- =============================================================================
-- RLS — tabela com dado de funcionário é fechada por padrão
-- =============================================================================
-- Habilitado e sem policy: nega tudo para anon e authenticated. O service_role
-- (Railway) passa por cima do RLS por definição, que é o único acesso que estas
-- tabelas precisam hoje. Quando existir tela de configuração, a policy entra
-- aqui, explícita, e não por remoção do RLS.
ALTER TABLE public.acolhedor_aviso_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_aviso_acolhedor ENABLE ROW LEVEL SECURITY;
