// ============================================================================
// Ouvir o áudio do INSS ANTES do cliente ouvir.
//
// Existe porque toda mudança de voz ou de ritmo, até aqui, só era audível
// depois de já ter ido para um grupo de cliente. Não dá para calibrar locução
// assim: quem decide se a voz está boa é gente ouvindo, e a única amostra
// disponível vinha de um caminho de preview com `speed: 1.1` — mais rápido do
// que o que a produção realmente gera, o que induz a decisão errada.
//
// Usa o MESMO `gerarTts` do envio real, então o que sai daqui é exatamente o
// que o cliente receberia com aqueles parâmetros. Cai sob o gate de
// autenticação de /functions/* como qualquer outra função.
// ============================================================================

import type { Request, Response } from 'express';
import { gerarTts, ROTEIROS, textoParaFala } from '../lib/inss-audio';

export async function handler(req: Request, res: Response, _next: () => void) {
  const body = (req.body || {}) as {
    texto?: string;
    chave?: string;
    voice_id?: string;
    speed?: number | number[];
  };

  // `chave` lê o roteiro que já está no código — é como se ouve o que vai ao ar
  // de verdade, sem alguém redigitar o texto e testar outra coisa.
  const texto = body.texto?.trim() || (body.chave ? ROTEIROS[body.chave] : '');
  if (!texto) {
    return res.status(400).json({
      success: false,
      error: 'informe `texto` ou uma `chave` de roteiro',
      chaves: Object.keys(ROTEIROS),
    });
  }

  const speeds = (Array.isArray(body.speed) ? body.speed : [body.speed])
    .map((s) => (s == null ? undefined : Number(s)))
    .slice(0, 4);

  const amostras: any[] = [];
  for (const speed of speeds) {
    const r = await gerarTts(texto, { voiceId: body.voice_id, speed });
    amostras.push({ speed: speed ?? 'padrão', ...('url' in r ? { url: r.url } : { erro: r.erro }) });
  }

  return res.json({
    success: amostras.some((a) => a.url),
    fala: textoParaFala(texto),
    voice_id: body.voice_id || null,
    amostras,
  });
}
