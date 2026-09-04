/**
 * Quanto falta para a mensagem agendada sair — contando de segundo em segundo.
 *
 * É um componente próprio, e não um `useState` dentro do WhatsAppChat, por um
 * motivo de custo: a conversa é um componente de milhares de linhas com lista
 * virtualizada. Um relógio lá dentro re-renderizaria a conversa inteira uma vez
 * por segundo. Aqui o tique morre nesta caixinha.
 *
 * O intervalo só existe enquanto falta tempo. Passou da hora, o timer se
 * desliga sozinho — quem manda a partir daí é o disparo do banco.
 */
import { useEffect, useState } from 'react';
import { faltaPara } from '@/lib/mensagemAgendada';

interface Props {
  /** Quando a mensagem está marcada para sair. */
  quando: Date | string;
  className?: string;
}

export function ContagemAteEnvio({ quando, className }: Props) {
  const [falta, setFalta] = useState(() => faltaPara(quando));

  useEffect(() => {
    setFalta(faltaPara(quando));
    const id = setInterval(() => {
      const restante = faltaPara(quando);
      setFalta(restante);
      if (restante === null) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [quando]);

  // Passou da hora: o tick do banco roda a cada minuto, então existe uma janela
  // curta em que a hora chegou e a mensagem ainda não saiu. Dizer "saindo" é
  // honesto; dizer "0s" faria parecer travado.
  if (falta === null) return <span className={className}>saindo…</span>;

  return <span className={className}>sai em {falta}</span>;
}
