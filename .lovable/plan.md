

## Plano: Adicionar campo "Assessor responsável" no formulário de nova atividade do lead

### Resumo
Adicionar um select de assessor (membro da equipe) no formulário de criação de atividade dentro do card do lead (`LeadActivitiesTab`), usando o hook `useProfilesList` já existente.

### Alterações em `src/components/leads/LeadActivitiesTab.tsx`

1. **Importar** `useProfilesList` de `@/hooks/useProfilesList`

2. **Adicionar estado** para o assessor selecionado:
   - `newAssignedTo` (user_id) e `newAssignedToName` (nome do assessor)

3. **Adicionar select** entre Prioridade e Prazo no formulário de criação:
   - Label "Responsável"
   - Select com lista de perfis da equipe
   - Ao selecionar, armazena `user_id` e `full_name`

4. **Incluir no insert** os campos `assigned_to` e `assigned_to_name` ao criar a atividade

5. **Resetar** os campos ao fechar/criar

