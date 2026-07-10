# Resumo da sessão — 10/07/2026

Registro das mudanças feitas nesta sessão, para referência futura. Branch de
trabalho: `claude/internal-external-audio-2tpmom` (tudo já mergeado em `main`).

> **Pendente do usuário:** publicar o frontend no **Lovable** para as mudanças de
> tela entrarem no ar. O **Railway** já redeploya sozinho a partir da `main`
> (regras de IA de preenchimento, etc.). As migrations citadas já foram aplicadas
> no Supabase Externo (`kmedldlepwiityjsdahz`).

---

## 1. Gravação de áudio — microfone + áudio interno

**Arquivos:** `src/components/activities/ActivityCallRecorder.tsx`,
`src/components/whatsapp/WhatsAppCallRecorder.tsx`

- Seletor de fonte antes de gravar: **Microfone / Áudio interno / Ambos**.
- Áudio interno via `getDisplayMedia` (compartilhar aba/tela com áudio); mix de
  mic + sistema via Web Audio API. No PC com fone de ouvido, capta os dois lados.
- No celular as opções de áudio interno ficam desabilitadas (limite do
  Android/iOS), com aviso. Encerra a gravação se o compartilhamento for parado.
- **Limitação:** transcrição ao vivo (Web Speech) capta só o microfone; o
  arquivo salvo é que tem os dois lados.

## 2. Preenchimento por Áudio — edição completa e correções

**Arquivos:** `ActivityCallRecorder.tsx`, `src/pages/ActivitiesPage.tsx`,
`railway-server/src/functions/transcribe-activity-call.ts`

- Corrigido o "não identificou campos" silencioso: retry no servidor + botão
  **"Tentar preencher novamente"** reaproveitando a transcrição.
- O áudio passa a editar **todos os campos** da atividade: prazo, notificação,
  prioridade, situação, assessor, título — além dos textos. Datas relativas
  ("sexta-feira") resolvidas com a data de hoje (fuso Brasília).
