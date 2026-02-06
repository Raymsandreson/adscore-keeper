

## Problema Identificado

O diálogo de edição do lead tem camadas conflitantes de overflow que bloqueiam a barra de rolagem:

```text
DialogContent (overflow-y-auto)
  └── Tabs (overflow-hidden)  <-- BLOQUEIA rolagem
        └── ScrollArea (flex-1)  <-- SEM altura definida
```

## Solução

Reestruturar o layout para que a rolagem funcione corretamente:

### Alterações em `src/components/kanban/LeadEditDialog.tsx`

1. **DialogContent** - Remover `overflow-y-auto` e manter apenas o container fixo
2. **Tabs** - Remover `overflow-hidden` que está bloqueando
3. **ScrollArea** - Definir altura fixa calculada (ex: `h-[calc(90vh-200px)]`) para garantir que o scroll funcione

### Estrutura Final

```text
DialogContent (max-h-[90vh] flex flex-col)
  └── DialogHeader (fixo no topo)
  └── Button extrator (fixo)
  └── Tabs (flex-1 min-h-0)
        └── TabsList (fixo)
        └── ScrollArea (h-[calc(90vh-220px)])  <-- altura calculada
              └── TabsContent (conteúdo rolável)
  └── DialogFooter (fixo no fundo)
```

### Código Específico

**Linha 573** - DialogContent:
```tsx
<DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
```

**Linha 599** - Tabs:
```tsx
<Tabs defaultValue="basic" className="flex-1 min-h-0 flex flex-col">
```

**Linha 627** - ScrollArea com altura fixa:
```tsx
<ScrollArea className="h-[calc(90vh-220px)] pr-4 mt-4">
```

Isso garantirá:
- Header do diálogo fixo no topo
- Abas fixas abaixo do header  
- Conteúdo das abas com barra de rolagem visível
- Footer com botões fixo no fundo

