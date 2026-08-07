/**
 * Sinal compartilhado: o modal de instalação do PWA está na tela agora?
 *
 * Existe porque dois convites disputavam o mesmo momento — o `PWAInstallBanner`
 * (modal central, "instale o app") e o `PushNotificationPrompt` (faixa no topo,
 * "instale para receber notificações"). No iPhone os dois acendem juntos e ficam
 * sobrepostos, o que a regra de interface proíbe.
 *
 * Quem manda é o modal: enquanto ele estiver visível, a faixa se cala.
 */

let visible = false;
const listeners = new Set<(v: boolean) => void>();

export function setPwaBannerVisible(next: boolean) {
  if (visible === next) return;
  visible = next;
  listeners.forEach((fn) => fn(visible));
}

export function isPwaBannerVisible() {
  return visible;
}

export function subscribeToPwaBanner(fn: (v: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
