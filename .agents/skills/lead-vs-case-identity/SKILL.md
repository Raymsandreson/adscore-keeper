---
name: lead-vs-case-identity
description: Regras invioláveis sobre a hierarquia organizacional do AdScore Keeper — Empresa→Núcleo→Produto→Funil de Vendas→(fechado)→Caso→Processos→POP. Cobre identidade de Lead vs Caso, numeração separada, nome de grupo WhatsApp, vinculação de processo (INSS/judicial), e diferença entre Funil de Vendas (lead) e POP (processo; antigo "Fluxo de Trabalho"). Use pra ADVERTIR quando o pedido contrair essa lógica.
---

# Lead vs Caso vs Processo — Identidade e Hierarquia

Metáfora central: **Lead é o namoro, Caso é o casamento, Processos são os filhos.** Todo casamento veio de um namoro, mas nem todo namoro vira casamento. E todo filho nasce dentro de um casamento, nunca solto no namoro.

## Hierarquia organizacional (fonte: aba Ecossistema em Finanças)

```
Empresa
  └── Núcleo (área especializada do escritório)
        └── Produto (o que a empresa vende)
              └── Funil de Vendas (caminho do lead até virar cliente)
                    └── Time (quem trabalha o funil)
                          │
                          ▼ (fechamento)
                    Caso (cliente já fechou — 1 lead = 1 caso)
                          └── Processos (vários por caso — 1 por produto contratado)
                                └── POP (esteira de execução do processo)
```

Regras de cardinalidade:
- 1 Lead → no máximo 1 Caso (quando fecha).
- 1 Caso → N Processos.
- 1 Processo → 1 Produto → 1 Núcleo.
- 1 Processo → 1 POP próprio.

### Funil de Vendas ≠ POP

| Aspecto | Funil de Vendas | POP |
|---|---|---|
| Vinculado a | **Lead** | **Processo** (`lead_processes`) |
| Objetivo | Levar lead até fechamento | Executar o processo contratado |
| Quem usa | Time de vendas/captação | Time de execução (jurídico, etc.) |
| Quantidade por entidade | 1 funil por lead | 1 POP por processo |
| Tabela base | `kanban_boards` (board do lead) | `kanban_boards` (workflow do processo) |

🚫 Confundir os dois é erro comum. Recusar:
- "Coloca esses leads no POP X" → NÃO. Lead vai em **funil**, não POP.
- "Esse caso está em qual funil?" → Caso não tem funil. Caso tem processos, e cada processo tem POP.
- "Move o processo pro funil de vendas" → NÃO. Processo só vive em POP.

### Status: do lead (funil) vs do processo (POP) — grãos diferentes

O mesmo corte vale pro **status/resultado**. Nunca faça o status do processo subir pro lead nem vice-versa.

- **Status do lead** = vem do **funil de vendas** (comercial). Ex.: `Fechado`. Lead `Fechado` **gera o caso**.
- **Status do processo** = vem do **POP daquele processo** (jurídico). Cada processo tem o **seu próprio** status, escolhido entre os cadastrados no POP (`kanban_boards.settings.resultados`).
- Um caso tem N processos → N status independentes, um por processo/POP. Não existe "o status do caso".

Onde vive (tudo no Externo, tabela `lead_processes`):
- `resultado_esperado_ids` (no `kanban_boards.settings` do POP) — o(s) status **esperado(s)**; **pode ser mais de um** (ex.: `Acordo` ou `Procedência` contam como sucesso). `resultado_esperado_id` (single) é legado/compat.
- `resultado_esperado_id_override` — override do esperado **por-processo** (NULL = herda do POP).
- `resultado_atingido*` (`_id`, `_tipo`, `_data`, `_fonte`, `_ref`, `_status`) — o status **atingido**, detectado sozinho: das **movimentações do Escavador** (POP judicial) ou da **intimação por e-mail** (`processual_emails`, POP administrativo). Não é digitado à mão pelo usuário. Marco inequívoco (trânsito/acordo/pagamento) auto-confirma; o resto é sugestão que o assessor confirma.

**Telão** (`tv_atividades_ranking`, coluna STATUS ESPERADO): conta no **grão de processo**, por **responsável** (`responsible_user_id`), no **mês em que o resultado aconteceu** (`resultado_atingido_data`) — não quando foi cadastrado/detectado. Time comercial (funil) segue contando o resultado do lead; time de execução (POP) conta os processos que atingiram o esperado.

