import { describe, it, expect } from 'vitest';
import { mesclarPerfilDeEnvio } from '../ActivityFormCompact';

/**
 * Incidente 11/09/2026: o telefone do João foi trocado na ficha do membro (que
 * lê e grava o Cloud), o espelho no Externo ficou parado em 21/07/2026 com o
 * número desativado, e o envio da atividade usou o número do Externo —
 * "the number 55869815XXXXX@s.whatsapp.net is not on WhatsApp".
 */
describe('mesclarPerfilDeEnvio', () => {
  it('usa o telefone do Cloud quando os dois bancos divergem', () => {
    const r = mesclarPerfilDeEnvio(
      { phone: '5586998316965', full_name: 'João', default_instance_id: null },
      { phone: '5586981595991', full_name: 'João', default_instance_id: null },
    );
    expect(r.phone).toBe('5586998316965');
  });

  it('cai no telefone do Externo quando o Cloud está vazio', () => {
    expect(mesclarPerfilDeEnvio({ phone: null }, { phone: '5586981595991' }).phone)
      .toBe('5586981595991');
  });

  it('mantém o Externo mandando na instância padrão', () => {
    const r = mesclarPerfilDeEnvio(
      { default_instance_id: 'inst-cloud' },
      { default_instance_id: 'inst-externo' },
    );
    expect(r.default_instance_id).toBe('inst-externo');
  });

  it('usa a instância do Cloud quando o Externo não tem', () => {
    expect(mesclarPerfilDeEnvio({ default_instance_id: 'inst-cloud' }, { default_instance_id: null }).default_instance_id)
      .toBe('inst-cloud');
  });

  it('devolve null (e não undefined) quando nenhum banco tem o campo', () => {
    expect(mesclarPerfilDeEnvio(undefined, undefined))
      .toEqual({ full_name: null, phone: null, default_instance_id: null });
  });
});
