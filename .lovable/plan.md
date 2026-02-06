
# Plano: Correção do Status de Veiculação dos Ad Sets

## Problema Identificado

Ao selecionar a aba "Conjuntos", alguns ad sets aparecem como "Pausado" no app mesmo estando ativos no Gerenciador de Anúncios da Meta.

## Análise Técnica

Após investigar os logs da API e o código, identifiquei que:

1. **O campo `effective_status` da API** retorna o status real de veiculação, incluindo:
   - `ACTIVE` - veiculando normalmente
   - `PAUSED` - pausado manualmente
   - `CAMPAIGN_PAUSED` - ad set ativo, mas campanha pai pausada
   - `ADSET_PAUSED` - ad set pausado

2. **Problema atual**: O código mapeia qualquer status diferente de `ACTIVE` para `PAUSED`, o que pode não refletir o status real do ad set individualmente.

3. **Possível causa**: Se o Gerenciador de Anúncios mostra "Ativo" mas a API retorna outro status, pode haver:
   - Atraso na sincronização da API (até 15 minutos)
   - Diferença entre o `status` do ad set vs `effective_status` de veiculação

## Solução Proposta

Buscar também o campo `status` (além do `effective_status`) para diferenciar:
- **Status configurado**: se o ad set está configurado como ativo/pausado
- **Status de veiculação**: se está realmente veiculando (considera também a campanha pai)

### Mudanças no Código

**Arquivo: `src/services/metaAPI.ts`**

1. Adicionar o campo `status` na query dos ad sets:
```text
fields=id,name,status,effective_status,insights...
```

2. Ajustar a lógica de mapeamento para usar o `status` do próprio ad set:
   - Se `status === 'ACTIVE'` → mostrar como "Ativo" (mesmo que campanha esteja pausada)
   - Se `status === 'PAUSED'` → mostrar como "Pausado"

3. Opcionalmente, adicionar um indicador visual quando o ad set está ativo mas a campanha está pausada (ex: "Ativo (campanha pausada)")

---

**Próximos passos após aprovação:**
1. Atualizar a query da API para incluir o campo `status`
2. Ajustar a lógica de mapeamento no `getAdSetInsights`
3. Testar a exibição correta dos status

