

# Adicionar CNPJ no Modal de Categorização

## Problema Identificado

O CNPJ não está aparecendo no modal de detalhamento da transação (`TransactionCategorizer.tsx`). O campo existe na interface mas não está sendo renderizado na UI.

## Alteração Necessária

### Arquivo: `src/components/finance/TransactionCategorizer.tsx`

1. **Adicionar import do ícone `Building2`** na linha 9

2. **Adicionar exibição do CNPJ** no card de informações da transação (após a linha do cartão):

```tsx
{transaction.merchant_cnpj && (
  <span className="flex items-center gap-1 font-mono">
    <Building2 className="h-3 w-3" />
    {transaction.merchant_cnpj.length === 14 
      ? transaction.merchant_cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
      : transaction.merchant_cnpj}
  </span>
)}
```

## Observação

Para transações onde o campo `merchant_cnpj` está vazio no banco (como "SAGA CONSTRUCAO"), o CNPJ não aparecerá pois a API Pluggy não retornou esse dado.

