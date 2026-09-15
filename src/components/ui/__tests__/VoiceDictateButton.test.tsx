// Ditado por voz com limpeza de IA — o caminho inteiro do botão.
//
// O que estes testes seguram: (1) o pedido sai com `limpar: true`, que é o que
// diferencia este botão do ditado cru do chat; (2) o texto SEMPRE volta pro
// campo, inclusive quando a limpeza falha — perder o que a pessoa acabou de
// falar é o pior desfecho possível aqui; (3) clique sem fala não sobe arquivo
// nem paga transcrição.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const upload = vi.fn(async () => ({ error: null }));
const getPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://exemplo/ditados/a.webm' } }));
vi.mock('@/integrations/supabase', () => ({
  authClient: {
    storage: {
      from: () => ({
        upload: (...a: unknown[]) => upload(...(a as [])),
        getPublicUrl: (...a: unknown[]) => getPublicUrl(...(a as [])),
      }),
    },
  },
}));

const invoke = vi.fn();
vi.mock('@/lib/functionRouter', () => ({ cloudFunctions: { invoke: (...a: unknown[]) => invoke(...a) } }));

const toastErro = vi.fn(); const toastAviso = vi.fn(); const toastOk = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastErro(...a),
    warning: (...a: unknown[]) => toastAviso(...a),
    success: (...a: unknown[]) => toastOk(...a),
  },
}));

import { VoiceDictateButton } from '../voice-dictate-button';

/** Gravador de mentira: o teste manda o áudio no lugar do microfone. */
interface GravadorFake {
  state: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start: () => void;
  stop: () => void;
}

let gravadorAtual: GravadorFake | null = null;
/** Tamanho do "áudio" gravado — abaixo do mínimo o componente nem sobe. */
let tamanhoDoPedaco = 5000;

function criarGravadorFake(): GravadorFake {
  const g: GravadorFake = {
    state: 'inactive',
    ondataavailable: null,
    onstop: null,
    start: () => { g.state = 'recording'; },
    stop: () => {
      g.state = 'inactive';
      g.ondataavailable?.({ data: new Blob([new Uint8Array(tamanhoDoPedaco)], { type: 'audio/webm' }) });
      g.onstop?.();
    },
  };
  gravadorAtual = g;
  return g;
}

// `new` sobre uma função que devolve objeto entrega o objeto — é o suficiente
// para o componente, que só usa start/stop e os dois callbacks.
const MediaRecorderFake = function MediaRecorderFake() { return criarGravadorFake(); } as unknown as {
  new (...args: unknown[]): GravadorFake;
  isTypeSupported: (tipo: string) => boolean;
};
MediaRecorderFake.isTypeSupported = () => true;

const pararTrack = vi.fn();

function fingirMicrofone(erro?: Error) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        if (erro) throw erro;
        return { getTracks: () => [{ stop: pararTrack }] };
      }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  gravadorAtual = null;
  tamanhoDoPedaco = 5000;
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = MediaRecorderFake;
  fingirMicrofone();
});

async function ditarEParar() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button'));
  await waitFor(() => expect(gravadorAtual).not.toBeNull());
  await user.click(screen.getByRole('button'));
}

/** Corpo enviado à edge function na primeira chamada. */
function corpoDoPedido(): Record<string, unknown> {
  const [, opcoes] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
  return opcoes.body;
}

describe('VoiceDictateButton', () => {
  it('pede transcrição COM limpeza e devolve o texto limpo ao campo', async () => {
    invoke.mockResolvedValue({ data: { success: true, transcription: 'Adicione um passo de envio de contrato.' }, error: null });
    const onResult = vi.fn();
    render(<VoiceDictateButton onResult={onResult} contexto="editar fluxo" />);

    await ditarEParar();

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0][0]).toBe('transcribe-team-audio');
    expect(corpoDoPedido().limpar).toBe(true);
    expect(corpoDoPedido().contexto).toBe('editar fluxo');
    expect(corpoDoPedido().audio_url).toBe('https://exemplo/ditados/a.webm');
    await waitFor(() => expect(onResult).toHaveBeenCalledWith('Adicione um passo de envio de contrato.'));
    // Microfone desligado ao parar — gravação esquecida ligada é vazamento.
    expect(pararTrack).toHaveBeenCalled();
  });

  it('limpeza falhou: entrega o texto assim mesmo e avisa que está cru', async () => {
    invoke.mockResolvedValue({
      data: { success: true, transcription: 'é... adiciona um passo aí', limpeza_falhou: '503 model overloaded' },
      error: null,
    });
    const onResult = vi.fn();
    render(<VoiceDictateButton onResult={onResult} />);

    await ditarEParar();

    await waitFor(() => expect(onResult).toHaveBeenCalledWith('é... adiciona um passo aí'));
    expect(toastAviso).toHaveBeenCalled();
  });

  it('transcrição vazia não escreve nada no campo', async () => {
    invoke.mockResolvedValue({ data: { success: false, error: 'inaudível' }, error: null });
    const onResult = vi.fn();
    render(<VoiceDictateButton onResult={onResult} />);

    await ditarEParar();

    await waitFor(() => expect(toastErro).toHaveBeenCalled());
    expect(onResult).not.toHaveBeenCalled();
  });

  it('clique sem fala não sobe arquivo nem chama a IA', async () => {
    tamanhoDoPedaco = 100; // abaixo do mínimo
    const onResult = vi.fn();
    render(<VoiceDictateButton onResult={onResult} />);

    await ditarEParar();

    expect(upload).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('microfone negado vira aviso, não tela quebrada', async () => {
    fingirMicrofone(new Error('NotAllowedError'));
    render(<VoiceDictateButton onResult={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole('button'));

    await waitFor(() => expect(toastErro).toHaveBeenCalled());
  });
});
