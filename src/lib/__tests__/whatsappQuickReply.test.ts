import { describe, expect, it } from 'vitest';
import {
  escolherInstanciaDeGrupo,
  pendenciaDaConversa,
  textoIdentificado,
  transcricaoDaConversa,
  tratamentoPadrao,
  type MensagemDaConversa,
} from '@/lib/whatsappQuickReply';

const msg = (over: Partial<MensagemDaConversa>): MensagemDaConversa => ({
  direction: 'inbound',
  message_text: 'oi',
  instance_name: null,
  created_at: '2026-08-25T10:00:00.000Z',
  ...over,
});

describe('textoIdentificado', () => {
  const perfil = { full_name: 'Raym Sandresson Prudêncio', treatment_title: null, gender: 'male' };

  it('assina com primeiro e último nome mais o tratamento', () => {
    expect(
      textoIdentificado('Bom dia!', { identificar: true, formatoDoNome: 'first_last', tratamento: 'Dr.', apelido: '' }, perfil)
    ).toBe('*Dr. Raym Prudêncio:*\nBom dia!');
  });

  it('sem tratamento escolhido, assina só o nome', () => {
    expect(
      textoIdentificado('Bom dia!', { identificar: true, formatoDoNome: 'first', tratamento: '', apelido: '' }, perfil)
    ).toBe('*Raym:*\nBom dia!');
  });

  it('apelido ignora tratamento e nome do perfil', () => {
    expect(
      textoIdentificado('Bom dia!', { identificar: true, formatoDoNome: 'nickname', tratamento: 'Dr.', apelido: 'Atendimento' }, perfil)
    ).toBe('*Atendimento:*\nBom dia!');
  });

  it('identificação desligada manda o texto cru', () => {
    expect(
      textoIdentificado('Bom dia!', { identificar: false, formatoDoNome: 'first_last', tratamento: 'Dr.', apelido: '' }, perfil)
    ).toBe('Bom dia!');
  });

  it('sem perfil carregado não inventa assinatura', () => {
    expect(
      textoIdentificado('Bom dia!', { identificar: true, formatoDoNome: 'first_last', tratamento: 'Dr.', apelido: '' }, null)
    ).toBe('Bom dia!');
  });
});

describe('tratamentoPadrao', () => {
  it('respeita o que está no perfil antes do gênero', () => {
    expect(tratamentoPadrao({ treatment_title: 'Prof.', gender: 'female' })).toBe('Prof.');
  });

  it('cai no gênero quando o perfil não tem tratamento', () => {
    expect(tratamentoPadrao({ gender: 'female' })).toBe('Dra.');
    expect(tratamentoPadrao({ gender: 'male' })).toBe('Dr.');
    expect(tratamentoPadrao({})).toBe('');
  });
});

describe('escolherInstanciaDeGrupo', () => {
  it('prefere a instância de atendimento, mesmo com espelho mais novo de outra', () => {
    const escolha = escolherInstanciaDeGrupo([
      msg({ instance_name: 'Atendimento Previdenciário', created_at: '2026-08-24T10:00:00.000Z' }),
      msg({ instance_name: 'Raym', created_at: '2026-08-25T10:00:00.000Z' }),
    ]);
    expect(escolha).toBe('Atendimento Previdenciário');
  });

  it('descarta a de atendimento que parou de espelhar há mais de 7 dias', () => {
    const escolha = escolherInstanciaDeGrupo([
      msg({ instance_name: 'Atendimento Previdenciário', created_at: '2026-08-01T10:00:00.000Z' }),
      msg({ instance_name: 'Raym', created_at: '2026-08-25T10:00:00.000Z' }),
    ]);
    expect(escolha).toBe('Raym');
  });

  it('sem instância no histórico não escolhe nada', () => {
    expect(escolherInstanciaDeGrupo([msg({})])).toBeUndefined();
  });
});

describe('transcricaoDaConversa e pendenciaDaConversa', () => {
  const conversa = [
    msg({ direction: 'inbound', message_text: 'Bom dia, deu indeferido?' }),
    msg({ direction: 'outbound', message_text: 'Bom dia! Vamos recorrer.' }),
    msg({ direction: 'inbound', message_text: 'Preciso ir na perícia mesmo assim?' }),
  ];

  it('monta a transcrição com o nome do contato', () => {
    expect(transcricaoDaConversa(conversa, 'Derci')).toBe(
      'Derci: Bom dia, deu indeferido?\nEu: Bom dia! Vamos recorrer.\nDerci: Preciso ir na perícia mesmo assim?'
    );
  });

  it('fala espelhada pelas instâncias do grupo entra uma vez só', () => {
    const espelhada = [
      msg({ direction: 'inbound', message_text: 'Bom dia!', instance_name: 'Raym' }),
      msg({ direction: 'inbound', message_text: 'Bom dia!', instance_name: 'Atendimento Previdenciário' }),
      msg({ direction: 'inbound', message_text: 'Bom dia!', instance_name: 'Luiz Abraci' }),
    ];
    expect(transcricaoDaConversa(espelhada, 'Derci')).toBe('Derci: Bom dia!');
  });

  it('acha a pendência e as âncoras das duas pontas', () => {
    expect(pendenciaDaConversa(conversa)).toEqual({
      pending: true,
      lastOutboundText: 'Bom dia! Vamos recorrer.',
      lastClientText: 'Preciso ir na perícia mesmo assim?',
    });
  });

  it('última fala minha = nada pendente', () => {
    expect(pendenciaDaConversa([...conversa, msg({ direction: 'outbound', message_text: 'Sim, precisa.' })]).pending).toBe(false);
  });
});
