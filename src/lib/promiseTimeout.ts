/**
 * Teto de espera para uma promessa (tipicamente uma consulta ao Supabase).
 *
 * O `fetch` do supabase-js não tem timeout: a requisição fica pendurada até o
 * sistema operacional derrubar o socket. No celular, abrindo o app pelo popup
 * de notificação, a aba costuma estar voltando do segundo plano com a conexão
 * morta — e a espera passa de 10 minutos, ou nunca termina. Sem teto, a tela
 * fica no spinner para sempre; com teto, vira erro visível e recuperável.
 *
 * A requisição original NÃO é abortada (não há signal aqui): o teto é sobre a
 * espera da UI. Se a resposta chegar depois, é descartada pelo chamador.
 */
export class PromiseTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: sem resposta em ${ms}ms`);
    this.name = 'PromiseTimeoutError';
  }
}

export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PromiseTimeoutError(label, ms)), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
