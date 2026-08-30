import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Teto do skeleton "Carregando conversa…". Se estourar, a tela mostra o que já
 * existe em vez de girar indefinidamente — mensagens que chegarem depois entram
 * normalmente na timeline.
 */
export const HYDRATION_TIMEOUT_MS = 8000;

type Params = {
  phone: string;
  instanceName?: string | null;
  /** Quantidade de mensagens que o pai já entregou para esta conversa. */
  messageCount: number;
  timeoutMs?: number;
};

/**
 * Detecta a hidratação da conversa: ao clicar, o pai passa a conversa contendo
 * apenas a mensagem-resumo (length <= 1) e dispara `fetchFullConversation` em
 * seguida. Sem este guard a UI pisca com a última mensagem + log de chamadas
 * antes do histórico chegar.
 *
 * O timeout de segurança vive num ref, e não numa variável local do efeito, de
 * propósito: se ele for criado e limpo dentro de um efeito que depende do
 * próprio estado de hidratação, o `setState` dispara o cleanup e cancela o
 * timeout antes de ele rodar — a conversa fica girando pra sempre quando a
 * hidratação não traz mensagem nova (falha de rede, `instance_name` ausente,
 * ou conversa que realmente só tem uma mensagem).
 */
export function useConversationHydration({
  phone,
  instanceName,
  messageCount,
  timeoutMs = HYDRATION_TIMEOUT_MS,
}: Params): boolean {
  const [isHydrating, setIsHydrating] = useState(false);
  const keyRef = useRef<string>('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHydrationTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    const key = `${phone}__${(instanceName || '').toLowerCase()}`;

    if (keyRef.current !== key) {
      keyRef.current = key;
      clearHydrationTimeout();
      if (messageCount <= 1) {
        setIsHydrating(true);
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null;
          setIsHydrating(false);
        }, timeoutMs);
        return;
      }
      setIsHydrating(false);
      return;
    }

    // Mesma conversa: qualquer mensagem que chegar depois do resumo encerra a
    // hidratação na hora, sem esperar o timeout.
    if (messageCount > 1) {
      clearHydrationTimeout();
      setIsHydrating(false);
    }
  }, [phone, instanceName, messageCount, timeoutMs, clearHydrationTimeout]);

  // Desmontar no meio da hidratação não pode deixar timer órfão setando estado.
  useEffect(() => clearHydrationTimeout, [clearHydrationTimeout]);

  return isHydrating;
}
