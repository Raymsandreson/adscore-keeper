import { describe, it, expect } from 'vitest';
import { idDaMensagemNoWhatsApp } from '@/hooks/useAutoriaDasMensagens';

describe('idDaMensagemNoWhatsApp', () => {
  it('tira o dono do id da UazAPI', () => {
    expect(idDaMensagemNoWhatsApp('558694000545:3EB038735A06DAD3F89D4E'))
      .toBe('3EB038735A06DAD3F89D4E');
  });

  it('a mesma mensagem registrada por instâncias diferentes dá a mesma chave', () => {
    // Foi isto que quebrou o casamento em produção: num grupo, cada instância
    // grava a mesma mensagem com o seu próprio prefixo.
    const a = idDaMensagemNoWhatsApp('558695590127:3EB038735A06DAD3F89D4E');
    const b = idDaMensagemNoWhatsApp('558688054381:3EB038735A06DAD3F89D4E');
    expect(a).toBe(b);
  });

  it('id sem dono passa inteiro (Cloud API da Meta manda wamid puro)', () => {
    expect(idDaMensagemNoWhatsApp('wamid.HBgNNTU4OD')).toBe('wamid.HBgNNTU4OD');
  });

  it('vazio, nulo ou indefinido viram string vazia — nunca casam com nada', () => {
    expect(idDaMensagemNoWhatsApp('')).toBe('');
    expect(idDaMensagemNoWhatsApp(null)).toBe('');
    expect(idDaMensagemNoWhatsApp(undefined)).toBe('');
    expect(idDaMensagemNoWhatsApp('   ')).toBe('');
  });
});
