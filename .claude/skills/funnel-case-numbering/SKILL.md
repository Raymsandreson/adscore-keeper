---
name: funnel-case-numbering
description: Como funciona a numeração de casos fechados por funil (prefixo + sequência). Use quando o usuário falar em "PREV 1448", "case_number", "prefixo do funil", numeração de leads fechados, sequência de casos, ou quando algo bater errado no nome dos grupos pós-fechamento.
---

# Numeração de Casos Fechados — Por Funil

Metáfora: cada funil é uma padaria com sua própria fila de senha. Não existe um único dispenser de senha pra empresa toda — tem um por funil.

## Anatomia do nome de um lead fechado

Exemplo: `✅ PREV 1448 — Hilda Maria / Atendente`

| Pedaço | De onde vem |
|---|---|
| `✅` | Sufixo fase fechada, adicionado em `regenerate-lead-name.ts` |
| `PREV` | `board_group_settings.n` (alias `closed_group_name_prefix`) — **configurado no Onboarding do funil** |
| `1448` | `leads.case_number` (se salvo) **OU** posição calculada por `computeClosedPosition` |
| `Hilda Maria / Atendente` | Concat dos `lead_fields` configurados |

## Onde o prefixo é configurado

- UI: `src/components/whatsapp/BoardGroupInstancesConfig.tsx` (campo "N°" → propriedade `settings.n`) — exposto pelo `OnboardingPostCloseConfig`.
- Tabela: `board_group_settings.n` (Externo). Alias antigo `closed_group_name_prefix` ainda aceito.
- **Um prefixo por board_id.** Funis diferentes = prefixos diferentes. Funis que compartilham domínio (ex: Acidente Caso + Acidente Família, se forem boards separados) precisariam compartilhar prefixo manualmente OU virar UM board só.

## Como a sequência é calculada

`railway-server/src/functions/regenerate-lead-name.ts` linhas 131-162:

1. Se `leads.case_number` está preenchido → **usa ele direto** (override manual, fonte de verdade).
2. Senão → chama `computeClosedPosition(board_id, lead_id)`:
   - Lê todos `onboarding_checkpoints` com `step='setup_lead_close'` e `status='done'`
   - Filtra pelos que pertencem ao mesmo `board_id` (via join em `leads`)
   - Ordena por `confirmed_at` ASC
   - Posição = índice 1-based do lead alvo
3. Resultado vira o número do prefixo.

Função auxiliar pra UI: `railway-server/src/functions/lead-close-sequence-info.ts` (retorna posição + total + lead anterior).

## Casos comuns e o que checar

| Sintoma | Causa provável | Verificar |
|---|---|---|
| Nome saiu sem número | Funil sem `settings.n` configurado | `SELECT board_id, n FROM board_group_settings WHERE board_id = X` no Externo |
| Número errado/duplicado | `leads.case_number` salvo errado OU checkpoint duplicado | Conferir `leads.case_number` e `onboarding_checkpoints` daquele board |
| Buraco na sequência | Lead deletado, checkpoint não-`done`, ou re-fechamento | Sequência é dinâmica — buraco "no passado" só conserta editando `case_number` manualmente |
| Dois funis com mesmo prefixo gerando conflito | Cada um tem sua sequência própria — não conflita no número, mas confunde o usuário | Renomear `n` num dos dois |
| Próximo número não bate | Override manual em algum lead recente fora de ordem | `SELECT lead_name, case_number FROM leads WHERE board_id=X AND lead_status='closed' ORDER BY became_client_date DESC LIMIT 10` |

## NÃO faça

- ❌ Criar tabela paralela de "contadores por prefixo". A sequência **já existe** via `case_number` + checkpoints.
- ❌ Tentar consertar buracos antigos varrendo 1500 leads com regex. Confiar no que está salvo e seguir em frente.
- ❌ Misturar lógica de "lead aberto" (LEAD-{lead_number}({case_prefix})) com fechado (prefixo manual + nº). São fases distintas no mesmo arquivo.
- ❌ Confundir `products_services.case_prefix` (usado só em LEAD aberto) com `board_group_settings.n` (usado no fechado).

## Para incluir um funil novo na lógica

1. Configurar `board_group_settings` daquele board com `n = 'PREFIXO'` no OnboardingPostCloseConfig.
2. Pronto. Primeira vez que um lead fechar nesse funil, ele vira `PREFIXO 1`.

## Para ajustar a sequência manualmente

Editar `leads.case_number` daquele lead. O `regenerate-lead-name` respeita o valor salvo.

## Arquivos-chave

- `railway-server/src/functions/regenerate-lead-name.ts` — gera o nome
- `railway-server/src/functions/lead-close-sequence-info.ts` — consulta posição
- `src/components/whatsapp/BoardGroupInstancesConfig.tsx` — UI do prefixo
- `src/components/whatsapp/OnboardingPostCloseConfig.tsx` — container do onboarding pós-fechamento
- Tabela Externo: `board_group_settings` (campo `n`)
- Tabela Externo: `leads.case_number`
- Tabela Externo: `onboarding_checkpoints` (step `setup_lead_close`)
