// Envio pelo Expo Push Service — o canal do app mobile.
//
// Diferente do Web Push, aqui não há chave VAPID nem assinatura por
// destinatário: o token ("ExponentPushToken[...]") é o endereço, e o Expo
// encaminha para FCM (Android) ou APNs (iOS). A credencial que importa está
// configurada no projeto EAS, não neste servidor.
//
// A API aceita no máximo 100 mensagens por requisição e responde com um
// "ticket" por mensagem, na MESMA ordem em que foram enviadas — é assim que se
// sabe qual token morreu.

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const LOTE = 100;

export interface ExpoMensagem {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  urgente?: boolean;
  /**
   * Chave de SUBSTITUIÇÃO: chegando outra com a mesma chave, ela toma o lugar da
   * anterior em vez de empilhar. É o equivalente do `tag` do Web Push, e no Expo
   * precisa de dois campos porque as plataformas resolvem isso em lugares
   * diferentes — `tag` troca a notificação já na tela do Android, `collapseId`
   * faz o mesmo no iOS e, nos dois, faz o aparelho offline receber só a última.
   *
   * Só use onde a mensagem nova CONTÉM a anterior. Substituir texto que a pessoa
   * ainda não leu por texto novo apaga o que ela não viu.
   */
  substitui?: string;
}

export interface ResultadoExpo {
  enviados: number;
  falhas: number;
  /** Tokens que o Expo declarou mortos — o chamador apaga a linha. */
  tokensMortos: string[];
}

interface Ticket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

function paraCorpo(m: ExpoMensagem) {
  return {
    to: m.to,
    title: m.title,
    body: m.body,
    data: m.data || {},
    sound: 'default',
    // 'high' entrega com o app fechado; o padrão do Android pode segurar a
    // notificação até a próxima janela de sincronização, que é justamente o
    // problema que o Web Push já tinha.
    priority: 'high',
    channelId: m.urgente ? 'urgente' : 'default',
    ...(m.substitui ? { tag: m.substitui, collapseId: m.substitui } : {}),
  };
}

/**
 * Envia em lotes. Nunca lança: push é complemento, e derrubar o alerta gravado
 * em `activity_timer_alerts` por causa de uma falha de rede do Expo seria pior
 * que não notificar.
 */
export async function enviarExpo(mensagens: ExpoMensagem[]): Promise<ResultadoExpo> {
  const out: ResultadoExpo = { enviados: 0, falhas: 0, tokensMortos: [] };
  if (mensagens.length === 0) return out;

  for (let i = 0; i < mensagens.length; i += LOTE) {
    const lote = mensagens.slice(i, i + LOTE);
    try {
      const resposta = await fetch(EXPO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(lote.map(paraCorpo)),
      });

      if (!resposta.ok) {
        out.falhas += lote.length;
        console.warn('[expo-push] HTTP', resposta.status, (await resposta.text()).slice(0, 200));
        continue;
      }

      const json = (await resposta.json()) as { data?: Ticket[] };
      const tickets = json.data || [];

      lote.forEach((m, idx) => {
        const t = tickets[idx];
        if (!t || t.status === 'ok') {
          out.enviados++;
          return;
        }
        out.falhas++;
        // DeviceNotRegistered = app desinstalado ou token rotacionado. É o
        // equivalente ao 404/410 do Web Push.
        if (t.details?.error === 'DeviceNotRegistered') out.tokensMortos.push(m.to);
        else console.warn('[expo-push] ticket com erro:', t.message || t.details?.error);
      });
    } catch (err) {
      out.falhas += lote.length;
      console.warn('[expo-push] lote falhou:', err);
    }
  }

  return out;
}
