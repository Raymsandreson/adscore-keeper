
# Plano: Rastrear Localização do Gasto e do Lead/Contato Visitado

## Objetivo
Ao categorizar uma despesa no workflow de pendentes, o usuário poderá:
1. **Ver/Cadastrar a localização do gasto** (onde o acolhedor estava - posto, hotel, restaurante)
2. **Ver a cidade do Lead/Contato visitado** (para onde foi a viagem)
3. **Selecionar estado e cidade com API do IBGE** (dropdown dinâmico)

Isso permitirá cruzar: "O acolhedor estava em São Paulo (gasto) visitando um Lead de Campinas".

---

## O Que Vai Mudar

### Para o Usuário
- Ao categorizar um gasto, verá dois campos de localização:
  - **Localização do Gasto**: onde o acolhedor fez a compra (vem do CNPJ ou cadastro manual)
  - **Cidade do Lead/Contato**: exibida automaticamente ao selecionar o lead
- Ao cadastrar localização manual, terá **Select de Estado → Select de Cidade** (API IBGE)
- Os Leads/Contatos exibirão sua cidade/estado para facilitar a escolha

### Para o Dashboard de Logística
- Poderá comparar "cidade do gasto" vs "cidade do lead visitado"
- Facilitará análise de rotas e rastreamento de viagens

---

## Detalhes Técnicos

### 1. Banco de Dados: Adicionar colunas de localização manual

Adicionar colunas na tabela `transaction_category_overrides` para armazenar localização quando não vier do CNPJ:

```sql
ALTER TABLE transaction_category_overrides 
ADD COLUMN manual_city TEXT,
ADD COLUMN manual_state TEXT;
```

---

### 2. Arquivo: `src/components/finance/PendingTransactionsWorkflow.tsx`

#### 2.1. Importar o hook de localizações brasileiras
```typescript
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
```

#### 2.2. Usar o hook no componente
```typescript
const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
```

#### 2.3. Substituir inputs manuais de texto por Selects
**Antes (linhas 400-416):**
```tsx
<div className="flex gap-2">
  <Input placeholder="Cidade" value={manualCity} ... />
  <Input placeholder="UF" value={manualState} ... />
</div>
```

**Depois:**
```tsx
<div className="flex gap-2">
  <Select 
    value={manualState}
    onValueChange={(value) => {
      setManualState(value);
      setManualCity('');
      fetchCities(value);
    }}
  >
    <SelectTrigger className="w-20">
      <SelectValue placeholder="UF" />
    </SelectTrigger>
    <SelectContent>
      {states.map((state) => (
        <SelectItem key={state.sigla} value={state.sigla}>
          {state.sigla}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
  
  <Select 
    value={manualCity}
    onValueChange={setManualCity}
    disabled={!manualState || loadingCities}
  >
    <SelectTrigger className="flex-1">
      <SelectValue placeholder={loadingCities ? "Carregando..." : "Cidade"} />
    </SelectTrigger>
    <SelectContent>
      {cities.map((city) => (
        <SelectItem key={city.id} value={city.nome}>
          {city.nome}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

#### 2.4. Exibir cidade do Lead/Contato selecionado
Ao selecionar um Lead ou Contato, mostrar sua cidade embaixo da seleção:

```tsx
{selectedLead && (
  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2 p-2 bg-muted/50 rounded">
    <MapPin className="h-4 w-4" />
    <span>
      Lead de: {leads.find(l => l.id === selectedLead)?.city || 'Cidade não cadastrada'}
      {leads.find(l => l.id === selectedLead)?.state && 
        `, ${leads.find(l => l.id === selectedLead)?.state}`}
    </span>
  </div>
)}
```

---

### 3. Arquivo: `src/hooks/useExpenseCategories.ts`

#### 3.1. Atualizar a função `setTransactionOverride` para salvar localização

```typescript
const setTransactionOverride = useCallback(async (
  transactionId: string, 
  categoryId: string, 
  contactId?: string,
  leadId?: string,
  notes?: string,
  manualCity?: string,   // NOVO
  manualState?: string   // NOVO
) => {
  try {
    const { error } = await supabase
      .from('transaction_category_overrides')
      .upsert([{
        transaction_id: transactionId,
        category_id: categoryId,
        contact_id: contactId || null,
        lead_id: leadId || null,
        notes: notes || null,
        manual_city: manualCity || null,    // NOVO
        manual_state: manualState || null,  // NOVO
      }], { onConflict: 'transaction_id' });
    // ...
  }
}, [fetchOverrides]);
```

#### 3.2. Atualizar interface `TransactionOverride`

```typescript
export interface TransactionOverride {
  id: string;
  transaction_id: string;
  category_id: string;
  lead_id: string | null;
  contact_id: string | null;
  notes: string | null;
  manual_city: string | null;   // NOVO
  manual_state: string | null;  // NOVO
  created_at: string;
}
```

---

### 4. Arquivo: `src/components/finance/TransactionCategorizer.tsx`

Aplicar as mesmas mudanças do workflow (Selects de UF/Cidade via IBGE) neste componente de categorização individual.

---

## Resumo Visual

```text
┌─────────────────────────────────────────────────────┐
│  Gasto: Posto Shell - R$ 180,00                     │
│  Data: 30/01/2026                                   │
├─────────────────────────────────────────────────────┤
│  📍 Localização do Gasto                            │
│  ┌──────┐  ┌────────────────────────┐               │
│  │ SP ▼ │  │ Campinas            ▼ │  ← API IBGE   │
│  └──────┘  └────────────────────────┘               │
├─────────────────────────────────────────────────────┤
│  👤 Vincular a: [Lead] [Contato]                    │
│  ┌─────────────────────────────────────────────┐    │
│  │ João Silva - São Carlos, SP               ○│    │
│  │ Maria Santos - Ribeirão Preto, SP         ○│    │
│  └─────────────────────────────────────────────┘    │
│  📍 Lead de: São Carlos, SP  ← Cidade do destino   │
├─────────────────────────────────────────────────────┤
│  [Pular]                            [Salvar] →      │
└─────────────────────────────────────────────────────┘
```

---

## Arquivos a Modificar

| Arquivo | Mudança |
|---------|---------|
| Banco de dados | Adicionar colunas `manual_city` e `manual_state` |
| `src/hooks/useBrazilianLocations.ts` | Já existe, sem mudanças |
| `src/hooks/useExpenseCategories.ts` | Adicionar parâmetros de localização |
| `src/components/finance/PendingTransactionsWorkflow.tsx` | Substituir inputs por Selects com API IBGE |
| `src/components/finance/TransactionCategorizer.tsx` | Adicionar Selects de localização |

