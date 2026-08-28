# Carteira — o que ficou pendente em 27/08/2026

Balanço para a próxima sessão começar do zero sem depender da memória de
ninguém. O que está fechado tem commit; o que está aberto tem dono.

---

## O que fechou nesta sessão

| Entrega | Commit |
| --- | --- |
| Regra "solução estrutural, nunca band-aid" no CLAUDE.md + skill `conserto-estrutural-nao-pontual` | `a1edc6f46` |
| Conferência (era "conciliação") — renome em tela e código | `bca858540` |
| Carteira por titular: 3 modos, estágio por dono, relação clicável | `c3a9c03a2` |
| **Truncamento de 1.000 linhas na RPC** — faltavam R$ 15.734.545,98 | `16704d31e` |
| Correção: a cota zerada não era erro de importação | (doc § 18) |
| `const rpc = db.rpc` perdia o `this` e derrubou a tela | `34e2cfc0a` |
| Chamada da RPC imune ao `this` + erro etiquetado por página | `0d6047764` |

Confirmado na tela em 27/08 09:32: **R$ 92.141.737 · 1.050 processos · 720
partes · recebido R$ 5.667.786,85** — bate com o banco no centavo.

---

## 1. Esperando decisão do Raym — nada anda sem isso

### 1.1 A régua dos estágios (a maior)

`pop_carteira_marcos` carimba `A_RECEBER` em qualquer processo com marco de
acordo, **antes de perguntar se existe data**:

```sql
when pp.tem_acordo then 'A_RECEBER'
```

Das 183 partes hoje em A_RECEBER, **zero** tem parcela datada em
`jm_pagamentos`. Pelo vocabulário, A RECEBER exige valor **e** data.

Planilha entregue: `carteira-inconsistencias.xlsx` (3 abas, cor por
gravidade) + `carteira-reclassificacao-proposta.csv`.

| Estágio | Hoje | Proposto |
| --- | ---: | ---: |
| Projetado | 5.549.368,42 | 59.677.802,03 |
| Condenação | 66.634.232,32 | 27.776.200,99 |
| A receber | 15.270.402,28 | **0,00** |
| Pago | 4.687.733,79 | 4.687.733,79 |

Total intacto: R$ 92.141.736,81. **É DDL em produção — não aplicar sem o ok.**

Duas dúvidas dentro dela que só o Raym responde:

- **Confiar no `status_pagamento` da Tab. Aux.?** É o que move R$ 46,2 mi de
  CONDENAÇÃO para PROJETADO. Casos `00101943620245030058` e
  `00010547220235060011` têm leitura de decisão e a Tab. Aux. diz PROJETADO.
- **Tab. Aux. diz PAGO mas `jm_pagamentos` está vazio** (11 processos,
  R$ 1.515.030,35): já receberam e falta importar o cronograma, ou o status da
  planilha está errado? Não há caminho no dado para decidir.

### 1.2 A tela deve excluir INSS?

O Raym exclui `subcategoria = 'INSS'` ao conferir; a tela não exclui. São
R$ 57.244,98 que entram na conta e não acham CNJ no POP trabalhista.

### 1.3 Reimport da planilha de honorários

Última importação: **18/08/2026 22:41** — 9 dias de defasagem, R$ 20.256,89 em
4 linhas que o banco não viu. Escrita em produção, precisa de ok.

---

## 2. Código pendente, sem bloqueio de decisão

### 2.1 Conferência e carteira leem fontes diferentes

A conferência lê `jm_valores`; a carteira cai em `jm_partes` quando
`jm_valores` não cobre o CNJ. No `0001529-83.2024.5.08.0125` (CASO 219) isso dá
**R$ 0,00 numa tela e R$ 2.010.774,78 na outra**, para o mesmo processo.

Conserto: a conferência lê a mesma fonte que a carteira usou, e diz qual é.

### 2.2 Qual fonte vale quando as duas existem

115 dos 190 CNJs divergem. Separado por razão para não chamar correção
monetária de erro:

| Faixa | CNJs | Na carteira | Na Tab. Aux. |
| --- | ---: | ---: | ---: |
| até 3x (correção explica) | 48 | 16.558.775,80 | 29.748.046,99 |
| 3x a 10x (conferir) | 48 | 10.849.214,21 | 49.968.403,25 |
| **acima de 10x (absurdo)** | 10 | 1.161.546,51 | 35.096.330,08 |
| Tab. Aux. MENOR (estranho) | 2 | 820.000,00 | 376.029,20 |

O pior: `01004197420215010281` — carteira R$ 500.000,00, Tab. Aux.
R$ 22.633.976,11 (45x), honorário R$ 21.193.632,20.

### 2.3 `honorario_parte` junta HC e HS

Uma coluna só. Separar exige mexer na RPC.

---

## 3. Aberto de sessões anteriores

- **Sessão anônima**: `ensureExternalSession()` chama `signInAnonymously()` —
  "authenticated" no Externo = qualquer um que abre o app. 5.225 anônimos
  contra 54 credenciados; último login real 06/04/2026. O caminho levantado é
  a edge `externo-sessao` traduzindo via `auth_uuid_mapping` (52 linhas, 36/36
  usuários ativos cobertos). Doc: `acesso-externo-sessao-anonima.md`.
- **Dois motores de marcos**: `process_movements` (aba Marcos) e
  `process_pop_marcos` (trilha) discordam.
- **`process_documents`** mostra 0 na aba Documentos enquanto `jm_documentos`
  tem 140 documentos reais.
- **563 partes sem separação de titular** (origem `decisao`, R$ 32,0 mi):
  depende de ler a conta de liquidação, não de código.
- **251 partes de projeção sem cota** (R$ 59,7 mi): saem sozinhas quando a
  decisão sair e for lida. Não é peça que falta, é decisão.

---

## 4. Segurança — pendente e sensível

Um print compartilhado no WhatsApp continha credenciais de acesso a sistema
externo em texto claro. A recomendação segue de pé: **apagar as mensagens para
todos e rotacionar as senhas**. Nada foi feito até aqui.

---

## Lições que já viraram regra

1. **Consulta que pode passar de 1.000 linhas se pagina.** Terceira ocorrência
   do mesmo teto do PostgREST (`vw_jm_conferencia_acordos`,
   `process_pop_marcos`, `pop_carteira_marcos`). Não existe "essa aqui é
   pequena".
2. **Nunca guarde `cliente.rpc` numa variável.** `const rpc = db.rpc`
   desvincula o `this` e o supabase-js morre com "reading 'rest'". A chamada
   fica sempre `db.rpc(...)`, na mesma expressão.
3. **Mock que não usa `this` não prova nada.** O teste passava com a tela
   quebrada em produção; agora o mock levanta o mesmo `TypeError`.
4. **Tela não conserta dado** — CLAUDE.md § 8 e a skill
   `conserto-estrutural-nao-pontual`.
