---
name: supabase-externo-constraints
description: Constraints absolutas para projetos cujo backend eh um Supabase externo do usuario, nao o Lovable Cloud. Deve ser carregado sempre que houver qualquer operacao envolvendo banco, edge functions, migrations, secrets ou backend neste projeto.
---

# Supabase Externo — Regras Inviolaveis

## 1. Lovable Cloud = morto para dados de negocio
- **NUNCA** sugerir, mencionar ou habilitar "Lovable Cloud".
- **NUNCA** usar `supabase--enable`, `ai_gateway--enable`, `payments--enable_*`.
- O banco interno (Cloud) permanece ativo **apenas** para auth, profiles e roles (arquivos mortos).
- Novas tabelas, colunas, triggers e dados de negocio vao **sempre** para o Supabase externo do usuario.

## 2. Banco de dados externo
- Todo SQL novo (tabelas, colunas, RLS, policies, triggers) deve ser aplicado via `run-external-migration` ou instrucoes ao usuario para rodar `supabase db push`.
- Nunca colar SQL em paineis do Lovable.
- Ao criar tabelas no schema `public`, SEMPRE incluir `GRANT` no mesmo migration para `authenticated` e `service_role`.
- RLS policies devem usar `has_role()` quando houver papéis, evitando recursao.

## 3. Edge Functions
- Edicoes em `supabase/functions/*` nunca refletem automaticamente no projeto externo.
- Apos editar uma edge function, lembrar o usuario de rodar `supabase functions deploy <nome>` via CLI.
- Incluir `_functionVersion: FUNCTION_VERSION` em toda resposta JSON da function.
- Antes de bumpar `FUNCTION_VERSION`:
  1. Ler valor atual no arquivo (`rg FUNCTION_VERSION supabase/functions/<nome>/index.ts`).
  2. Se possivel, confirmar versao em producao (network response `_functionVersion`).
  3. Bumpar para numero estritamente maior que ambos.

## 4. Migrations
- Arquivos em `supabase/migrations/*.sql` criados pelo Lovable **NAO** rodam sozinhos.
- Apos criar/editar uma migration, SEMPRE instruir o usuario:
  1. `git pull` no repositorio local.
  2. `supabase db push` para aplicar no banco remoto.

## 5. Secrets
- Secrets ficam no Dashboard Supabase → Project Settings → Edge Functions → Secrets (ou `supabase secrets set NAME=value` via CLI).
- Nunca usar o painel de secrets do Lovable.

## 6. Guidance ao usuario
- Quando o usuario precisar configurar algo no Supabase, dar **passo-a-passo GUI detalhado**:
  - Caminho completo: "Dashboard → Project → [Secao] → [Sub-aba] → [Botao]"
  - Nome exato de botoes/toggles/campos.
  - Ordem clara (1, 2, 3...).
  - O que preencher em cada campo.
  - Onde clicar para salvar.
- Instrucoes vagas como "vai em auth settings" sao proibidas.

## 7. Debug de deploy
- Se uma edge function parece nao refletir mudancas:
  1. Testar via `curl` direto na URL da function com JWT do usuario.
  2. Verificar `_functionVersion` retornado vs codigo no repo.
  3. Se diferente, o deploy nao chegou. Pedir ao usuario para rodar `supabase functions deploy <nome>`.
  4. Nao continuar editando o codigo — novas edits vao para o mesmo limbo.
