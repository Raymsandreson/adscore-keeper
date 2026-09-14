// Limpeza do ditado — o passo que transforma fala em texto legível.
//
// Por que estes testes existem: a perna primária de STT (ElevenLabs Scribe)
// devolve o áudio VERBATIM, com "é...", "tipo" e começo abandonado. Quem dita
// um pedido pra outra IA depende desta segunda passada. E, como ela é uma
// chamada de modelo a mais, ela PODE falhar — e falhar aqui não pode custar o
// que a pessoa acabou de falar.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const geminiChat = vi.fn();
vi.mock('../../lib/gemini', () => ({ geminiChat: (...a: unknown[]) => geminiChat(...a) }));
vi.mock('../../lib/stt', () => ({ transcribeAudioDetailed: vi.fn() }));

import { limparDitado, montarPromptLimpeza, polirSaida } from '../transcribe-team-audio';

const CRU = 'é... então assim, ó, adiciona um passo, tipo, um passo de envio de contrato na fase de fechamento, entendeu?';

beforeEach(() => { geminiChat.mockReset(); });

const resposta = (texto: string) => ({ choices: [{ message: { content: texto } }] });

describe('polirSaida', () => {
  it('tira aspas, cerca de código e rótulo que o modelo às vezes cola na frente', () => {
    expect(polirSaida('"Adicione um passo de envio de contrato."')).toBe('Adicione um passo de envio de contrato.');
    expect(polirSaida('```\nAdicione um passo.\n```')).toBe('Adicione um passo.');
    expect(polirSaida('Texto limpo: Adicione um passo.')).toBe('Adicione um passo.');
  });

  it('não estraga texto que tem aspas só no meio', () => {
    const t = 'Crie a fase "Fechamento" com checklist.';
    expect(polirSaida(t)).toBe(t);
  });
});

describe('montarPromptLimpeza', () => {
  it('proíbe resumir e inventar — limpar não é reescrever', () => {
    const p = montarPromptLimpeza();
    expect(p).toMatch(/NÃO resumir/);
    expect(p).toMatch(/NÃO acrescentar/);
  });

  it('leva o contexto do campo, deixando claro que é só tom (não é ordem a executar)', () => {
    const p = montarPromptLimpeza('instrução para a IA editar um fluxo de trabalho');
    expect(p).toContain('instrução para a IA editar um fluxo de trabalho');
    expect(p).toMatch(/NÃO responda/);
  });
});

describe('limparDitado', () => {
  it('devolve o texto limpo quando a IA responde', async () => {
    geminiChat.mockResolvedValue(resposta('Adicione um passo de envio de contrato na fase de Fechamento.'));
    const r = await limparDitado(CRU, 'editar fluxo');
    expect(r.texto).toBe('Adicione um passo de envio de contrato na fase de Fechamento.');
    expect(r.falhou).toBeUndefined();
  });

  it('IA fora do ar não apaga o ditado: volta o texto cru e avisa', async () => {
    geminiChat.mockRejectedValue(new Error('503 model overloaded'));
    const r = await limparDitado(CRU);
    expect(r.texto).toBe(CRU);
    expect(r.falhou).toContain('503');
  });

  it('resposta vazia cai no cru (limpeza que some é pior que texto sujo)', async () => {
    geminiChat.mockResolvedValue(resposta(''));
    const r = await limparDitado(CRU);
    expect(r.texto).toBe(CRU);
    expect(r.falhou).toBeDefined();
  });

  it('resumo disfarçado de limpeza é recusado', async () => {
    // 8 caracteres para um ditado de 100+: isso não é limpeza, é resumo.
    geminiChat.mockResolvedValue(resposta('Contrato'));
    const r = await limparDitado(CRU);
    expect(r.texto).toBe(CRU);
    expect(r.falhou).toBeDefined();
  });

  it('ditado vazio não gasta chamada de IA', async () => {
    const r = await limparDitado('   ');
    expect(r.texto).toBe('');
    expect(geminiChat).not.toHaveBeenCalled();
  });
});
