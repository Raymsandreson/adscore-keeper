// =============================================================================
// Abre a MOVIMENTAÇÃO apontada por uma notificação, de qualquer página.
//
// Antes (até 01/09/2026) o aviso de movimentação nascia com a URL
// `/leads?openLead=<id>`: clicar no balão tirava a pessoa de onde ela estava e
// jogava no kanban do lead — que não é o processo, não mostra a movimentação e
// não responde a pergunta que fez o aviso existir ("o cliente já foi avisado
// disto?"). Agora o clique abre este painel POR CIMA da tela atual, de baixo
// pra cima, com:
//
//   - a movimentação do aviso destacada, com eventos do tribunal e passo do POP;
//   - a etiqueta "Notificado em / por quem" — ou o botão Notificar, se ninguém
//     avisou o cliente ainda;
//   - o botão da ficha completa do processo, empilhada por cima.
//
// É o MESMO ProcessUpdatesBell da barra lateral e da ficha da atividade, em
// modo escopado — não uma segunda tela de movimentação para manter.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { subscribeToMovimentacaoSheet } from '@/lib/movimentacaoSheet';
import { useAuthContext } from '@/contexts/AuthContext';
import { ProcessUpdatesBell } from '@/components/notifications/ProcessUpdatesBell';

interface Aberta {
  processId: string;
  updateId: string | null;
  processLabel: string | null;
}

export function MovimentacaoSheetHost() {
  const [aberta, setAberta] = useState<Aberta | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated } = useAuthContext();

  /**
   * Abre o painel. Sem o processo em mãos (aviso antigo, link copiado), a
   * própria linha da movimentação diz qual é — uma consulta, só nesse caso.
   */
  const abrir = useCallback(async (
    processId: string | null | undefined,
    updateId: string | null | undefined,
    processLabel: string | null | undefined,
  ) => {
    if (processId) {
      setAberta({ processId, updateId: updateId ?? null, processLabel: processLabel ?? null });
      return;
    }
    if (!updateId) return;
    try {
      await ensureExternalSession();
      // `process_updates` mora no Supabase Externo e não está nos tipos
      // gerados (mesmo motivo do cast em useProcessUpdates).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = db as any;
      const { data } = await client
        .from('process_updates')
        .select('process_id, processo_titulo, numero_cnj')
        .eq('id', updateId)
        .maybeSingle();
      const linha = data as { process_id: string; processo_titulo: string | null; numero_cnj: string | null } | null;
      if (!linha?.process_id) return;
      setAberta({
        processId: linha.process_id,
        updateId,
        processLabel: processLabel ?? linha.processo_titulo ?? linha.numero_cnj ?? null,
      });
    } catch (e) {
      console.warn('[MovimentacaoSheetHost] não deu para resolver a movimentação:', e);
    }
  }, []);

  // Intent do app aberto (clique no balão com o sistema em uso).
  useEffect(
    () => subscribeToMovimentacaoSheet(({ processId, updateId, processLabel }) => {
      void abrir(processId, updateId, processLabel);
    }),
    [abrir],
  );

  /**
   * Boot frio: o service worker abre a aba já em `/?openUpdate=…&processo=…`.
   * O processo vem na URL para não custar uma ida ao banco no caminho comum;
   * sem ele (link copiado, aviso antigo), a linha da movimentação diz qual é.
   */
  const openUpdate = searchParams.get('openUpdate');
  const processoParam = searchParams.get('processo');

  const limparParams = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete('openUpdate');
    params.delete('processo');
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    // Antes do login o parâmetro não é consumido: o painel apareceria por cima
    // da tela de entrada e, pior, a limpeza apagaria da URL o destino que o
    // ProtectedRoute guarda em `returnTo` para restaurar depois do login.
    if (!openUpdate || !isAuthenticated) return;
    void abrir(processoParam, openUpdate, null);
    // Some da URL na hora: parâmetro que sobrevive faria o painel voltar a
    // abrir a cada troca de página.
    limparParams();
  }, [openUpdate, processoParam, limparParams, abrir, isAuthenticated]);

  if (!aberta) return null;

  return (
    <ProcessUpdatesBell
      processId={aberta.processId}
      processLabel={aberta.processLabel}
      destaqueUpdateId={aberta.updateId}
      // De baixo pra cima e sem gatilho: não há sino nenhum nesta montagem, ela
      // existe só enquanto o painel da notificação está aberto.
      side="bottom"
      hideTrigger
      mostrarFichaProcesso
      open
      onOpenChange={(o) => { if (!o) setAberta(null); }}
    />
  );
}