- **Comandos de edição** ditados no áudio ("apaga as observações", "troca o
  próximo passo por X", "passa pro assessor Fulano", "marca como concluída").
- Reuso de **gravações anteriores** da atividade sem gravar de novo.

## 3. Múltiplos assessores por atividade

**Migration aplicada:** `lead_activities.assigned_to_ids uuid[]`,
`assigned_to_names text[]` (Externo).
**Arquivos:** `useLeadActivities.ts`, `ActivitiesPage.tsx`, `ActivityFormCompact.tsx`

- Seletor de assessor vira multi-seleção (primeiro = principal, badge "Principal").
- `assigned_to` continua sendo o principal (filtros/notificações intactos); os
  demais vão nas colunas de array. Payload só inclui os arrays quando há
  co-assessor (retrocompatível).

## 4. Mensagem por público (cliente × assessor)

**Arquivo:** `ActivitiesPage.tsx` (`buildMsg`)

- Mensagem ao **cliente**: saudação com o primeiro nome do cliente do processo.
- Mensagem ao **assessor** (envio sem lead): formato próprio endereçado a ele,
  com marcação de "Atividade do sistema", prazo, notificação e link.

## 5. Alerta de tipo de atividade incoerente

**Arquivos:** `ActivitiesPage.tsx`, `ActivityFormCompact.tsx`,
`supabase/functions/suggest-activity-type/index.ts` *(precisa deploy no Lovable)*

- A IA classifica o tipo pelo assunto + campos; se divergir, mostra alerta âmbar
  com "Alterar para X" / "Manter" (nunca troca sozinho).
- Tipos do seletor restritos à **rotina do assessor**; sem rotina, cai nos tipos
  base jurídicos (não em todos os custom do sistema).

## 6. Correção da cópia de mensagem

**Arquivos:** `src/lib/clipboard.ts` (novo), `ActivityFormCompact.tsx`, `ActivitiesPage.tsx`

- `copyTextToClipboard`: API moderna + fallback `execCommand`; só mostra sucesso
  quando copiou de verdade (WebView Android rejeitava silenciosamente).

## 7. Link da atividade — só login, sem auto-cadastro

**Arquivos:** `ProtectedRoute.tsx`, `Index.tsx`, `AuthForm.tsx`

- Link `/?openActivity=ID` preserva o parâmetro no login (abre a atividade depois).
- Vindo de link protegido → tela **só de login** (sem aba "Criar Conta").
- **Cadastro público fechado** globalmente (`PUBLIC_SIGNUP_ENABLED=false`,
  reversível). Aviso ao cliente na tela de acesso por link.

## 8. Avaliação de atendimento (0–5 estrelas)

**Migration aplicada:** tabela `service_ratings` (Externo, com RLS).
**Arquivos:** `supabase/functions/service-rating/index.ts` *(deploy Lovable)*,
`supabase/config.toml` (`verify_jwt=false`), `src/pages/AvaliacaoPage.tsx`,
`src/pages/ServiceRatingsPage.tsx`, `App.tsx`, `ActivityFormCompact.tsx`

- Página pública `/avaliar/:token`: 1–5 estrelas + "Por quê?".
- Botão **"Avaliação"** na barra de envio gera link único (uso único por clique)
  e copia. A avaliação é do **assessor que envia** (usuário atual).
- Painel `/avaliacoes` (protegido): média geral, média por assessor, comentários.
  *(Sem link no menu ainda — acessível pela URL.)*

## 9. Assinatura, workflow e progresso na mensagem

**Arquivo:** `ActivitiesPage.tsx` (`buildMsg`)

- Assinatura carinhosa com o nome de **quem criou** a atividade
  ("Com carinho, Fulano 💚").
- **Fase / Objetivo / Passo atual** (passo logo após o último concluído).
- **Progresso em 3 níveis** (Fase → Objetivo → Passo): cliente vê só a % geral
  ("📊 Progresso do caso: X% concluído"); assessor/painel veem a quebra completa.

## 10. Identificação do cliente por polo + auto-detecção por OAB

**Migration aplicada:** `lead_processes.cliente_polo text` ('ATIVO'|'PASSIVO').
**Arquivos:** `src/utils/clientPoloDetection.ts` (novo),
`src/hooks/useSystemOabs.ts` (novo), `ActivitiesPage.tsx`, `ProcessDetailSheet.tsx`

- Cadastro do processo (aba Partes): seletor **"Nosso cliente"** (Ativo/Passivo).
- **Auto-detecção:** cruza a OAB do advogado dos "envolvidos" com as OABs dos
  usuários (`profile_oab_entries`). Se bate, marca o polo do cliente sozinho.
- Prioridade na saudação: manual > auto-detecção por OAB > padrão ATIVO.
  Resolve o caso de defesa (cliente no polo passivo).

---

## Detector de compromissos (pronto, ainda NÃO ligado)

**Arquivo:** `supabase/functions/_shared/escavadorCompromissos.ts`

Módulo puro que lê as movimentações do Escavador e identifica **audiência /
prazo / perícia** (com data, hora e nº de dias), com dedupe. Validado com dados
reais. **Falta** a fiação de criação automática de atividades — aguarda 3
decisões do usuário:

1. **Responsável** quando o processo não tem um: (1) responsável → dono do lead →
   admin; (2) só se tiver responsável; (3) um advogado fixo.
2. **Gatilho:** (1) varredura diária; (2) ao abrir/atualizar o processo; (3) os dois.
3. **Perícia:** (1) criar tipo "Perícia"; (2) tratar como Prazo; (3) como Audiência.

Observação importante: só **3 de 1426** processos têm `responsible_user_id`; e
**prazo em dias úteis** exige conferência humana (marcar "conferir prazo").

---

## Ideias para sessões futuras

- **Meta de progresso diária** numa tela separada (agregando todas as atividades):
  precisa definir meta por assessor vs escritório, medida em % vs passos/dia, e se
  quer histórico diário (snapshots) — feature de porte próprio.
- **Auto-detecção por CPF** do advogado (hoje só OAB; perfil não guarda CPF).
- **Link do painel `/avaliacoes` no menu** + rate-limit na geração de link.
- **Endurecer geração de link de avaliação** (hoje a função é pública).
