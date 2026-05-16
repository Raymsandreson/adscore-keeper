## Escopo (LDPEV — Ler já feito, agora Diagnóstico + Plano)

Operar sobre **850 leads** com "PREV" no nome (`leads.deleted_at IS NULL`). 150 nomes têm duplicatas (2+ leads com o mesmo nome).

## Evidência coletada

- **PREV 969 / Josiane (558695252804)**: 3 leads — 1 com telefone real, 2 com `group_jid` no campo `lead_phone`. Todos sem `acolhedor`, sem `case_number`, sem caso vinculado.
- **Primeira mensagem inbound da Josiane** (`whatsapp_messages.phone='558695252804'` ordenado asc): `instance_name = "cris"` em 2026-04-07 11:02 → acolhedor esperado **Crisley Costa de Oliveira**.
- **Procuração** (csv_grupos_enriquecido, jid `120363426211779973@g.us`): `JACKSON YVES RIBEIRO ARAUJO`, CPF 077.804.963-92, tel 558695252804, PI/Teresina/São Pedro, assinada 2026-05-04.
- **Workflow boards**:
  - `070c00dc-6de7-42df-a2c2-360d3a6d1028` → **Fluxo BPC LOAS (Administrativo e Judicial)**
  - `d5276364-f7a9-4c9f-a04b-8c634628ca98` → **PROCESSUAL Salário Maternidade**
- **legal_cases** tem `lead_id, case_number, title, workflow_board_id, acolhedor, benefit_type`.

## Pendência de evidência (preciso resolver antes de gerar SQL final)

1. **Mapping `instance_name` → nome do acolhedor**: a query em `whatsapp_instances` retornou null (provável RLS no service-role ou tabela em schema diferente). Preciso confirmar a fonte canônica do nome humano por instância (ex.: `cris` → "Crisley Costa de Oliveira"). Vou checar `whatsapp_instances`, `whatsapp_instance_users` + `profiles` (Cloud).
2. **Detecção do tipo de fluxo pelo nome**:
   - Contém "BPC" (case-insensitive) → workflow BPC LOAS.
   - Contém "MAT" / "Maternidade" / "MATERNIDADE" / "Salário Maternidade" → workflow Salário Maternidade.
   - Demais PREV (ex.: "Aposentadoria", "Auxílio doença", "Inquérito") → **não criar caso** (não inventar workflow). Vou listar quantos ficam de fora.
3. **Extração da sequência PREV**: regex `PREV\s*(\d+)` sobre `lead_name` (tolerante a "Prev", "PREV ️", "prev ").

## Plano de execução (em fases, cada uma com dry-run antes do commit)

### Fase A — Dry-run / Diagnóstico (sem escrita)
SQL/script de leitura que retorna, por lead PREV:
- `prev_seq` extraído do nome
- `lead_phone` normalizado / `group_jid`
- `first_instance` = primeira instância que conversou no privado (não-grupo)
- `acolhedor_alvo` = nome humano da instância
- `workflow_alvo` = BPC LOAS / Maternidade / NÃO_CLASSIFICADO
- `procuracao_signatario` (do csv via group_jid)
- `duplicados_do_mesmo_prev_seq` (lista de ids)

→ Te entrego a tabela CSV em `/mnt/documents/` para você revisar amostras antes de qualquer UPDATE.

### Fase B — Consolidação de duplicados (UPDATE + soft-delete)
Para cada grupo de leads com mesmo `prev_seq`:
- **Vencedor** = lead com `updated_at` mais recente.
- Vencedor herda campos não-nulos dos perdedores (telefone real preferido sobre group_jid; observações concatenadas em `details.merged_from`).
- Perdedores: `deleted_at = now()` + `details.snapshot` com row inteira (política soft-delete).
- Contatos / mensagens / atividades / grupos vinculados aos perdedores são re-vinculados ao vencedor (`UPDATE ... SET lead_id = vencedor`).

### Fase C — Backfill de campos no vencedor
- `acolhedor = nome_da_primeira_instancia`
- `case_number = prev_seq` (string)
- `source = 'whatsapp'` se nulo (já está, mas garante)

### Fase D — Procuração → Contato
Para cada lead PREV cujo `group_jid` tem `procuracoes_json` no csv:
- Para cada signatário JSON: `INSERT INTO contacts` (se não existir telefone) ou `UPDATE` enriquecendo (cpf, bairro, cidade, uf, full_name).
- `INSERT INTO contact_leads (contact_id, lead_id)` se não vinculado.
- Classificação = `client` (já assinou).

### Fase E — Criação de legal_case
Para cada lead vencedor com workflow classificado e sem caso ativo:
- `INSERT INTO legal_cases (lead_id, case_number=prev_seq, title=prev_seq, workflow_board_id, acolhedor, benefit_type)`.
- O trigger `auto_close_lead_on_case_creation` já move o lead para a última etapa e marca closed — **isso pode ter efeito colateral** em leads PREV ainda em andamento. **Vou desabilitar o trigger durante o backfill** e reativar no fim, OU criar o caso sem disparar status close (usando `SET session_replication_role = replica` na transação).

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Acolhedor errado por instância compartilhada | Fase A entrega CSV — você aprova antes |
| Lead PREV legítimo classificado como "Maternidade" por conter "mat" em outra palavra | Regex com word-boundary; lista de "não classificados" vai pra revisão manual |
| Trigger `auto_close_lead_on_case_creation` fecha leads ainda em curso | Backfill desativa trigger; só leads já fechados criam caso, OU criamos casos sem mover stage |
| Duplicado "vencedor" sendo o de menor qualidade (group_jid em vez de telefone real) | Critério de desempate: telefone real (`^55\d{10,11}$`) > group_jid; updated_at é desempate secundário |
| Indicações vs anúncio (você disse não saber identificar) | **Não vou inventar**. `source` continua `whatsapp` para todos. Se quiser depois, marcamos manualmente os que aparecem como referral em outro lead |

## O que NÃO vou mexer
- Leads sem "PREV" no nome.
- Casos já existentes (`legal_cases` já criados ficam intocados; só insiro onde não há).
- Mensagens, atividades, financeiro, anexos — só re-aponto `lead_id` quando consolidar duplicados.
- Schema (sem migration). Só DML.

## Próximo passo concreto que preciso de você

**Responda 1, 2 ou 3:**

1. **"Roda Fase A"** — gero o CSV de dry-run com as 850 linhas (acolhedor proposto, workflow proposto, duplicados, signatários). Você revisa amostras e aprova B-E.
2. **"Pula direto pro PREV 969"** — faço só esse lead como piloto end-to-end (consolida 3 leads, acolhedor=Crisley, caso 969, contato Jackson, workflow BPC LOAS). Se ficar bom, replicamos.
3. **Ajuste o plano** (ex.: outra regra de classificação, outro critério de desempate, manter perdedores ativos em vez de soft-delete).

Recomendo **(2) piloto no 969 primeiro** — valida fluxo completo em 1 caso visível antes de tocar em 849 outros.
