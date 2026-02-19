
## Problema Identificado

O tipo customizado salvo está correto no banco (confirmado: `custom_1771503938689` / "Cadastrar Casos" existe). O problema é no `TimeBlockSettingsDialog`:

**Causa raiz**: O `useEffect` que sincroniza o estado ao abrir o dialog atualiza `local` e `activeTypes`, mas o `activeTypes` é reconstruído a partir dos `configs` da prop — se o novo tipo customizado ainda não estava nos `configs` no momento em que o dialog foi aberto (race condition entre o fetch do banco e a abertura do dialog), ele não entra no Set e fica **invisível no seletor de tipos**, dando a impressão de que não foi salvo ou que "aparece para todos".

Além disso, quando o admin visualiza outro membro na aba Rotinas (`MemberRoutineManager`), o `useTimeBlockSettings(userId)` busca os dados daquele usuário — mas os tipos customizados do membro (como `custom_1771503938689`) são reconhecidos como `isCustom: true` porque não estão na lista `DEFAULT_TYPES`. Isso está correto, mas o `activeTypes` inicial pode não incluir esses tipos se o fetch ainda não completou.

## Solução

### 1. `TimeBlockSettingsDialog` — Sincronizar `activeTypes` corretamente ao abrir

O `useEffect` que reage a `[configs, open]` deve garantir que `activeTypes` sempre inclua **todos os tipos presentes nos configs recebidos**, incluindo customizados:

```typescript
useEffect(() => {
  if (!open) return; // só atualiza quando abre
  setLocal(configs);
  setActiveTypes(new Set(configs.map(c => c.activityType))); // ← garante sync completo
  setShowAddForm(false);
  setSearch('');
  setShowTypeSelector(false);
  setNewLabel('');
}, [configs, open]);
```

O `if (!open) return` evita que o reset aconteça desnecessariamente enquanto o dialog está fechado, e garante que quando ele abre, os dados mais recentes do banco (já no `configs` prop) são usados.

### 2. `handleAddCustom` — Adicionar novo tipo ao `activeTypes` imediatamente

Quando o usuário adiciona um tipo customizado no dialog, ele deve aparecer imediatamente no seletor de tipos. Atualmente, o `activeTypes` não é atualizado ao adicionar:

```typescript
const handleAddCustom = () => {
  // ...
  setLocal(prev => [...prev, newCfg]);
  setActiveTypes(prev => new Set([...prev, key])); // ← adicionar ao Set
  // ...
};
```

### 3. `handleRemoveCustom` — Remover do `activeTypes` também

Ao remover um tipo, ele deve sair do `activeTypes` para evitar referências a tipos inexistentes:

```typescript
const handleRemoveCustom = (type: string) => {
  setLocal(prev => prev.filter(c => c.activityType !== type));
  setActiveTypes(prev => { const next = new Set(prev); next.delete(type); return next; });
};
```

## Arquivos a Editar

- `src/components/activities/TimeBlockSettingsDialog.tsx`
  - Corrigir `useEffect` de sincronização para garantir atualização completa do `activeTypes`
  - Atualizar `handleAddCustom` para incluir novo tipo no `activeTypes` imediatamente
  - Atualizar `handleRemoveCustom` para remover tipo do `activeTypes`
