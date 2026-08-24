# Sessão anônima no Supabase Externo — levantamento

Levantado em 24/08/2026, a pedido do Raym, depois que a policy de leitura do
bucket `jm-autos` expôs o problema. Tudo aqui é medido, não estimado. O que não
deu para medir está marcado como **lacuna**.

## 1. O fato

O front nunca faz login de verdade no Externo. `ensureExternalSession()`
(`src/integrations/supabase/external-client.ts`) chama `signInAnonymously()`:
qualquer navegador que abra o app ganha um JWT com `role: authenticated` sem
credencial nenhuma.

```
auth.users do Externo (24/08/2026)
  anônimos                       5.225
  com credencial                    54
  desses, que já logaram alguma vez   8
  último login real          06/04/2026
```

O caminho real está morto há quase cinco meses. **Tudo entra pelo anônimo.**

E não para de crescer:

| mês | anônimos criados |
|---|---|
| ago/2026 | 1.545 (mês ainda em curso) |
| jul/2026 | 1.620 |
| jun/2026 | 833 |
| mai/2026 | 1.115 |
| abr/2026 | 115 |

## 2. O que isso abre

**81 das 96 tabelas** do Externo com policy de `SELECT` para `authenticated`
usam `qual = true` — sem condição alguma. Entre elas, conferidas nominalmente:

`leads` · `contacts` · `profiles` · `lead_financials` · `lead_processes`
`jm_valores` · `jm_pagamentos` · `jm_decisoes` · `jm_partes` · `jm_documentos`

E, desde 24/08, o bucket `jm-autos` com **6.031 PDFs de processo**.

Quem tiver a `anon key` — que viaja no bundle, como toda anon key — chama
`signInAnonymously()` e lê tudo isso. Não é falha de código: é a regra fazendo
exatamente o que está escrita.

## 3. Por que o anônimo existe

Não é descuido: existe página **pública**, sem login, que precisa ler o Externo.
Das rotas fora de `ProtectedRoute` em `src/App.tsx`, só duas tocam o Externo:

| rota | página | usa o Externo? |
|---|---|---|
| `/atv/:code` | `AtvShortLinkPage` | **sim** — `ensureExternalSession` + `db` |
| `/booking/:configId/:token` | `BookingPage` | **sim** — `db` (sem `ensureExternalSession`) |
| `/expense-form/:token` | `ExpenseFormPage` | não |
| `/revisar/:token` | `DocumentReviewPage` | não |
| `/avaliar/:token` | `AvaliacaoPage` | não |
| `/share` | `ShareTargetPage` | não |

Essa é a boa notícia do levantamento: a superfície pública é **2 páginas**, não
as 151 que chamam `ensureExternalSession`. As outras 149 rodam atrás de
`ProtectedRoute`, ou seja, com o usuário já logado **no Cloud** — a identidade
existe, só não é levada para o Externo.

Escala total: **402 chamadas** de `ensureExternalSession` em 151 arquivos (fora
os de teste); **132 arquivos** usam o client externo.

## 4. A ponte Cloud → Externo está pela metade

Ela foi começada e parou no meio. A edge `sync-auth-cloud-to-external` diz, na
primeira linha do próprio arquivo:

> Sincroniza shells de auth.users do Cloud -> External (mesmo UUID, **sem
> senha**). Objetivo: satisfazer FKs auth.users(id) no External para a migração
> de dados.

Ou seja: os 54 usuários existem no Externo com o **mesmo UUID** do Cloud, mas
sem senha. Não dá para logar neles. Foram criados para o banco não reclamar de
chave estrangeira, não para autenticar ninguém.

É por isso que o anônimo virou o caminho único.

## 5. As saídas

### A. Trocar sessão via edge (recomendada)

Uma edge `externo-sessao` que recebe o access token do Cloud, valida contra o
Cloud com service role, e devolve uma sessão do Externo para o **mesmo UUID**
(os shells já existem). O front chama `setSession()` no client externo.

`ensureExternalSession()` passa a ser: logado no Cloud → sessão real; página
pública por token → anônimo, como hoje.

Com isso `is_anonymous` vira discriminador utilizável nas policies:

```sql
using (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false)
```

- **Conserta:** os 81 caminhos de uma vez, sem reescrever as 81 policies —
  basta acrescentar a condição onde importa.
- **Não quebra:** as 2 páginas públicas continuam no anônimo.
- **Custo:** uma edge nova, um ajuste no `external-client.ts`, e uma passada
  para decidir quais tabelas exigem não-anônimo.
- **Risco:** médio. Se a troca falhar, o usuário logado perde acesso ao Externo
  — que é o sistema inteiro. Precisa de fallback para anônimo enquanto as
  policies não apertarem, e só apertar depois de a troca estar provada.

### B. Mesmo JWT secret nos dois projetos

Faz o token do Cloud valer no Externo sem edge nenhuma. É a solução mais limpa
no papel e a mais perigosa na prática: trocar o JWT secret do Externo invalida
todo token vivo e a própria anon key. Big bang, sem meio-termo, com o sistema em
produção. **Não recomendo.**

### C. Espelhar senha nos dois

Definir senha nos 54 shells e fazer o login duplo no `AuthForm`. Barato de
escrever e caro de manter: dois cofres de senha, dois fluxos de reset,
divergência silenciosa na primeira troca de senha. **Não recomendo.**

### D. Não fazer nada

O risco não é hipotético e é seu, como advogado: o payload é peça de processo —
CPF, endereço, laudo médico, dado bancário. LGPD e sigilo profissional, não só
incidente de TI.

## 6. Lacunas — o que este levantamento NÃO conseguiu medir

1. **Quantos usuários ativos existem no Cloud** e se os 54 shells do Externo
   cobrem todos. O MCP desta sessão não tem permissão no projeto
   `gliigkupoebmlbwyvijp`. Sem isso não dá para garantir que ninguém fica de
   fora na troca de sessão.
2. **Se `BookingPage` funciona hoje sem `ensureExternalSession`.** Ela usa `db`
   mas não pede sessão — ou depende de uma sessão criada por outra tela antes,
   ou lê tabela com policy para `anon`. Precisa de teste na página real.
3. **Limpeza dos 5.225 anônimos.** Provavelmente inofensivos, mas crescem ~1.500
   por mês e nunca foram podados.

## 7. Ordem sugerida

1. Fechar as três lacunas do item 6.
2. Construir a edge `externo-sessao` com fallback para anônimo — nada aperta
   ainda, nada quebra.
3. Provar em produção que o usuário logado recebe sessão real (medir
   `is_anonymous = false` em `auth.sessions`).
4. Só então apertar as policies, começando pelo bucket `jm-autos` e pelas
   tabelas de valor.

Rollback de cada passo: o passo 2 é aditivo; o 4 se desfaz com um
`alter policy` de volta para `qual = true`, em menos de um minuto.
