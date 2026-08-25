import { useCallback, useEffect, useRef, useState } from 'react';
import {
  gerarSugestaoDeResposta,
  type EstadoDaResposta,
  type ModoDaSugestao,
} from '@/lib/sugestaoDeResposta';

/**
 * Sugestão de resposta que já nasce escrita no campo de digitar.
 *
 * Em vez de abrir o dialog e pedir, a IA escreve a próxima resposta sozinha
 * assim que a conversa é aberta e o cliente está esperando. O texto aparece
 * apagado dentro do campo (não é o valor do campo — nada é enviado por acidente)
 * e só vira texto de verdade quando o usuário aceita.
 */

const CHAVE_PREF = 'wa-sugestao-automatica';

/** Lê a preferência do usuário. Ligada por padrão. */
export function sugestaoAutomaticaLigada(): boolean {
  try {
    return localStorage.getItem(CHAVE_PREF) !== 'false';
  } catch {
    return true; // navegador sem storage: segue ligada
  }
}

interface Params {
  /**
   * Se a sugestão faz sentido agora: conversa aberta, modo mensagem,
   * campo vazio, sem gravação/imagem colada em cima.
   */
  ativa: boolean;
  /**
   * Identidade do que seria respondido — normalmente `${conversa}:${idDaÚltimaMensagem}`.
   * Mudou, a sugestão anterior envelheceu e uma nova é pedida. Vazio = não pede nada.
   */
  ancora: string;
  /** Transcrição da conversa. */
  buildContext: () => string;
  /** Estado da conversa (há resposta pendente? o que já foi dito?). */
  getState: () => EstadoDaResposta;
  modo?: ModoDaSugestao;
}

export function useSugestaoAutomatica({ ativa, ancora, buildContext, getState, modo = 'client' }: Params) {
  const [ligada, setLigadaState] = useState(sugestaoAutomaticaLigada);
  const [sugestao, setSugestao] = useState('');
  const [carregando, setCarregando] = useState(false);

  // Funções vindas do pai mudam de identidade a cada render — guardadas em ref
  // para o efeito depender só da âncora, e não redisparar a cada digitação.
  const contextRef = useRef(buildContext);
  const stateRef = useRef(getState);
  contextRef.current = buildContext;
  stateRef.current = getState;

  // Âncora já atendida (gerada ou dispensada): impede pedir a mesma coisa de novo.
  const atendidaRef = useRef<string>('');
  const dispensadaRef = useRef<string>('');
  // Âncora do pedido em voo: resposta que chega fora de hora é descartada.
  const emVooRef = useRef<string>('');

  const pedir = useCallback(async (chave: string) => {
    const ctx = contextRef.current();
    if (!ctx.trim()) return;
    const st = stateRef.current();
    // Sem resposta pendente (o último a falar fomos nós), não há o que sugerir.
    if (!st?.pending) return;
    emVooRef.current = chave;
    setCarregando(true);
    try {
      const opts = await gerarSugestaoDeResposta({
        contexto: ctx,
        modo,
        jaEnviado: st.lastOutboundText,
        ultimaDoInterlocutor: st.lastClientText,
      });
      if (emVooRef.current !== chave) return; // conversa já mudou
      setSugestao((opts[0] || '').trim());
    } catch (e) {
      // Sugestão automática falha em silêncio: o usuário não pediu nada,
      // não faz sentido interromper com erro. O botão do dialog continua lá.
      console.warn('Sugestão automática indisponível:', e);
      if (emVooRef.current === chave) setSugestao('');
    } finally {
      if (emVooRef.current === chave) setCarregando(false);
    }
  }, [modo]);

  useEffect(() => {
    if (!ligada || !ativa || !ancora) return;
    if (atendidaRef.current === ancora || dispensadaRef.current === ancora) return;
    // Espera a conversa assentar: mensagens chegam em rajada pelo realtime e
    // cada rajada mudaria a âncora — sem isso, seriam vários pedidos à IA.
    const t = setTimeout(() => {
      atendidaRef.current = ancora;
      void pedir(ancora);
    }, 900);
    return () => clearTimeout(t);
  }, [ligada, ativa, ancora, pedir]);

  // Trocou de conversa, ou chegou mensagem nova: a sugestão anterior não serve
  // mais. Só a âncora zera — digitar no campo apenas esconde a sugestão, e ela
  // volta inteira se o campo for esvaziado, sem custar outra chamada à IA.
  useEffect(() => {
    emVooRef.current = '';
    setSugestao('');
    setCarregando(false);
  }, [ancora]);

  /** Tira a sugestão da tela e devolve o texto, para o campo receber. */
  const aceitar = useCallback((): string => {
    const texto = sugestao;
    setSugestao('');
    return texto;
  }, [sugestao]);

  /** Descarta a sugestão desta âncora — não volta sozinha até chegar mensagem nova. */
  const dispensar = useCallback(() => {
    dispensadaRef.current = ancora;
    emVooRef.current = '';
    setSugestao('');
    setCarregando(false);
  }, [ancora]);

  /** Pede outra sugestão para a mesma âncora (o usuário não gostou desta). */
  const regenerar = useCallback(() => {
    dispensadaRef.current = '';
    atendidaRef.current = ancora;
    setSugestao('');
    void pedir(ancora);
  }, [ancora, pedir]);

  const setLigada = useCallback((v: boolean) => {
    setLigadaState(v);
    try { localStorage.setItem(CHAVE_PREF, v ? 'true' : 'false'); } catch { /* sem storage: vale só nesta sessão */ }
    if (!v) {
      emVooRef.current = '';
      setSugestao('');
      setCarregando(false);
    } else {
      // Religou: a âncora atual volta a valer.
      atendidaRef.current = '';
      dispensadaRef.current = '';
    }
  }, []);

  return { sugestao, carregando, aceitar, dispensar, regenerar, ligada, setLigada };
}
