/**
 * Ativar o agente pela tela dispara a 1ª mensagem proativa.
 *
 * O que este teste protege é o barulho: religar o mesmo agente e agente sem
 * proativa ligada são a rotina — não podem virar aviso vermelho em cima do
 * "Agente ativado". Falha de verdade (envio recusado, IA fora do ar), sim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('@/lib/lovableCloudFunctions', () => ({ cloudFunctions: { invoke } }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { dispararPrimeiraMensagemProativa } from '@/lib/agentePrimeiraMensagem';

const alvo = { phone: '558698316965', instanceName: 'Raym', agentId: 'ag-1', agentName: 'Proc.BPC' };

beforeEach(() => {
  invoke.mockReset();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

describe('dispararPrimeiraMensagemProativa', () => {
  it('avisa quando o agente abriu a conversa', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: true, text: 'Oi, Danilo!' }, error: null });

    await dispararPrimeiraMensagemProativa(alvo);

    expect(invoke).toHaveBeenCalledWith('agent-proactive-first-message', {
      body: { phone: alvo.phone, instance_name: 'Raym', agent_id: 'ag-1' },
    });
    expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining('Proc.BPC'));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('cala a boca quando o agente não tem proativa ligada', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: false, reason: 'proativa desligada neste agente' }, error: null });

    await dispararPrimeiraMensagemProativa(alvo);

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('cala a boca quando a mensagem já tinha saído nesta conversa', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: false, reason: 'já enviada nesta conversa' }, error: null });

    await dispararPrimeiraMensagemProativa(alvo);

    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('mostra a falha quando o envio foi recusado', async () => {
    invoke.mockResolvedValue({ data: { success: true, sent: false, reason: 'o WhatsApp recusou o envio' }, error: null });

    await dispararPrimeiraMensagemProativa(alvo);

    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('recusou'));
  });

  it('erro de rede não desfaz a ativação, só avisa', async () => {
    invoke.mockRejectedValue(new Error('offline'));

    await dispararPrimeiraMensagemProativa(alvo);

    expect(toastMock.error).toHaveBeenCalledWith('Agente ativado, mas a 1ª mensagem não saiu');
  });

  it('sem instância na conversa não chama nada', async () => {
    await dispararPrimeiraMensagemProativa({ ...alvo, instanceName: null });

    expect(invoke).not.toHaveBeenCalled();
  });
});
