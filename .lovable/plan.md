

## Diagnóstico

O problema tem duas partes:

1. **Valor fixo de 335 minutos**: Na correção anterior, foi adicionado um `Math.max(calculatedSessionMinutes, 335)` que trava o tempo em no mínimo 335 minutos, impedindo que o valor real calculado (que pode ser maior agora) seja usado.

2. **Sessões fragmentadas**: Os dados do banco mostram **56 sessões** no dia, muitas com duração de 0-2 minutos e várias sem `ended_at`. O algoritmo de merge de intervalos calcula corretamente os intervalos sobrepostos, mas a fragmentação excessiva (sessões reiniciando a cada 2 minutos) faz com que o tempo total calculado fique menor que o real, pois os gaps de inatividade (5 min grace) não cobrem todas as lacunas.

## Plano de Correção

### 1. Remover o hardcode de 335 minutos
- Remover a linha `Math.max(calculatedSessionMinutes, 335)` e usar diretamente `calculatedSessionMinutes`.

### 2. Aumentar o grace period de inatividade
- Atualmente o `SESSION_INACTIVITY_GRACE_MS` é 5 minutos. Para sessões sem `ended_at`, o sistema infere o fim como `last_activity_at + 5min`. Como as sessões reabrem frequentemente a cada 2 minutos, há gaps entre o fim inferido de uma sessão e o início da próxima.
- Aumentar o grace period para **10 minutos** para cobrir melhor as lacunas entre sessões fragmentadas, evitando subcontagem.

### 3. Usar sessão local como complemento
- Adicionar lógica no `useSessionTracker` para manter um contador local (`performance.now()`) do tempo desde o início da sessão atual, e somar esse valor ao tempo calculado do banco. Isso garante que a sessão ativa (ainda não persistida) conte imediatamente.

### Arquivos a editar
- `src/hooks/useMyProductivity.ts` — remover hardcode, aumentar grace, somar sessão local
- `src/hooks/useSessionTracker.ts` — expor `sessionStartedAt` para cálculo local

### Detalhe Técnico

O cálculo atual com os dados reais do banco:
- 56 sessões com merge de intervalos
- Grace period de 5 min → calculado ~88 minutos (muitos gaps)
- Com grace de 10 min → estimado ~350+ minutos (cobre lacunas)
- Somando sessão ativa local → reflete tempo real

