/**
 * Áudio automático no "Concluir + próxima".
 *
 * O áudio explicando a atividade era opt-in: um checkbox desmarcado, dentro de
 * um bloco que só aparece depois de escolher notificar. Medido em 14/09/2026:
 * 3.805 dos 4.706 elos de cadeia de 30 dias eram de lead COM grupo, e o
 * `elevenlabs-tts` gerou 3 arquivos em 90 dias. Ou seja: praticamente ninguém
 * marcava, e a equipe gravava o áudio na mão depois de mandar o texto, porque
 * boa parte dos clientes não lê a mensagem.
 *
 * Os invariantes cobertos aqui:
 *  1. com grupo, o áudio nasce marcado (e sem grupo, não);
 *  2. a prévia gera UMA vez e o envio manda exatamente o áudio ouvido —
 *     regerar custaria outra cobrança do ElevenLabs e mandaria ao cliente um
 *     áudio que ninguém conferiu;
 *  3. mudar o tom depois da prévia invalida o que foi ouvido;
 *  4. quem não tem voz própria selecionada é avisado ANTES de enviar — senão o
 *     cliente ouve uma voz de catálogo achando que é a do responsável.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { fakeClient, invocacoes, setVozResposta, resetMocks } = vi.hoisted(() => {
  const invocacoes: { fn: string; body: any }[] = [];
  const vozResposta: { atual: any } = { atual: { preference: null, custom_voices: [] } };

  const chain = (): any => new Proxy(function () {} as any, {
    get(_t, prop) {
      const p = Promise.resolve({ data: [], error: null });
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: null, error: null });
      return () => chain();
    },
    apply: () => chain(),
  });

  return {
    invocacoes,
    setVozResposta: (v: any) => { vozResposta.atual = v; },
    resetMocks: () => {
      invocacoes.length = 0;
      vozResposta.atual = { preference: null, custom_voices: [] };
    },
    fakeClient: {
      from: () => chain(),
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      },
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
    vozResposta,
  };
});

vi.mock('@/integrations/supabase/external-client', () => ({
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));
vi.mock('@/integrations/supabase', () => ({
  authClient: fakeClient,
  db: fakeClient,
  supabase: fakeClient,
  externalSupabase: fakeClient,
  ensureExternalSession: async () => {},
}));

/** Contador de chamadas por edge function — é aqui que "gerou duas vezes" aparece. */
let contadorAudio = 0;
vi.mock('@/lib/lovableCloudFunctions', () => ({
  cloudFunctions: {
    invoke: async (fn: string, opts?: any) => {
      invocacoes.push({ fn, body: opts?.body });
      if (fn === 'ai-text-editor') return { data: { result: 'Resumo falado da atividade.' }, error: null };
      if (fn === 'elevenlabs-tts') {
        contadorAudio += 1;
        return { data: { audio_url: `https://audio/${contadorAudio}.mp3`, voice_name: 'João Manoel', voice_type: 'cloned' }, error: null };
      }
      if (fn === 'elevenlabs-voice-clone') {
        const resposta = (globalThis as any).__voz ?? { preference: null, custom_voices: [] };
        return { data: resposta, error: null };
      }
      return { data: null, error: null };
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { CompleteAndNotifyDialog } from '../CompleteAndNotifyDialog';

/** O que o dialog entrega a quem conclui — é o contrato que estes testes cobram. */
type NotifyOptions = Parameters<React.ComponentProps<typeof CompleteAndNotifyDialog>['onConfirm']>[0];

const GRUPO = {
  id: 'g-1',
  label: 'PREV 77 - Grupo do Cliente',
  group_jid: '120363000000000000@g.us',
  group_name: 'PREV 77',
};

const MENSAGEM = 'Atividade concluída: petição protocolada em 12/09.';

/** jsdom não toca áudio: basta registrar que o play foi pedido. */
class AudioFake {
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
}

const renderDialog = (over: Partial<React.ComponentProps<typeof CompleteAndNotifyDialog>> = {}) => {
  const onConfirm = vi.fn(async (_options?: NotifyOptions) => {});
  render(
    <CompleteAndNotifyDialog
      open
      onClose={() => {}}
      onConfirm={onConfirm}
      leadId="lead-1"
      buildMsg={() => MENSAGEM}
      preloadedGroups={[GRUPO]}
      {...over}
    />,
  );
  return onConfirm;
};

beforeEach(() => {
  resetMocks();
  contadorAudio = 0;
  (globalThis as any).__voz = { preference: null, custom_voices: [] };
  (globalThis as any).Audio = AudioFake as any;
});

describe('áudio vem marcado por padrão', () => {
  it('lead COM grupo: o checkbox de áudio já nasce ligado', async () => {
    renderDialog();
    const checkbox = await screen.findByRole('checkbox', { name: /Enviar áudio junto/i });
    expect(checkbox).toBeChecked();
  });

  it('lead SEM grupo: não oferece nem liga áudio', async () => {
    renderDialog({ preloadedGroups: [] });
    await screen.findByText('(nenhum grupo vinculado)');
    expect(screen.queryByRole('checkbox', { name: /Enviar áudio junto/i })).not.toBeInTheDocument();
  });

  it('desmarcar continua possível, e aí nada de áudio vai junto', async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(await screen.findByRole('checkbox', { name: /Enviar áudio junto/i }));
    await user.click(screen.getByRole('button', { name: /Concluir e Notificar/i }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ sendAudio: false });
    expect(invocacoes.some(i => i.fn === 'elevenlabs-tts')).toBe(false);
  });
});

describe('prévia é o áudio que vai ao grupo', () => {
  it('ouvir e confirmar gera UMA vez, e manda o mesmo MP3 ouvido', async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(await screen.findByRole('button', { name: /Ouvir prévia/i }));
    await waitFor(() => expect(contadorAudio).toBe(1));
    expect(await screen.findByText(/é este áudio que vai ao grupo/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Concluir e Notificar/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());

    // O invariante: nenhuma segunda geração, e a URL é a mesma da prévia.
    expect(contadorAudio).toBe(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      sendAudio: true,
      audioUrl: 'https://audio/1.mp3',
      audioText: 'Resumo falado da atividade.',
    });
  });

  it('sem prévia, o confirmar manda só o texto e deixa o MP3 para o envio', async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(await screen.findByRole('button', { name: /Concluir e Notificar/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());

    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      sendAudio: true,
      audioText: 'Resumo falado da atividade.',
      audioUrl: undefined,
    });
    expect(contadorAudio).toBe(0);
  });
});

describe('voz de quem apertou', () => {
  it('sem preferência gravada, avisa que a voz não é a da pessoa', async () => {
    renderDialog();
    expect(
      await screen.findByText(/você ainda não tem voz própria/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Criar minha voz/i })).toBeInTheDocument();
  });

  it('voz clonada pronta mas não selecionada: oferece o clique que faltava', async () => {
    (globalThis as any).__voz = {
      preference: null,
      custom_voices: [{ id: 'cv1', name: 'João Pedro', elevenlabs_voice_id: 'el-1', status: 'ready' }],
    };
    renderDialog();

    expect(await screen.findByText(/não está selecionada/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Usar minha voz/i })).toBeInTheDocument();
  });

  it('com voz clonada selecionada, mostra de quem é a voz e não alerta nada', async () => {
    (globalThis as any).__voz = {
      preference: { voice_id: 'el-1', voice_name: 'João Manoel', voice_type: 'cloned' },
      custom_voices: [{ id: 'cv1', name: 'João Manoel', elevenlabs_voice_id: 'el-1', status: 'ready' }],
    };
    renderDialog();

    expect(await screen.findByText(/sua voz: João Manoel/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Criar minha voz/i })).not.toBeInTheDocument();
  });
});
