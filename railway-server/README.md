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

## Configurar webhook da UazAPI

Após o deploy, atualize o webhook URL em cada instância UazAPI:

```
https://[seu-app].up.railway.app/functions/whatsapp-webhook
```

> **Importante:** Se estiver usando autenticação via API Key (`RAILWAY_API_KEY`),
> a UazAPI não envia headers customizados. Duas opções:
> 1. Deixe `RAILWAY_API_KEY` vazio no Railway (desativa autenticação nessa rota)
> 2. Use um proxy/middleware que injete o header `x-api-key`

## Funções migradas

| Função | Rota | Volume | Status |
|--------|------|--------|--------|
| `whatsapp-webhook` | `POST /functions/whatsapp-webhook` | ~4.000/dia | ✅ Migrada |

## Arquitetura

```
UazAPI Webhook → Railway (whatsapp-webhook)
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
