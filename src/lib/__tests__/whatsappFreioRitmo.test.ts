/**
 * Freio de abordagem a número novo — a ponte entre o gate do banco e a tela.
 *
 * O que estes testes travam:
 *  - só resposta do freio abre o painel (INSTANCE_DISCONNECTED não pode);
 *  - variação idêntica ao original é DESCARTADA — devolvê-la mandaria o
 *    operador bater na mesma porta, porque o gate barra pelo hash do texto;
 *  - IA indisponível devolve aviso, não lista vazia silenciosa;
 *  - a instrução de variação carrega as proibições que impedem a IA de
 *    devolver o telemarketing que estamos tentando evitar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, invokeMock } = vi.hoisted(() => {
  const state = { resposta: null as unknown, erro: null as unknown, chamadas: [] as unknown[] };
  const invokeMock = vi.fn(async (_nome: string, opts: { body: unknown }) => {
    state.chamadas.push(opts.body);
    return { data: state.resposta, error: state.erro };
  });
  return { state, invokeMock };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: invokeMock } },
}));
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import {
  isFreioDeRitmoError,
  gerarVariacoes,
  promptDeVariacao,
} from '../whatsappFreioRitmo';

beforeEach(() => {
  state.resposta = null;
  state.erro = null;
  state.chamadas = [];
  invokeMock.mockClear();
});

describe('isFreioDeRitmoError', () => {
  it('reconhece os quatro códigos do gate', () => {
    for (const c of [
      'RITMO_TETO_DIARIO',
      'RITMO_RITMO',
      'RITMO_TEXTO_REPETIDO',
      'RITMO_INSTANCIA_FORA_DO_AR',
    ]) {
      expect(isFreioDeRitmoError({ error_code: c })).toBe(true);
    }
  });

  it('não confunde com outras falhas de envio', () => {
    expect(isFreioDeRitmoError({ error_code: 'INSTANCE_DISCONNECTED' })).toBe(false);
    expect(isFreioDeRitmoError({ error_code: 'RECIPIENT_OPTED_OUT' })).toBe(false);
    expect(isFreioDeRitmoError({ error_code: 'SEND_FAILED' })).toBe(false);
    expect(isFreioDeRitmoError({})).toBe(false);
    expect(isFreioDeRitmoError(null)).toBe(false);
    expect(isFreioDeRitmoError(undefined)).toBe(false);
  });
});

describe('promptDeVariacao', () => {
  it('proíbe abertura de telemarketing e invenção de dado', () => {
    const p = promptDeVariacao(7);
    expect(p).toMatch(/PROIBIDO abertura de telemarketing/);
    expect(p).toMatch(/NÃO invente informação/);
    expect(p).toMatch(/NÃO prometa resultado/);
    expect(p).toContain('7 números diferentes');
  });

  it('exige mudar a construção, não só sinônimo', () => {
    expect(promptDeVariacao(3)).toMatch(/Trocar sinônimo não resolve/);
  });
});

describe('gerarVariacoes', () => {
  it('devolve as opções da IA', async () => {
    state.resposta = { options: ['Primeira versão', 'Segunda versão', 'Terceira versão'] };
    const { opcoes, aviso } = await gerarVariacoes('Texto original', 5);
    expect(opcoes).toHaveLength(3);
    expect(aviso).toBeUndefined();
  });

  it('descarta opção idêntica ao original, mesmo com espaço e caixa diferentes', async () => {
    state.resposta = {
      options: ['  TEXTO   original ', 'Uma versão de verdade', 'Texto original'],
    };
    const { opcoes } = await gerarVariacoes('Texto original', 5);
    expect(opcoes).toEqual(['Uma versão de verdade']);
  });

  it('avisa quando a IA devolveu só o original, em vez de lista vazia calada', async () => {
    state.resposta = { options: ['Texto original'] };
    const { opcoes, aviso } = await gerarVariacoes('Texto original', 5);
    expect(opcoes).toEqual([]);
    expect(aviso).toMatch(/mesmo texto/i);
  });

  it('propaga o aviso de IA sobrecarregada', async () => {
    state.resposta = {
      options: ['Texto original'],
      error: 'AI_UNAVAILABLE',
      message: 'O serviço de IA está sobrecarregado no momento.',
    };
    const { opcoes, aviso } = await gerarVariacoes('Texto original', 5);
    expect(opcoes).toEqual([]);
    expect(aviso).toBe('O serviço de IA está sobrecarregado no momento.');
  });

  it('erro de transporte não estoura para a tela', async () => {
    state.erro = { message: 'network' };
    const { opcoes, aviso } = await gerarVariacoes('Texto original', 5);
    expect(opcoes).toEqual([]);
    expect(aviso).toMatch(/IA/);
  });

  it('manda o texto e a instrução para o ai-text-editor', async () => {
    state.resposta = { options: ['Outra'] };
    await gerarVariacoes('Oi, tudo bem?', 9);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const body = state.chamadas[0] as { text: string; action: string; custom_prompt: string };
    expect(body.text).toBe('Oi, tudo bem?');
    expect(body.action).toBe('custom');
    expect(body.custom_prompt).toContain('9 números diferentes');
  });

  it('ignora entrada suja da IA (nulo, vazio, não-string)', async () => {
    state.resposta = { options: [null, '', '   ', 42, 'Boa opção'] };
    const { opcoes } = await gerarVariacoes('Texto original', 2);
    expect(opcoes).toEqual(['42', 'Boa opção']);
  });
});
