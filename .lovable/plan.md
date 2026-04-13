

## Plano: Atualizar SENTRY_AUTH_TOKEN

O token que você enviou será usado para atualizar o secret `SENTRY_AUTH_TOKEN` já existente no projeto.

### Passos:
1. Usar a ferramenta de secrets para sobrescrever o `SENTRY_AUTH_TOKEN` com o novo valor.
2. Testar a Edge Function `sentry-issues` para confirmar que o token funciona (sem erro 403).

### Detalhes técnicos
- Nenhuma alteração de código necessária — a Edge Function já usa `Deno.env.get("SENTRY_AUTH_TOKEN")`.
- Após atualizar o secret, a função será testada automaticamente chamando o endpoint de issues.

