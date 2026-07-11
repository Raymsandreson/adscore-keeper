---
name: rodar-localhost
description: Use quando o usuário pedir para "rodar o site", "subir o localhost", "rodar localmente", "previsualizar", "testar as alterações", "ver o que mudou", "abrir em localhost", "iniciar o servidor de desenvolvimento" ou similar. A skill sobe o servidor de desenvolvimento Vite deste projeto (React + TS) em http://localhost:8080 com hot reload, para o usuário ver e testar as mudanças antes de publicar no Lovable.
---

# Rodar o site em localhost (Vite dev server)

Sobe o servidor de desenvolvimento para previsualizar alterações com hot reload.
Stack: **Vite 5 + React 18 + TypeScript**. Porta fixa: **8080** (definida em `vite.config.ts`).

## Passo a passo

1. **Conferir se `node_modules` existe.**
   - Se não existir → rodar `npm install` antes (demora alguns minutos; o projeto é grande:
     Capacitor, Twilio, Lexical, TipTap, etc.).

2. **Validar a instalação** antes de subir. O `npm install` deste projeto às vezes extrai
   incompleto (erros `TAR_ENTRY_ERROR` do `@sentry`) e **não cria o atalho do `vite`** em
   `node_modules/.bin/`. Checar:
   ```bash
   ls node_modules/.bin/ | grep -i vite
   ```
   - Se `vite` **não** aparecer → rodar `npm install` **de novo** (ele completa os atalhos faltantes).
   - Se ainda faltar → apagar `node_modules` e fazer install limpo.

3. **Subir o servidor** (rodar em segundo plano, é processo de longa duração):
   ```bash
   npm run dev
   ```
   Esperar aparecer a linha `Local:   http://localhost:8080/`.

4. **Abrir no navegador:** http://localhost:8080/

## Como o usuário testa

- Deixa a aba aberta em `localhost:8080`.
- Edita arquivo (`.tsx`, `.ts`, `.css`) e **salva** → a tela atualiza sozinha (hot reload).
  Não precisa parar/subir de novo.
- Parar o servidor: `Ctrl + C`.

## Sintomas e correções conhecidas

| Sintoma | Causa | Correção |
|---|---|---|
| `'vite' não é reconhecido como comando` | atalho `.bin/vite` não criado no install | rodar `npm install` de novo |
| `EADDRINUSE` / porta 8080 ocupada | já tem um dev server rodando | reusar a aba existente ou matar o processo na 8080 |
| Tela de login não passa / dados não carregam | falta `.env` com chaves do Supabase | **parar e avisar o usuário** — não mexer em env/secrets sem confirmação (CLAUDE.md) |

## Limites

- Auth e dados vêm do **Lovable Cloud** (vars do `.env`). Publicação no Lovable só após
  confirmação explícita do usuário — `npm run dev` é só local, não publica nada.
- Não rodar `npm install` de **dependência nova** sem confirmação. Reinstalar as já existentes
  (reparar) é OK.
