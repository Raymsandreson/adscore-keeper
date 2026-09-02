/**
 * Template da Cloud API: contagem e preenchimento de {{n}}.
 *
 * O corpo aprovado mora na Meta, não no nosso banco. A tela precisa mostrar ao
 * atendente o texto EXATO que o cliente vai receber antes de mandar — mandar
 * template às cegas é como enviar uma carta lacrada por outra pessoa.
 */

export interface CloudTemplate {
  name: string;
  status: string;
  language: string;
  category: string;
  body_text: string;
  footer_text?: string | null;
  body_params: number;
}

/** Índices das variáveis do corpo, em ordem crescente e sem repetição: [1, 2]. */
export function variaveisDoCorpo(bodyText: string): number[] {
  const achados = bodyText.match(/\{\{(\d+)\}\}/g) || [];
  const nums = achados.map((v) => Number(v.replace(/\D/g, '')));
  return [...new Set(nums)].sort((a, b) => a - b);
}

/**
 * Troca {{1}}, {{2}}... pelos parâmetros, na ordem. Variável sem valor fica
 * visível como `[1]` — melhor a lacuna aparecer aqui do que chegar no cliente.
 */
export function renderizarTemplate(bodyText: string, params: string[]): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
    const valor = params[Number(n) - 1];
    return valor && valor.trim() ? valor : `[${n}]`;
  });
}

/** Só template APPROVED pode ser enviado — os outros a Meta recusa. */
export function templatesEnviaveis(templates: CloudTemplate[]): CloudTemplate[] {
  return templates.filter((t) => (t.status || '').toUpperCase() === 'APPROVED');
}
