// Chamadas que o servidor faz a ele mesmo.
//
// Antes deste helper, seis lugares montavam a URL com RAILWAY_PUBLIC_URL e
// mandavam `x-api-key: process.env.RAILWAY_API_KEY || ''` — chave que nunca foi
// configurada em produção. Dois problemas nisso:
//
//   1. Credencial vazia. Passa hoje só porque o middleware está em modo
//      observação; no dia do RAILWAY_AUTH_ENFORCE=1 vira 401 silencioso, todos
//      fire-and-forget (`.catch(() => {})`), ou seja: quebra sem sintoma.
//   2. Sai pra internet pública e volta. O processo chama a si mesmo dando a
//      volta pelo proxy do Railway — latência, TLS e uma dependência de DNS
//      para entregar um POST no próprio event loop.
//
// O LOOPBACK_TOKEN é sorteado a cada boot e nunca sai da máquina, então a
// autenticação aqui não depende de nenhum secret estar configurado.
import { LOOPBACK_TOKEN } from './functionAuth';

function selfBase(): string {
  // PORT é lido na hora da chamada, não na carga do módulo: em teste o servidor
  // sobe em porta efêmera depois do import.
  return `http://127.0.0.1:${process.env.PORT || 3000}`;
}

export function selfUrl(fnName: string): string {
  return `${selfBase()}/functions/${fnName}`;
}

export function selfHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-internal-key': LOOPBACK_TOKEN,
    ...extra,
  };
}

/** POST autenticado no próprio processo. Não engole erro — quem chama decide. */
export function selfPost(
  fnName: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return fetch(selfUrl(fnName), {
    method: 'POST',
    headers: selfHeaders(extraHeaders),
    body: JSON.stringify(body),
  });
}
