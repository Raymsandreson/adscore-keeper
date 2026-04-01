
## Plano: Atividades Processuais Automáticas via IA

### O que será feito

Quando um caso é fechado, a IA analisa as mensagens do WhatsApp + dados do lead + dados do processo, e cria atividades específicas para cada membro do time processual com base na **descrição do cargo** (job_positions) de cada um. O coordenador também pode disparar/regenerar manualmente.

### Etapas

#### 1. Edge Function `generate-case-activities`
- **Gatilho duplo**: chamada automática quando `lead_status` muda para `closed` + botão manual
- **Coleta de contexto**:
  - Últimas mensagens do WhatsApp do lead (phone + instance)
  - Dados do lead (nome, produto, núcleo, dados coletados)
  - Dados do `case_process_tracking` se existir
- **Consulta os membros** do time com cargos via `job_positions` + `profiles`
- **Prompt para Gemini**: Recebe o contexto do caso + lista de cargos com descrições → gera atividades estruturadas (título, descrição, responsável, prazo estimado, prioridade)
- **Insere** na tabela `lead_activities` com `created_by_ai = true` para rastreabilidade

#### 2. Migração: campo `created_by_ai` na tabela `lead_activities`
- Adicionar coluna `created_by_ai BOOLEAN DEFAULT false`
- Permitir filtrar atividades geradas pela IA vs manuais

#### 3. Nova aba "Atividades IA" no Monitor
- Lista todas as atividades com `created_by_ai = true`
- Mostra: caso de origem, responsável, cargo, status, data de criação
- Filtros: por núcleo, por cargo, por status da atividade
- Possibilidade de editar/ajustar antes de notificar

#### 4. Botão manual "Gerar Atividades" 
- Na Fila de Casos do monitor, ao expandir um caso fechado
- Permite regenerar se as atividades não ficaram boas

### Fluxo
```
Lead fecha → Edge Function coleta contexto →
Gemini analisa mensagens + dados + cargos →
Cria atividades distribuídas por cargo →
Aparece na aba "Atividades IA" do Monitor
```
