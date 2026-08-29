import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { AISuggestReply } from '@/components/ui/AISuggestReply';
import { WhatsAppAgentToggle } from '@/components/whatsapp/WhatsAppAgentToggle';
import { useSugestaoAutomatica } from '@/hooks/useSugestaoAutomatica';
import {
  historicoDaConversa,
  pendenciaDaConversa,
  transcricaoDaConversa,
  type MensagemDaConversa,
} from '@/lib/whatsappQuickReply';

/**
 * O que dá para fazer com a conversa SEM sair do popup de aviso.
 *
 * O popup já respondia; faltava o resto do que se faz com uma mensagem que
 * acabou de chegar: pedir a resposta para a IA e ligar/desligar o agente que
 * atende essa conversa sozinho. Reaproveita os mesmos componentes do chat —
 * é a mesma sugestão e o mesmo agente, não uma versão paralela.
 *
 * Carregado sob demanda (lazy) pela ponte de push: o app inteiro não precisa
 * carregar o diálogo de IA por causa de um aviso que talvez nem apareça.
 */

interface SuggestProps {
  phone: string;
  instanceName: string | null;
  contactName?: string | null;
  /** Onde a sugestão escolhida cai — o campo de resposta do popup. */
  onApply: (text: string) => void;
}

export function WhatsAppSuggestReplyButton({ phone, instanceName, contactName, onApply }: SuggestProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // A IA lê a conversa, não só a linha do aviso: o histórico é buscado no
  // clique (o popup aparece muitas vezes, e quase nunca alguém pede sugestão).
  const historico = useRef<MensagemDaConversa[]>([]);

  const abrir = async () => {
    if (loading) return;
    setLoading(true);
    try {
      historico.current = await historicoDaConversa(phone, instanceName);
      if (!historico.current.length) {
        toast.error('Sem histórico desta conversa para basear a sugestão');
        return;
      }
      setOpen(true);
    } catch (error) {
      console.error('[WhatsAppSuggestReplyButton] falha ao ler a conversa:', error);
      toast.error('Não consegui ler a conversa para sugerir');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void abrir()}
        disabled={loading}
        title="Sugerir resposta com IA (baseada na conversa)"
        aria-label="Sugerir resposta com IA"
        className="shrink-0 p-1.5 rounded-md hover:bg-accent transition-colors disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <Sparkles className="h-4 w-4 text-primary" />
        )}
      </button>

      <AISuggestReply
        buildContext={() => transcricaoDaConversa(historico.current, contactName)}
        getState={() => pendenciaDaConversa(historico.current)}
        onApply={onApply}
        open={open}
        onOpenChange={setOpen}
        hideTrigger
        elevated
      />
    </>
  );
}

/**
 * Sugestão automática no popup: a resposta da IA já chega escrita, sem ninguém
 * pedir — o mesmo comportamento do campo do chat, com o mesmo hook e a mesma
 * preferência (`wa-sugestao-automatica`; desligou lá, desliga aqui). Um toque
 * no texto leva a sugestão para o campo de resposta; nada é enviado sozinho.
 *
 * Diferente do botão de ✨ (que busca o histórico só no clique), aqui o
 * histórico é buscado assim que o popup aparece — é o preço de a sugestão
 * nascer pronta. A chamada à IA continua condicionada: só quando a última fala
 * é do cliente e a preferência está ligada.
 */
export function WhatsAppSugestaoAutomatica({ phone, instanceName, contactName, onApply }: SuggestProps) {
  const [historico, setHistorico] = useState<MensagemDaConversa[]>([]);

  useEffect(() => {
    let vivo = true;
    historicoDaConversa(phone, instanceName)
      .then((msgs) => { if (vivo) setHistorico(msgs); })
      // Falha em silêncio: ninguém pediu nada — o botão de ✨ continua lá.
      .catch((e) => console.warn('[WhatsAppSugestaoAutomatica] sem histórico:', e));
    return () => { vivo = false; };
  }, [phone, instanceName]);

  const ultima = historico[historico.length - 1];
  const ancora = ultima ? `${phone}|${instanceName || ''}|${ultima.created_at}` : '';

  const { sugestao, carregando, aceitar, dispensar, regenerar } = useSugestaoAutomatica({
    ativa: historico.length > 0,
    ancora,
    buildContext: () => transcricaoDaConversa(historico, contactName),
    getState: () => pendenciaDaConversa(historico),
  });

  if (!carregando && !sugestao) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      {carregando ? (
        <span className="text-xs text-muted-foreground">A IA está escrevendo uma sugestão de resposta...</span>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onApply(aceitar())}
            title="Usar esta sugestão (cai no campo de resposta para revisar e enviar)"
            className="min-w-0 flex-1 text-left text-xs leading-snug text-foreground/90 line-clamp-3 hover:text-foreground"
          >
            {sugestao}
          </button>
          <button
            type="button"
            onClick={regenerar}
            className="shrink-0 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Outra
          </button>
          <button
            type="button"
            onClick={dispensar}
            aria-label="Dispensar sugestão"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}

interface AgentProps {
  phone: string;
  instanceName: string;
}

/**
 * Liga, troca ou desliga o agente de IA desta conversa, direto do aviso.
 * Ganha rótulo: no cabeçalho do chat o robozinho sozinho se explica pelo
 * contexto, num aviso solto não.
 */
export function WhatsAppToastAgentToggle({ phone, instanceName }: AgentProps) {
  return <WhatsAppAgentToggle phone={phone} instanceName={instanceName} label="Agente IA" />;
}
