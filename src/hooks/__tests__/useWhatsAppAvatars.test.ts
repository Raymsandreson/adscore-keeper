/**
 * A chave do cache da foto tem que ser a MESMA na ida e na volta.
 *
 * Até 27/08/2026 não era: o lote gravava `Raym|55…` (nome cru da instância) e a
 * tela lia `raym|55…`. Como toda conversa da aba do WhatsApp tem instância com
 * maiúscula, nenhuma foto aparecia lá — e o telefone ficava presoem `inFlight`,
 * então a página nem tentava de novo. Ficha do lead e contatos escapavam só
 * porque mandam a instância vazia.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const invoke = vi.fn();
vi.mock('@/lib/functionRouter', () => ({
  cloudFunctions: { invoke: (...args: unknown[]) => invoke(...args) },
}));

import { useWhatsAppAvatars, __resetAvatarCacheForTests, avatarKey } from '@/hooks/useWhatsAppAvatars';

const FOTO = 'https://kmedldlepwiityjsdahz.supabase.co/storage/v1/object/sign/wa-avatars/x.webp?token=abc';
const TEL = '5581842941699';

describe('useWhatsAppAvatars', () => {
  beforeEach(() => {
    __resetAvatarCacheForTests();
    invoke.mockReset();
  });

  it('instância com maiúscula: a foto que voltou é a que a tela lê', async () => {
    invoke.mockResolvedValue({ data: { success: true, avatars: { [TEL]: FOTO } }, error: null });
    const { result } = renderHook(() => useWhatsAppAvatars());

    act(() => { result.current.requestAvatar(TEL, 'Atendimento Previdenciário'); });

    await waitFor(() => expect(result.current.getAvatar(TEL, 'Atendimento Previdenciário')).toBe(FOTO));
    // O servidor recebe o nome como está — quem normaliza é só o cache.
    expect(invoke).toHaveBeenCalledWith('get-whatsapp-avatars', {
      body: { instance_name: 'Atendimento Previdenciário', phones: [TEL] },
    });
  });

  it('a mesma foto serve para quem pergunta com outra caixa no nome da instância', async () => {
    invoke.mockResolvedValue({ data: { success: true, avatars: { [TEL]: FOTO } }, error: null });
    const { result } = renderHook(() => useWhatsAppAvatars());

    act(() => { result.current.requestAvatar(TEL, 'Raym'); });
    await waitFor(() => expect(result.current.getAvatar(TEL, 'raym')).toBe(FOTO));
    expect(avatarKey(TEL, 'Raym')).toBe(avatarKey(TEL, ' raym '));
  });

  it('com a foto em cache, não pergunta de novo', async () => {
    invoke.mockResolvedValue({ data: { success: true, avatars: { [TEL]: FOTO } }, error: null });
    const { result } = renderHook(() => useWhatsAppAvatars());

    act(() => { result.current.requestAvatar(TEL, 'Raym'); });
    await waitFor(() => expect(result.current.getAvatar(TEL, 'Raym')).toBe(FOTO));
    act(() => { result.current.requestAvatar(TEL, 'Raym'); });
    await new Promise(r => setTimeout(r, 250));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('a foto sobrevive ao recarregar a página (localStorage)', async () => {
    invoke.mockResolvedValue({ data: { success: true, avatars: { [TEL]: FOTO } }, error: null });
    const primeira = renderHook(() => useWhatsAppAvatars());
    act(() => { primeira.result.current.requestAvatar(TEL, 'Raym'); });
    await waitFor(() => expect(primeira.result.current.getAvatar(TEL, 'Raym')).toBe(FOTO));

    // A gravação no storage tem meio segundo de espera para não escrever a cada foto.
    await waitFor(() => expect(localStorage.getItem('wa_avatars_v2')).toContain(FOTO), { timeout: 2000 });

    // Simula recarregar: memória zerada, localStorage intacto.
    const guardado = localStorage.getItem('wa_avatars_v2');
    __resetAvatarCacheForTests();
    localStorage.setItem('wa_avatars_v2', guardado!);
    invoke.mockReset();

    const segunda = renderHook(() => useWhatsAppAvatars());
    await waitFor(() => expect(segunda.result.current.getAvatar(TEL, 'Raym')).toBe(FOTO));
    expect(invoke).not.toHaveBeenCalled();
  });
});
