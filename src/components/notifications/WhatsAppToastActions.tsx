import { useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { AISuggestReply } from '@/components/ui/AISuggestReply';
import { WhatsAppAgentToggle } from '@/components/whatsapp/WhatsAppAgentToggle';
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
