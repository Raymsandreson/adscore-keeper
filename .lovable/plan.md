
# Integração WhatsApp Cloud API — Número de Gerência

## Objetivo

Adicionar um número oficial Meta (Cloud API) como **porta de entrada única** do WhatsApp. Mensagem entra → cria/atualiza lead → roteia para um atendente (round-robin combinado com regra de funil/produto) → atendente assume e segue conversando **na instância UazAPI dele**. Não substitui nada do que existe.

## Pré-requisitos do seu lado (bloqueantes — não há código que resolva)

1. **Meta Business Manager** verificado (CNPJ aprovado).
2. **WhatsApp Business Account (WABA)** criada dentro do BM.
3. **Número de telefone novo** que **nunca** tenha sido usado em WhatsApp (regular ou Business). Se já foi, precisa apagar a conta antes em `Configurações → Conta → Apagar minha conta` no app.
4. **App da Meta** com produto "WhatsApp" adicionado.
5. **Token permanente** (System User token, não o token temporário de 24h).
6. **Webhook verify token** (string que você inventa, vou usar para autenticar callbacks da Meta).

Quando estiverem prontos, vou pedir via tool de secrets:
- `WHATSAPP_CLOUD_PHONE_NUMBER_ID`
- `WHATSAPP_CLOUD_WABA_ID`
- `WHATSAPP_CLOUD_ACCESS_TOKEN`
- `WHATSAPP_CLOUD_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_CLOUD_APP_SECRET` (para validar assinatura X-Hub do webhook)

## Arquitetura

```text
                  ┌──────────────────────────┐
   Cliente  ───►  │  Número Gerência (Meta)  │  ◄─── Webhook Meta
                  └────────────┬─────────────┘
                               │
                               ▼
              ┌──────────────────────────────────┐
              │  Edge: whatsapp-cloud-webhook    │  (Railway, 1ª linha)
              │  - valida assinatura X-Hub-256    │
              │  - normaliza payload Meta→interno │
              │  - upsert contato + lead          │
              │  - chama distribuidor             │
              └────────────┬─────────────────────┘
                           ▼
              ┌──────────────────────────────────┐
              │  whatsapp-cloud-router           │
              │  1. casa lead com funil/produto  │
              │     (CTWA, palavra-chave, default)│
              │  2. dentro do pool elegível,     │
              │     round-robin do atendente     │
              │     online com menor carga       │
              │  3. grava assigned_to no lead    │
              │  4. dispara handoff:             │
              │     - msg automática "Oi, sou X" │
              │       saindo do nº de gerência   │
              │     - notifica atendente no chat │
              │       interno + atividade        │
              │     - opcional: encaminha para a │
              │       instância UazAPI dele      │
              └──────────────────────────────────┘
```

## O que entra no banco (Externo)

Tabela nova `whatsapp_cloud_config` (singleton): phone_number_id, waba_id, display name, status.

Tabela `whatsapp_cloud_routing_rules`:
- `priority int`
- `match_type` (`funnel`, `product`, `keyword`, `ctwa_ad`, `default`)
- `match_value text`
- `eligible_user_ids uuid[]` (pool de atendentes para essa regra)
- `is_active`

Tabela `whatsapp_cloud_assignments` (estado do round-robin):
- `rule_id`
- `last_assigned_user_id`
- `last_assigned_at`

Mensagens entram nas tabelas existentes `whatsapp_messages` com `instance_name = 'cloud_gerencia'` para reusar inbox, monitor IA, métricas, fila de follow-up, tudo igual.

## UI (mínima viável — 1 página)

`/whatsapp/cloud` — Aba nova dentro do módulo WhatsApp:
- Card "Status do número" (verde/vermelho, último heartbeat)
- Botão "Configurar credenciais Meta" (leva ao add_secret)
- Lista de regras de roteamento (tabela editável)
- Pool de atendentes online em tempo real
- Histórico de últimos 50 roteamentos (lead → atendente → quanto tempo levou para 1ª resposta)

## Fora do escopo desta primeira entrega

- Templates HSM (mensagens fora de 24h) — entra na fase 2
- Relatórios de SLA por atendente — fase 2
- Transferência manual entre atendentes pelo painel — fase 2
- Migração de instâncias atuais — não acontece, nunca foi pedido

## Detalhes técnicos

- **Onde roda**: webhook na Railway (regra do projeto: novo webhook = Railway primeiro). Edge functions Lovable só como proxy se necessário.
- **Validação de assinatura**: HMAC SHA256 com `WHATSAPP_CLOUD_APP_SECRET` no header `X-Hub-Signature-256`. Sem isso = 401.
- **Identidade da conversa**: `phone` (E.164 sem +) + `instance_name = 'cloud_gerencia'`. Mantém regra do projeto.
- **Round-robin**: `SELECT FOR UPDATE` na linha do `whatsapp_cloud_assignments` da regra para evitar race condition entre webhooks paralelos.
- **Fallback**: se nenhuma regra casar, usa regra `default` (admin define o pool).
- **Sem IA por padrão**: você pediu "distribui atendimentos", não triagem. Não vou plugar WJIA neste número agora — fica como toggle para fase 2.

## Etapas de execução

1. Você confirma o plano e responde se já tem os 5 itens dos pré-requisitos.
2. Crio migrations das 3 tabelas no Externo + valido com `cloud_status`.
3. Subo webhook no Railway + edge proxy mínima no Lovable + valida verify token com a Meta.
4. UI `/whatsapp/cloud` com config e regras.
5. Teste end-to-end: você manda msg para o número → vejo aparecer no inbox → vejo atendente atribuído → confirmo handoff.

## Riscos a manter no radar

- Número não verificável na Meta = bloqueio total. Sem plano B além de trocar de número.
- Token expira se o System User for removido — precisa estar num System User permanente, não no seu user pessoal.
- Cloud API tem rate limit por tier (1k conversas/24h no tier inicial). Se o volume previsto for maior, precisa solicitar upgrade na Meta antes de ir pra produção.
