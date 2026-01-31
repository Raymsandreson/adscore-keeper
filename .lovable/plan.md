
# Plano: Unificar Filtros e Melhorar Design Inspirado no Banco Inter

## Problema Identificado
Atualmente existem **dois conjuntos de filtros separados**:
1. Filtros na **FinancePage** (período rápido, calendário range, busca, categorias como badges)
2. Filtros dentro do **PendingTransactionsWorkflow** (data início/fim, cartão, categoria, subcategoria)

Isso causa confusão e duplicação de interface.

## Solução Recomendada: Um Filtro Geral Unificado

Baseado no design do **Banco Inter**, recomendo **um único painel de filtros** no topo, com estilo clean e moderno:

```text
┌─────────────────────────────────────────────────────────────────┐
│  📊 Gastos do Cartão                    [↻ Sincronizar]        │
├─────────────────────────────────────────────────────────────────┤
│  [Este mês]  [Mês passado]  [3 meses]  📅 01/01 - 31/01/26     │
│                                                                 │
│  🔍 Buscar transação...                                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Total Gasto          │  Categorias (chips clicáveis)   │   │
│  │ R$ 82.248,29         │  [Todas] [Hospedagem] [Comida]  │   │
│  │ 293 transações       │  [Combustível] [Serviços] ...   │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  [Pendentes] [Acolhedores] [Por Cartão] [Lista] [Config]       │
└─────────────────────────────────────────────────────────────────┘
```

---

## O Que Vai Mudar

### Para o Usuário
- **Um único filtro geral** no topo da página que afeta todas as abas
- Filtros removidos de dentro do `PendingTransactionsWorkflow` (ele usa o que vem da página)
- Design mais limpo estilo Banco Inter:
  - Botões de período rápido como **pills/chips**
  - Categorias como **badges clicáveis** com valores
  - Barra de busca mais proeminente
  - Cores mais clean (branco, cinza claro, acentos azuis)
  - Sombras sutis e bordas arredondadas

### Melhorias de UX Inspiradas no Inter
1. **Quick Date Pills**: "Este mês", "Mês passado", "3 meses" como botões estilo pill
2. **Category Chips**: Categorias como tags clicáveis mostrando valores gastos
3. **Progress Card**: Card de resumo com total gasto em destaque
4. **Filtros Contextuais**: Dentro do workflow, apenas filtros específicos (cartão específico, se necessário)

---

## Detalhes Técnicos

### 1. Remover Filtros Duplicados do `PendingTransactionsWorkflow.tsx`

**Remover estados e UI de filtros:**
- `filterStartDate`, `filterEndDate` - Virão como props da página pai
- `filterCard`, `filterCategory`, `filterSubcategory` - Virão como props
- Todo o grid de filtros será removido do componente

**Novas Props:**
```typescript
interface PendingTransactionsWorkflowProps {
  transactions: Transaction[];  // Já virá filtrada
  onComplete?: () => void;
}
```

---

### 2. Redesenhar `FinancePage.tsx` com Estilo Inter

**2.1. Header Simplificado:**
```tsx
<div className="bg-card border-b sticky top-0 z-10">
  <div className="container mx-auto px-4 py-4">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Gastos do Cartão</h1>
          <p className="text-xs text-muted-foreground">
            Open Finance via Pluggy
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {lastSyncTime && (
          <span className="text-xs text-muted-foreground">
            Atualizado às {format(lastSyncTime, "HH:mm")}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={handleSync}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Sincronizar
        </Button>
      </div>
    </div>
  </div>
</div>
```

**2.2. Filtros Unificados Estilo Inter:**
```tsx
<Card className="border-0 shadow-sm">
  <CardContent className="py-4 space-y-4">
    {/* Quick Period Pills */}
    <div className="flex flex-wrap items-center gap-2">
      {quickDateRanges.map((range, i) => (
        <Button
          key={i}
          variant={isSelected ? 'default' : 'outline'}
          size="sm"
          className="rounded-full px-4 h-8"
        >
          {range.label}
        </Button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            size="sm" 
            className="rounded-full h-8"
          >
            <Calendar className="h-4 w-4 mr-2" />
            {format(dateRange.start, "dd/MM")} - {format(dateRange.end, "dd/MM/yy")}
          </Button>
        </PopoverTrigger>
        {/* Range Calendar */}
      </Popover>
    </div>

    {/* Search Bar - More Prominent */}
    <div className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Buscar transação..."
        className="pl-10 h-11 rounded-xl bg-muted/50 border-0"
      />
    </div>

    {/* Summary + Categories Row */}
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {/* Total Card */}
      <Card className="bg-gradient-to-br from-destructive/5 to-destructive/10 border-destructive/20">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Total Gasto</p>
          <p className="text-2xl font-bold text-destructive">
            {formatCurrency(totalSpent)}
          </p>
          <p className="text-xs text-muted-foreground">
            {transactions.length} transações
          </p>
        </CardContent>
      </Card>
      
      {/* Category Chips - 3 columns span */}
      <div className="md:col-span-3 flex flex-wrap items-center gap-2">
        <Badge
          variant={categoryFilter === null ? 'default' : 'outline'}
          className="cursor-pointer rounded-full px-4 py-1"
          onClick={() => setCategoryFilter(null)}
        >
          Todas
        </Badge>
        {categoryTotals.map(({ category, total }) => (
          <Badge
            key={category}
            variant={categoryFilter === category ? 'default' : 'outline'}
            className="cursor-pointer rounded-full px-3 py-1"
            onClick={() => setCategoryFilter(category)}
          >
            {category} ({formatCurrency(total)})
          </Badge>
        ))}
      </div>
    </div>
  </CardContent>
</Card>
```

