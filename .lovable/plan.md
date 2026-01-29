
# Plano: Importar Conexão Existente pelo ItemId

## Resumo
Adicionar uma nova ação na Edge Function para importar uma conexão existente diretamente pelo `itemId`, e atualizar o hook e a página para suportar essa funcionalidade.

## O que será feito

### 1. Atualizar Edge Function (`pluggy-integration`)
Adicionar nova ação `import_by_item_id` que:
- Recebe o `itemId` como parâmetro
- Busca os dados do item na API Pluggy (`GET /items/{itemId}`)
- Salva a conexão no banco de dados local
- Retorna os dados da conexão

### 2. Atualizar Hook (`useCreditCardTransactions.ts`)
Adicionar nova função `importByItemId(itemId: string)` que:
- Chama a Edge Function com a ação `import_by_item_id`
- Atualiza a lista de conexões após importar

### 3. Atualizar Página Finance (`FinancePage.tsx`)
Adicionar interface para importação manual:
- Campo de input para o usuário inserir o `itemId`
- Botão "Importar" para processar a importação
- Após importar com sucesso, sincronizar transações automaticamente

## Detalhes Técnicos

### Nova ação na Edge Function
```typescript
case 'import_by_item_id': {
  // 1. Buscar item na API Pluggy
  const item = await getItem(apiKey, itemId);
  
  // 2. Salvar conexão no banco
  const connectionData = {
    user_id: user.id,
    pluggy_item_id: itemId,
    connector_name: item.connector?.name,
    status: item.status,
  };
  
  // 3. Upsert na tabela pluggy_connections
  await supabase.from('pluggy_connections').upsert(...);
}
```

### Arquivos que serão modificados
1. `supabase/functions/pluggy-integration/index.ts` - Nova ação
2. `src/hooks/useCreditCardTransactions.ts` - Nova função
3. `src/pages/FinancePage.tsx` - Interface de importação manual

## Resultado Esperado
Ao aprovar este plano, você poderá:
1. Inserir o `itemId` `b598de07-c7e5-4dec-b559-e915e47a072c`
2. Clicar em "Importar"
3. Ver a conexão Santander Cartões aparecer
4. Sincronizar as transações automaticamente
