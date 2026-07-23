---
name: Lead vs Case vs Process Identity
description: Hierarquia Empresa→Núcleo→Produto→Funil de Vendas→Caso→Processos→POP. Lead≠Caso≠Processo. Funil de Vendas (lead) ≠ POP (processo; antigo "Fluxo de Trabalho"). Numeração separada, grupo WA = nome do caso, processo INSS vincula no caso.
type: feature
---

# Lead vs Caso vs Processo

Metáfora: **Lead = namoro, Caso = casamento, Processos = filhos.** Cada filho (processo) corresponde a um produto contratado, vinculado a um núcleo, executado num POP próprio.

## Hierarquia (aba Ecossistema em Finanças)

`Empresa → Núcleo → Produto → Funil de Vendas → Time → [fechado] → Caso → Processos → POP`

- 1 Lead → no máximo 1 Caso.
- 1 Caso → N Processos (1 por produto contratado).
- 1 Processo → 1 Produto → 1 Núcleo → 1 POP.

## Funil de Vendas ≠ POP

- **Funil de Vendas** = trilho do **lead** (vendas/captação).
- **POP** = trilho do **processo** (execução).
- Caso não tem funil. Caso tem processos, cada um com seu POP.

## As 3 regras invioláveis

### 1. Numeração é separada
- **`leads.lead_number`** — sequência de TODOS os leads (entram fechando ou não). Ex: `PREV 2815`.
- **`leads.case_number`** (= número do caso) — sequência **cronológica de fechamento POR FUNIL**. Só quem fecha entra. Prefixo vem de `board_group_settings.n`.
- Os números **não batem** e não devem bater. Lead 2820 pode ser Caso 1297.
- Detalhes da numeração de caso: ver skill `funnel-case-numbering` e memória `funnel-case-numbering`.

### 2. Nome do grupo WhatsApp = NOME DO CASO
- Enquanto lead aberto: grupo (se houver) segue o nome do lead.
- No fechamento: grupo é renomeado pro padrão do caso (`{prefixo} {case_number} — {dados}`).
- **Nunca** usar `lead_number` no nome do grupo de cliente fechado. Sempre `case_number`.

### 3. Número do processo (INSS, judicial) vincula no CASO
- Processo administrativo INSS, processo judicial, nº de requerimento → tudo isso é atributo do **caso**, não do lead.
- A tela de "Vincular órfão INSS" deve oferecer **casos** como destino. Lead aparece só como atalho pra abrir o caso correspondente (ou criar caso se ainda não existe).
- Custom field "Nº Requerimento INSS" deve viver em `legal_cases` (ou `lead_processes`), não em `lead_custom_field_values` ligado ao lead.

## Anti-padrões — recusar

- ❌ "Vou usar o lead_number no nome do grupo do cliente fechado" — NÃO. Usa case_number.
- ❌ "Vincula esse processo INSS no lead" — NÃO. Vincula no caso. Se não tem caso, cria.
- ❌ "Lead e caso compartilham o mesmo número" — NÃO. São sequências independentes.
- ❌ "Caso usa o prefixo do produto" — NÃO. Caso usa prefixo do funil (`board_group_settings.n`). Produto tem outro prefixo (`products_services.case_prefix`) usado só no LEAD aberto.

## Tabelas envolvidas

| Coisa | Tabela.coluna | Onde |
|---|---|---|
| Sequência do lead | `leads.lead_number` | Externo |
| Sequência do caso | `leads.case_number` (espelhado) + `legal_cases.case_number` | Externo |
| Prefixo do caso (por funil) | `board_group_settings.n` | Externo |
| Nome do caso (gerado) | `legal_cases.title` + lógica em `regenerate-lead-name.ts` | Externo + Railway |
| Vínculo lead↔grupo | `lead_whatsapp_groups` | Externo |
| Processo INSS admin | `inss_admin_processes.case_id` (primário) + `lead_id` (espelho) | Externo |

## Onde a lógica vive

- `railway-server/src/functions/regenerate-lead-name.ts` — monta nome do lead/caso/grupo
- `railway-server/src/lib/inss-matcher.ts` — match de órfão INSS → caso
- `src/components/processes/InssAdminProcessesTab.tsx` — UI de vinculação manual
