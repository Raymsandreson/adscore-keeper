/* Service worker SÓ de Web Push — NÃO intercepta fetch e NÃO cacheia nada.
   Isolado (escopo /push-sw/) para não reintroduzir o problema de bundle velho
   que motivou o kill-switch em sw.js. Só trata push e clique na notificação. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** Todas as abas do app (mesmo as que este SW não controla). */
async function windowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

/** Avisa as abas abertas. Nunca lança: aba morta não pode derrubar o handler. */
function tell(client, message) {
  try {
    client.postMessage(message);
  } catch (e) {
    /* ignora */
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'WhatsJUD';
  const options = {
    body: data.body || '',
    icon: data.icon || '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
    requireInteraction: !!data.urgent,
    vibrate: data.urgent ? [200, 100, 200] : [100],
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Com o app aberto o balão do Windows costuma cair direto na Central de
    // Notificações e passa despercebido. Repassar o payload deixa o app mostrar
    // o aviso DENTRO do sistema, onde a pessoa já está olhando.
    const clientsArr = await windowClients();
    clientsArr.forEach((client) => tell(client, { type: 'push-received', payload: { ...data, title } }));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const clientsArr = await windowClients();
    // Foca a aba que já estava em uso; sem nenhuma em foco, a primeira serve.
    const target = clientsArr.find((c) => c.focused) || clientsArr.find((c) => 'focus' in c);

    if (target) {
      // Quem abre a conversa é o APP, não este service worker.
      //
      // `client.navigate()` não serve aqui: as páginas do app vivem em "/" e
      // NÃO são controladas por este SW (escopo /push-sw/), então a chamada
      // rejeita com TypeError. O catch engolia o erro e sobrava só o focus() —
      // era exatamente o "clico na notificação e não acontece nada".
      tell(target, { type: 'push-notification-click', url });
      return target.focus();
    }

    // Nenhuma aba aberta: aí sim a URL abre uma janela nova.
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
