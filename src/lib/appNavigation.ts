/**
 * Navegação interna para módulos montados FORA do Router.
 *
 * TeamChatNotifications e ActivityNotificationsListener vivem acima do
 * BrowserRouter (App.tsx) e não têm useNavigate — navegavam com
 * window.location.assign, e a recarga completa apagava todos os popups de
 * notificação na tela. Aqui o clique vira navegação SPA: o AppNavigationBridge
 * (dentro do Router) registra o navigate real, e os toasts do sonner — montados
 * fora do Router — sobrevivem à troca de página.
 *
 * Sem ponte registrada (ex.: tela de login), cai no location.assign de sempre.
 */

type Navigator = (to: string) => void;

let navigator: Navigator | null = null;

export function registerAppNavigator(handler: Navigator) {
  navigator = handler;
  return () => {
    if (navigator === handler) navigator = null;
  };
}

export function appNavigate(to: string) {
  if (navigator) navigator(to);
  else window.location.assign(to);
}
