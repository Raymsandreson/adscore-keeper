# RMP Functions Server

Servidor Node/Express que substitui Edge Functions de alto volume do Lovable Cloud para reduzir custos.

## Setup local

```bash
cd railway-server
npm install
cp .env.example .env
# Preencha o .env com suas credenciais
npm run dev
```

## Deploy no Railway

1. Crie um projeto no [Railway](https://railway.app)
2. Conecte este diretório como source (root directory: `railway-server`)
3. Configure as variáveis de ambiente (copie do `.env.example`)
4. Railway detecta automaticamente o `npm start`

## Webhook da UazAPI — URL pública (sem API key)

Configure o webhook de **cada instância** UazAPI para:

```
https://[seu-app].up.railway.app/webhooks/uazapi/{instance_name}
```

Substitua `{instance_name}` pelo nome exato da instância (case-insensitive — é normalizado no handler).

> Esta rota é **pública** (não exige `x-api-key`), pois a UazAPI não envia
> headers customizados. A segurança é feita pelo handler, que valida
> `instance_name` contra o banco antes de persistir qualquer dado.

### Padronização das 22 instâncias

Para cada instância no painel UazAPI:

1. **Habilitado**: ON
2. **URL**: `https://[seu-app].up.railway.app/webhooks/uazapi/<NOME_DA_INSTANCIA>`
3. **Escutar eventos**: `messages`, `messages_update`, `connection`, `presence`, `chats`, `groups`, `calls`
4. **Excluir eventos**: vazio
5. **wasSentByApi**: incluir (precisamos rastrear envios via API)
6. **isGroupYes**: incluir

### Rotas internas protegidas (com x-api-key)

Outras rotas continuam exigindo `RAILWAY_API_KEY` no header `x-api-key`:

- `POST /functions/whatsapp-webhook` (rota legada — equivalente à pública)
- `POST /functions/call-queue-processor`
- `POST /functions/repair-whatsapp-group`

## Funções migradas

| Função | Rota pública | Rota interna | Volume |
|--------|--------------|--------------|--------|
| `whatsapp-webhook` | `POST /webhooks/uazapi/:instance_name` | `POST /functions/whatsapp-webhook` | ~4.000/dia |
| `call-queue-processor` | — | `POST /functions/call-queue-processor` | baixo |
| `repair-whatsapp-group` | — | `POST /functions/repair-whatsapp-group` | sob demanda |

## Arquitetura

```
UazAPI Webhook → Railway (/webhooks/uazapi/:instance_name)
                    ↕                    ↕
              Supabase Externo    Lovable Cloud (funções de IA)
                  (DB/Storage)    (wjia-agent, ai-agent-reply, etc.)
```

O webhook no Railway:
- Processa mensagens, chamadas, deduplicação, media download
- Persiste dados no Supabase externo
- Espelha mensagens no Cloud DB para o frontend
- Delega funções de IA para o Lovable Cloud via fire-and-forget HTTP calls

## Migrar uma nova função

1. Crie o handler em `src/functions/nome-da-funcao.ts`
2. Importe e registre no `src/index.ts` no objeto `functionHandlers`
3. No frontend, altere a rota em `src/lib/functionRouter.ts` de `'cloud'` para `'railway'`
