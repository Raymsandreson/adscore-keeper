

## Problema

O componente `BankTransactionsView.tsx` (aba **Conta**) nunca recebeu os campos financeiros novos. Ele tem seu próprio estado de edição (`editData`) que só inclui `categoryId`, `linkType`, `linkId`, `notes`, `manualState`, `manualCity` — sem Empresa, Setor, Natureza, Recorrência, Beneficiário, Forma de Pagamento ou Nº NF.

## Plano de Implementação

### 1. Adicionar imports e hooks

Importar `useCompanies`, `useCostCenters`, `useBeneficiaries` no `BankTransactionsView.tsx` e inicializar os hooks.

### 2. Expandir o estado `editData`

Adicionar os 7 campos ao tipo do estado: `companyId`, `costCenterId`, `nature`, `recurrence`, `beneficiaryId`, `paymentMethod`, `invoiceNumber` (linhas 106-113).

### 3. Atualizar `startEditing`

Carregar os novos campos do override existente ao iniciar edição (linhas 310-339).

### 4. Atualizar `cancelEditing`

Limpar os novos campos ao cancelar (linha 344).

### 5. Atualizar `saveTransaction`

Passar os novos campos como `extraFields` para `setTransactionOverride` (linhas 347-368).

### 6. Adicionar campos no formulário de edição

Inserir entre a seção de Localização (linha 716) e Descrição (linha 718) os mesmos blocos de campos já presentes em `PendingTransactionsList.tsx`:
- **Empresa + Setor/Centro de Custo** (grid 2 cols)
- **Natureza + Recorrência** (grid 2 cols)
- **Beneficiário + Forma de Pagamento** (grid 2 cols)
- **Nº NF** (junto com Descrição em grid 3 cols, igual ao PendingTransactionsList)

