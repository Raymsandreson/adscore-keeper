/**
 * WhatsAppAvatar — a foto de perfil do contato/grupo no WhatsApp.
 *
 * Só pede a foto quando o avatar entra na tela (IntersectionObserver único,
 * compartilhado): a lista do inbox tem centenas de conversas e cada foto nova é
 * uma chamada à UazAPI lá no servidor.
 *
 * Sem foto, com erro de carregamento ou sem instância, cai no mesmo círculo
 * verde com ícone que a tela já usava — nunca fica buraco no lugar do avatar.
 */
import { useEffect, useRef, useState } from 'react';
import { User, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWhatsAppAvatars } from '@/hooks/useWhatsAppAvatars';

interface Props {
  phone: string;
  /**
   * De qual instância perguntar. Opcional: a ficha do lead e a lista de
   * contatos só têm o telefone, e aí quem descobre é o servidor.
   */
  instanceName?: string | null;
  isGroup?: boolean;
  /** Item selecionado na lista: o círculo troca de cor junto com a linha. */
  selected?: boolean;
  /**
   * `false` mostra a foto só se já estiver em cache, sem ir buscar. É o que
   * telas com lista enorme usam abaixo do próprio teto de enriquecimento — em
   * 36 mil contatos, rolar tudo buscando foto seria uma consulta por linha.
   */
  autoFetch?: boolean;
  className?: string;
  iconClassName?: string;
}

// Um observer para todos os avatares. Um por componente custaria centenas de
// observers numa lista longa.
let observer: IntersectionObserver | null = null;
const callbacks = new Map<Element, () => void>();

function observe(el: Element, cb: () => void) {
  if (typeof IntersectionObserver === 'undefined') { cb(); return () => {}; }
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const fn = callbacks.get(entry.target);
        if (fn) { fn(); callbacks.delete(entry.target); observer!.unobserve(entry.target); }
      }
    }, { rootMargin: '200px' });
  }
  callbacks.set(el, cb);
  observer.observe(el);
  return () => { callbacks.delete(el); observer?.unobserve(el); };
}

export function WhatsAppAvatar({ phone, instanceName, isGroup, selected, autoFetch = true, className, iconClassName }: Props) {
  const { getAvatar, requestAvatar } = useWhatsAppAvatars();
  const ref = useRef<HTMLDivElement | null>(null);
  const [broken, setBroken] = useState(false);
  const url = getAvatar(phone, instanceName);

  useEffect(() => { setBroken(false); }, [url]);

  useEffect(() => {
    const el = ref.current;
    if (!el || url || !autoFetch) return;
    return observe(el, () => requestAvatar(phone, instanceName));
  }, [phone, instanceName, url, autoFetch, requestAvatar]);

  const Icon = isGroup ? Users : User;

  return (
    <div
      ref={ref}
      className={cn(
        'h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden',
        selected ? 'bg-primary-foreground/20' : 'bg-green-100 dark:bg-green-900/30',
        className,
      )}
    >
      {url && !broken ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <Icon className={cn('h-5 w-5', selected ? 'text-primary-foreground' : 'text-green-600', iconClassName)} />
      )}
    </div>
  );
}