🚫 Recusar:
- "Espelha o status do processo no lead / em `leads.pop_result_id`." → NÃO. Grãos diferentes; status de processo não sobe pro lead.
- "Deixa o usuário digitar o status atingido do processo." → NÃO. Ele é detectado das movimentações/e-mail; a mão do usuário é só confirmar/ajustar.
- "Conta o resultado do telão no mês em que foi cadastrado." → NÃO. Conta no mês em que o resultado efetivamente aconteceu.

## Quando esta skill DEVE travar uma execução

Se o pedido do usuário (ou de outro agente) violar uma das 3 regras abaixo, **PARE, ADVIRTA e peça confirmação explícita**. Não execute "por boa vontade". A organização tem essas regras por motivo operacional — quebrar é introduzir bug que demora semanas pra aparecer.

### Regra 1 — Numeração de lead ≠ numeração de caso

- `leads.lead_number` = sequência de **todos os leads** que entraram (fecharam ou não).
- `leads.case_number` = sequência **cronológica de fechamento por funil**. Só fechados.
- Prefixo do caso vem de `board_group_settings.n` (cada funil tem o seu).
- **Os números não batem.** Lead 2820 pode ser Caso 1297. Isso é correto, não é bug.

🚫 Recusar:
- "Faz lead e caso usarem o mesmo número."
- "Cria contador único pra organização toda."
- "Renomeia leads em aberto pra usar o case_number."

### Regra 2 — Nome do grupo WhatsApp espelha o NOME DO CASO (quando há caso)

- Lead em aberto + grupo existente → grupo segue `lead_name`.
- Lead fecha → grupo é renomeado pro nome do **caso** (`{prefixo} {case_number} — {dados}`).
- O `lead_name` do lead fechado também usa o padrão de caso (`✅ PREV 1297 — Nome / Atendente`).

🚫 Recusar:
- "Usa lead_number no grupo do cliente fechado." → NÃO. Usa case_number.
- "Cria nome de grupo diferente do nome do caso." → NÃO. Tem que ser igual.
- "Mantém o grupo com o nome antigo do lead depois de fechar." → NÃO. Renomeia.

### Regra 3 — Nº de processo (INSS, judicial, requerimento) é atributo do CASO

- Processo administrativo INSS, processo judicial, nº de requerimento → **caso**, não lead.
- Tela "Vincular órfão INSS" deve oferecer **casos** como destino primário.
- Se ainda não existe caso para o lead, ofereça criar o caso e vincular nele.
- `inss_admin_processes.case_id` é a fonte de verdade. `lead_id` é só espelho de conveniência.

🚫 Recusar:
- "Vincula o número do processo direto no lead, ignora o caso."
- "Cria custom field 'Nº Processo' no lead." → NÃO. Vai em `legal_cases` / `lead_processes`.
- "Lead em aberto recebe número de processo." → Quase nunca. Confirmar antes.

## Postura ao detectar violação

```
🚨 Espera. O pedido viola a regra X da skill `lead-vs-case-identity`:

[citar a regra exata]

Motivo organizacional:
[explicar o porquê com metáfora]

Se mesmo assim você quer seguir, me confirme:
"Sim, sei que isso quebra [X], segue mesmo assim."
```

Não execute até receber a confirmação literal.

## Onde a lógica vive (pra investigar antes de mexer)

- `railway-server/src/functions/regenerate-lead-name.ts` — gera nome do lead/caso/grupo
- `railway-server/src/functions/lead-close-sequence-info.ts` — consulta posição na sequência
- `railway-server/src/lib/inss-matcher.ts` — match de órfão INSS → caso
- `src/components/processes/InssAdminProcessesTab.tsx` — UI de vinculação manual de INSS
- `src/components/whatsapp/BoardGroupInstancesConfig.tsx` — config do prefixo de caso (`settings.n`)

## Tabelas-chave (todas no Externo)

| Atributo | Tabela.coluna |
|---|---|
| Sequência do lead | `leads.lead_number` |
| Sequência do caso | `leads.case_number` + `legal_cases.case_number` |
| Prefixo do caso por funil | `board_group_settings.n` |
| Vínculo lead↔grupo WA | `lead_whatsapp_groups` |
| Processo INSS admin | `inss_admin_processes` (`case_id` primário) |
| Caso jurídico | `legal_cases` (`lead_id`, `case_number`, `title`) |

## Skills/memórias relacionadas

- `funnel-case-numbering` — detalhe de como `case_number` é calculado
- `db-tables-map` — antes de criar tabela nova, ver se já existe
- memória `policy/leads/lead-vs-case-identity` — versão resumida pra contexto sempre

## Pós-uso

Se descobrir caso novo de violação que essa skill não cobre, atualize a seção "🚫 Recusar" na regra correspondente.
