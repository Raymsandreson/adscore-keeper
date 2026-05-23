
# Gerador de Procuração — Link Único (com login)

## Metáfora rápida
Hoje cada etiqueta gera um "ingresso descartável" (token). Vamos criar uma "porta fixa" no app: o operador entra, digita o telefone do cliente, escolhe o modelo, e o sistema já busca tudo da conversa pra ele revisar e mandar. A etiqueta vira só um **atalho** que avisa "olha, esse cliente tá pronto, clica aqui".

## O que muda

### 1. Nova página `/gerar-procuracao` (frontend, dentro do app logado)
Reutiliza toda a lógica do popup `ZapSignDocumentDialog`, mas como página standalone. Fluxo:

```text
[Tel + instância]  →  [Escolher modelo]  →  [IA extrai da conversa]
       ↓                                              ↓
   busca lead/contato/msgs                     campos editáveis ✨
                                                      ↓
                                          [Upload doc opcional]
                                                      ↓
                                               [Gerar e enviar]
```

- Aceita query params: `/gerar-procuracao?phone=5511999999999&instance=oficial&template=abc123`
- Protegida por `<ProtectedRoute>` (mesmo login do app — resolve segurança/LGPD)
- Mobile-first (operador vai usar no celular)

### 2. Etiqueta vira atalho (ajuste no Railway)
`prepare-label-document-trigger.ts`: em vez de criar `pending_label_documents` com token único, manda WhatsApp pro operador (`reviewPhone`) com:

> 🔔 Cliente *Fulano* (+55 11 9...) pronto pra procuração.
> Abrir: https://adscore-keeper.lovable.app/gerar-procuracao?phone=5511...&instance=oficial&template=BPC_LOAS

- Não usa mais o sistema de token/expiração para esse fluxo
- Mantém `pending_label_documents` só pra histórico/auditoria (opcional, podemos remover depois)

### 3. Rota `/revisar/:token` mantida
Continua funcionando pra links antigos já enviados, mas não geramos mais novos.

## Arquivos

**Novos:**
- `src/pages/GerarProcuracaoPage.tsx` — página principal

**Editados:**
- `src/App.tsx` — adicionar rota `<Route path="/gerar-procuracao" element={<ProtectedRoute><GerarProcuracaoPage /></ProtectedRoute>} />` dentro do SidebarLayout
- `railway-server/src/functions/prepare-label-document-trigger.ts` — trocar criação de token por envio de link genérico ao operador
- `.lovable/docs/agente-gerador-documento.md` — atualizar documentação

**Reusados sem mexer:**
- `supabase/functions/zapsign-api` (actions: `list_templates`, `get_template_fields`, `extract_fields`, `create_doc`)
- Railway `extract-conversation-data` (proxy via Cloud edge se necessário)
- Hooks de busca de contato/lead/mensagens já existentes

## O que NÃO vou mexer
- `ZapSignDocumentDialog` (popup do print) — continua funcionando no chat
- `submit-document-review.ts` e `get-pending-review.ts` — mantidos pra links antigos
- Configuração do agente (aba Documento) — sem alteração
- Sistema de auth/login — usa o que já existe
- UazAPI/notas do contato — **não vamos** mexer mais nisso (link agora é genérico via WhatsApp pro operador)

## Riscos / rollback
- Risco baixo: tudo novo é frontend reusando edge functions existentes
- Rollback: deletar página + reverter `prepare-label-document-trigger.ts` (1 commit)
- `pending_label_documents` continua sendo escrito (não quebra dashboard)

Posso seguir?
