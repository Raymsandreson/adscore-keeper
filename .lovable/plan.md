
# Plano: Restringir Acesso a Cartões por Permissão Explícita

## Resumo da Mudança
Atualmente, administradores veem **todos** os cartões automaticamente. A mudança fará com que **todos os usuários** (admins e membros) só vejam os cartões que foram **explicitamente atribuídos** na tabela de permissões.

## O Que Vai Mudar

### Para Usuários
- Administradores não terão mais acesso automático a todos os cartões
- Cada pessoa só verá os cartões que um admin atribuiu para ela
- O gerenciamento de permissões na aba "Cartões" continua funcionando normalmente

### Para o Sistema
- A lógica de "se é admin, vê tudo" será removida
- O banco de dados usará apenas a função `can_view_card()` para validar acesso
- A Edge Function também respeitará apenas permissões explícitas

---

## Detalhes Técnicos

### Arquivo 1: `src/hooks/useCardPermissions.ts`

**Mudança:** Remover a lógica que dá acesso total a admins

```typescript
// ANTES (linhas 72-78):
if (isAdmin) {
  setAllowedCards(allCards);
} else {
  setAllowedCards(myCards);
}

// DEPOIS:
// Todos os usuários seguem apenas permissões explícitas
setAllowedCards(myCards);
```

O hook `allKnownCards` continuará funcionando para admins gerenciarem permissões na interface.

---

### Arquivo 2: `supabase/functions/pluggy-integration/index.ts`

**Mudança:** No caso `get_connections`, restringir a busca baseando-se apenas em permissões explícitas

```typescript
// ANTES (linhas 315-350):
// Se admin ou tem permissões, mostra todas as conexões

// DEPOIS:
// Buscar conexões vinculadas apenas aos cartões que o usuário tem permissão
// Se não tem nenhuma permissão, retorna vazio
```

---

### Arquivo 3: Política RLS de `credit_card_transactions`

**Mudança:** Remover a condição `is_admin(auth.uid())` da política de SELECT

```sql
-- ANTES:
USING (
  user_id = auth.uid() 
  OR is_admin(auth.uid())
  OR can_view_card(auth.uid(), card_last_digits)
)

-- DEPOIS:
USING (
  user_id = auth.uid() 
  OR can_view_card(auth.uid(), card_last_digits)
)
```

---

### Arquivo 4: Política RLS de `pluggy_connections`

**Mudança:** Remover acesso automático para admins, manter apenas para quem tem permissões

```sql
-- ANTES:
USING (
  user_id = auth.uid() 
  OR is_admin(auth.uid())
  OR EXISTS (SELECT 1 FROM user_card_permissions WHERE user_id = auth.uid())
)

-- DEPOIS:
USING (
  user_id = auth.uid() 
  OR EXISTS (SELECT 1 FROM user_card_permissions WHERE user_id = auth.uid())
)
```

---

## Resultado Final

| Cenário | Antes | Depois |
|---------|-------|--------|
| Admin sem permissões | Vê tudo | Não vê nada |
| Admin com 3 cartões | Vê tudo | Vê só os 3 cartões |
| Membro com 3 cartões | Vê só os 3 | Vê só os 3 |
| Membro sem permissões | Não vê nada | Não vê nada |

---

## Importante

Certifique-se de que o **seu próprio usuário admin** (`79c5c9d1...`) tenha **todos os cartões atribuídos** antes de aplicar essa mudança, senão você também perderá acesso.

Pelo que vi no banco, você já tem 10 cartões atribuídos ao seu usuário, então está seguro.