---

### 3. Atualizar `PendingTransactionsWorkflow.tsx`

**3.1. Simplificar para Apenas Workflow:**

Remover todo o bloco de filtros (linhas 325-517) e manter apenas:
- Header com contagem de pendentes e toggle de visualização
- Barra de progresso
- Conteúdo (Card view ou List view)

```tsx
<div className="space-y-4">
  {/* Compact Header */}
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-amber-500" />
        <span className="font-medium">
          {pendingTransactions.length} gastos pendentes
        </span>
      </div>
      <Badge variant="secondary" className="rounded-full">
        {completedCount} / {transactions.length} vinculados
      </Badge>
    </div>
    <div className="flex items-center gap-2">
      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v)}>
        <TabsList className="h-8">
          <TabsTrigger value="card" className="h-6 px-2">
            <LayoutGrid className="h-4 w-4" />
          </TabsTrigger>
          <TabsTrigger value="list" className="h-6 px-2">
            <List className="h-4 w-4" />
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  </div>
  
  <Progress value={progressPercent} className="h-1.5" />
  
  {/* Content based on viewMode */}
</div>
```

**3.2. Adicionar Filtro Específico de Cartão (Opcional):**

Se necessário, um pequeno seletor de cartão dentro do workflow:
```tsx
<div className="flex items-center gap-2 text-sm">
  <span className="text-muted-foreground">Filtrar por cartão:</span>
  <Select value={filterCard} onValueChange={setFilterCard}>
    <SelectTrigger className="w-[180px] h-8">
      <SelectValue placeholder="Todos os cartões" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">Todos os cartões</SelectItem>
      {uniqueCards.map(card => (
        <SelectItem key={card} value={card}>
          {getCardAssignment(card)?.card_name || `**** ${card}`}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

---

### 4. Melhorias de Estilo CSS

Adicionar classes utilitárias para o estilo Inter:

```css
/* Pill buttons */
.pill-button {
  @apply rounded-full px-4 transition-all duration-200;
}

/* Elevated card */
.card-elevated {
  @apply bg-card border shadow-sm hover:shadow-md transition-shadow;
}

/* Search input style Inter */
.search-inter {
  @apply rounded-xl bg-muted/50 border-0 pl-10 h-11;
}
```

---

## Resumo Visual Final

```text
┌─────────────────────────────────────────────────────────────────┐
│ 💳 Gastos do Cartão              Atualizado 08:13 [Sincronizar]│
│     Open Finance via Pluggy                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [●Este mês] [Mês passado] [3 meses]  📅 01/01 - 31/01/26      │
│                                                                 │
│  🔍 Buscar transação...                                         │
│                                                                 │
│  ┌──────────────┐  ┌───────────────────────────────────────┐   │
│  │ Total Gasto  │  │ [Todas] [Hospedagem R$11k]           │   │
│  │ R$ 82.248,29 │  │ [Combustível R$3.5k] [Comida R$5.8k] │   │
│  │ 293 trans.   │  │ [Serviços R$6k] [+5 mais]            │   │
│  └──────────────┘  └───────────────────────────────────────┘   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ [Pendentes●16] [Acolhedores] [Por Cartão] [Lista] [Config]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ⚠️ 16 gastos pendentes    277/293 vinculados    [≡][▤] Limpar│
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░  94%        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 💳 Gasto #1 de 16              [◀] [▶]                  │   │
│  │ Vincule este gasto a um Lead ou Contato                 │   │
│  │                                                         │   │
│  │ ┌─────────────────────────────────────────────────┐     │   │
│  │ │ MR *BOTECODOFLORESTA        R$ 17,00            │     │   │
│  │ │ 29/01/2026 • Eating out                         │     │   │
│  │ └─────────────────────────────────────────────────┘     │   │
│  │                                                         │   │
│  │ [Pular]                              [Salvar →]         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Arquivos a Modificar

| Arquivo | Mudança |
|---------|---------|
| `src/pages/FinancePage.tsx` | Redesenhar filtros unificados estilo Inter |
| `src/components/finance/PendingTransactionsWorkflow.tsx` | Remover filtros duplicados, simplificar header |
| `src/index.css` | Adicionar classes utilitárias para estilo Inter |

---

## Benefícios

- Interface mais limpa e intuitiva
- Menos confusão com filtros duplicados
- Experiência consistente com apps bancários modernos
- Melhor responsividade mobile
- Carregamento mais rápido (menos estados para gerenciar)
