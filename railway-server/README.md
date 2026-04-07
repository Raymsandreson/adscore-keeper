# RMP Functions Server

Servidor Node/Express que substitui Edge Functions de alto volume do Lovable Cloud para reduzir custos.

## Setup

```bash
cd railway-server
npm install
cp .env.example .env
# Preencha o .env com suas credenciais
npm run dev
```

## Deploy no Railway

1. Crie um projeto no [Railway](https://railway.app)
2. Conecte este diretório como source
3. Configure as variáveis de ambiente (copie do .env.example)
4. Railway detecta automaticamente o `npm start`

## Migrar uma função

1. Crie o handler em `src/functions/nome-da-funcao.ts`
2. Registre no `src/index.ts` no objeto `functionHandlers`
3. No frontend, altere a rota em `src/lib/functionRouter.ts` de `'cloud'` para `'railway'`

## Arquitetura

```
Frontend → functionRouter.ts → Cloud OU Railway
                                  ↕
                            Supabase Externo (DB)
```

O roteador tem fallback automático: se Railway falhar, tenta Cloud.
