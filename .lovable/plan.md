

## Correção: Links de "Comentários" redirecionando para Atividades

### Problema
Os links de navegacao para "Comentários", "Funil" e "Automação" usam o caminho `/?tab=automation&subtab=comments`, mas a rota `/` agora aponta para a pagina de **Atividades**. O Dashboard está na rota `/dashboard`.

### Solucao
Atualizar todos os links que usam `/?tab=...` para usar `/dashboard?tab=...` nos seguintes arquivos:

### Arquivos a editar

**1. `src/components/Dashboard.tsx`**
- Linha 366: `/?tab=automation&subtab=comments` -> `/dashboard?tab=automation&subtab=comments`
- Linha 381: `/?tab=automation&subtab=funnel` -> `/dashboard?tab=automation&subtab=funnel`
- Linha 395: `/?tab=automation&subtab=automation` -> `/dashboard?tab=automation&subtab=automation`
- Qualquer outro link com `/?tab=` no arquivo

**2. `src/components/GlobalCommandPalette.tsx`**
- Linha 171: `/?tab=automation&subtab=comments` -> `/dashboard?tab=automation&subtab=comments`
- Verificar outros `navigate("/?tab=...")` no mesmo arquivo

**3. `src/components/FloatingNav.tsx`**
- Ja usa `/dashboard?tab=...` corretamente (linhas 129-131), nao precisa de alteracao

### Resultado
Ao clicar em "Comentários" no Dashboard, o usuario permanecera no Dashboard e a aba de automacao sera aberta corretamente, em vez de ser redirecionado para a pagina de Atividades.
