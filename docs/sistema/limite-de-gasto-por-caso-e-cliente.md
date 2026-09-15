# Limite de gasto por caso (grupo de WhatsApp) e por cliente

Entregue em 11/09/2026. Tela: **Financeiro → Categorias de Despesa** (campo
"Unidade", dentro de "Limite de Gasto") e **Financeiro → Análise de Limites**,
aba **Caso/Cliente**.

## O que mudou

`expense_categories.limit_unit` ganhou duas unidades além das três antigas:

| Unidade | Soma por | Chave |
|---|---|---|
| `per_transaction` | transação | a própria transação |
| `per_day` | dia | `transaction_date` |
| `per_month` | mês | `transaction_date` |
| **`per_whatsapp_group`** | **caso** | grupo de WhatsApp |
| **`per_client`** | **cliente** | `contacts.id` |

A diferença estrutural: as três antigas tiram a chave da própria transação. As
duas novas tiram de outra tabela — e nem toda despesa consegue resolver.

`limit_unit` é TEXT livre, sem CHECK (conferido no Externo em 11/09/2026), então
os valores novos não exigiram migration na coluna.

## Como a despesa acha o caso e o cliente

Ordem de precedência (`src/lib/limitesPorVinculo.ts`):

**Grupo (caso)**
1. `transaction_category_overrides.group_jid` — escolhido à mão no categorizador
2. grupo **único** do lead (união de `lead_whatsapp_groups` e `leads.whatsapp_group_id`, deduplicada por jid)
3. `contacts.whatsapp_group_id` do contato vinculado

**Cliente**
1. `transaction_category_overrides.contact_id` — escolhido à mão
2. contato do lead marcado como `contact_leads.is_primary_client`
3. contato **único** do lead em `contact_leads`

⚠️ A ponte lead↔contato é **`contact_leads`**, não `contacts.lead_id`. Medido em
11/09/2026: a ponte tem 10.264 vínculos cobrindo 8.545 leads; `contacts.lead_id`
enxerga 1.270. Usar a coluna em vez da ponte deixa 92% dos vínculos invisíveis —
foi o erro da primeira versão desta entrega, corrigido no mesmo dia.

O nome do grupo vem de **`whatsapp_groups_index`** (6.690 jids, 99,9% com nome),
não de `whatsapp_groups_cache` (1.986). Mesma origem de erro, mesma correção.

"Único" é literal. Lead com dois grupos não vira chute: vira pendência.

## Pendência não é filtro

Despesa que não resolve a chave **não some da conta e não é descartada**. Ela sai
na aba Caso/Cliente como pendência, com o motivo e o que fazer:

| Motivo | O que resolve |
|---|---|
| `sem-vinculo` | vincular lead ou contato na despesa |
| `lead-sem-grupo` | criar/vincular o grupo do caso no lead |
| `lead-com-varios-grupos` | escolher o caso no seletor de grupo da despesa |
| `lead-sem-contato` | vincular o cliente na despesa |
| `lead-com-varios-contatos` | marcar o cliente principal no lead, ou escolher o contato na despesa |

É a Regra 8 do CLAUDE.md: a heurística que não consegue resolver é detector, não
filtro. Somar só o que resolve e esconder o resto trocaria um total errado por
outro total errado.

## Estado da base em 11/09/2026

Números medidos que explicam o que a tela mostra hoje:

- 86 despesas categorizadas: 38 com `lead_id`, 2 com `contact_id`
- os 38 apontam para 7 leads distintos, e **6 desses 7 não têm grupo nenhum**
  (são leads de viagem: "BELÉM/PA (JM244)", "SANTA RITA/MA (JM232)")
- 3.998 leads têm grupo; 2.689 aparecem em `lead_whatsapp_groups`, e 5 deles têm
  2+ grupos
- 4.108 leads viraram cliente; 46 compartilham telefone com outro lead

Ou seja: no dia da entrega a aba nasce quase toda em pendência, e isso está
certo — é o retrato de que a despesa ainda não sabe de que caso é. A conta só
enche na medida em que os leads ganham grupo e as despesas ganham vínculo.

## Por que o grupo, e não `legal_cases`

`legal_cases` é a entidade Caso de verdade (skill `lead-vs-case-identity`). Não
foi usada como chave porque cobre menos: 1.824 leads têm caso registrado, contra
3.998 leads com grupo de WhatsApp, de 4.108 leads fechados (11/09/2026). Nenhuma
despesa de hoje alcança um `legal_cases` pelo lead.

O grupo é o proxy mais completo do caso fechado hoje — foi por isso que a unidade
se chama "Por grupo de WhatsApp (caso)" e não "Por caso". Se `legal_cases` for
povoada de verdade, a chave certa passa a ser ela, e a troca é local: só
`resolverGrupo` em `src/lib/limitesPorVinculo.ts`.

## Custo

Nenhuma chamada de LLM, nenhuma invocation nova. O cálculo é local; os mapas
lead ↔ grupo ↔ contato saem de 5 consultas `.in()` (`useVinculoDespesas`): três em
paralelo (leads, `lead_whatsapp_groups`, `contact_leads`), depois os nomes dos
contatos e os nomes dos grupos. Todas limitadas aos ids que as despesas citam —
nunca os 28k leads ou 36k contatos.

## Arquivos

- `src/lib/limitesPorVinculo.ts` — resolução e soma (puro, 16 testes)
- `src/lib/__tests__/limitesPorVinculo.test.ts`
- `src/hooks/useVinculoDespesas.ts` — mapas + `useGruposDoLead`
- `src/components/finance/ExpenseCategoryManager.tsx` — as duas opções no dropdown
- `src/components/finance/LimitAnalysisPanel.tsx` — aba Caso/Cliente
- `src/components/finance/TransactionCategorizer.tsx` — seletor de grupo
- `supabase/migrations/20260911030000_despesa_aponta_o_grupo_do_caso.sql`

## Rollback

`ALTER TABLE public.transaction_category_overrides DROP COLUMN IF EXISTS group_jid;`
mais reverter o commit. Nenhum dado anterior é reescrito: a coluna nasce NULL e
tudo continua deduzindo pelo lead como antes.
