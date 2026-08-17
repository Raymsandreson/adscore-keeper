/**
 * O patch de conteúdo da mãe no "Concluir + próxima".
 *
 * Invariantes cobertos:
 *  1. campo digitado entra no patch;
 *  2. campo igual ao banco não entra (nada de UPDATE à toa);
 *  3. campo vazio NUNCA apaga texto que existe na mãe — inclusive quando o
 *     "vazio" é HTML de caixa limpa (`<p><br></p>`);
 *  4. nenhuma data e nenhum título entram no patch, mesmo se forem passados;
 *  5. sem mudança nenhuma, devolve `{}` e quem chama pula o UPDATE.
 */
import { describe, it, expect } from 'vitest';
import { buildMotherContentPatch, MOTHER_TEXT_COLUMNS } from '../activityChainMother';

describe('buildMotherContentPatch', () => {
  it('texto novo digitado na ficha vai para a mãe', () => {
    const patch = buildMotherContentPatch(
      { what_was_done: '<p>Peticionei a manifestação</p>', next_steps: '<p>Aguardar juntada</p>' },
      { what_was_done: null, next_steps: null },
    );
    expect(patch).toEqual({
      what_was_done: '<p>Peticionei a manifestação</p>',
      next_steps: '<p>Aguardar juntada</p>',
    });
  });

  it('texto igual ao gravado não entra no patch', () => {
    const igual = '<p>Mesma coisa</p>';
    expect(buildMotherContentPatch({ what_was_done: igual }, { what_was_done: igual })).toEqual({});
  });

  it('texto editado substitui o da mãe', () => {
    const patch = buildMotherContentPatch(
      { current_status_notes: '<p>Versão nova</p>' },
      { current_status_notes: '<p>Versão velha</p>' },
    );
    expect(patch).toEqual({ current_status_notes: '<p>Versão nova</p>' });
  });

  it('formulário vazio não apaga o que a mãe tem — nem string vazia, nem HTML de caixa limpa', () => {
    const saved = { what_was_done: '<p>Relato que existe</p>', notes: 'nota antiga' };
    expect(buildMotherContentPatch({ what_was_done: '', notes: null }, saved)).toEqual({});
    expect(buildMotherContentPatch({ what_was_done: '<p><br></p>', notes: '<p></p>' }, saved)).toEqual({});
  });

  it('campo vazio nos dois lados não vira patch (null vs string vazia)', () => {
    expect(buildMotherContentPatch({ solicitacao: '' }, { solicitacao: null })).toEqual({});
    expect(buildMotherContentPatch({ resposta_juizo: null }, { resposta_juizo: '' })).toEqual({});
  });

  it('só os 6 campos de texto: data, título e responsável nunca entram', () => {
    const patch = buildMotherContentPatch(
      {
        what_was_done: '<p>Feito</p>',
        // Campos que a filha leva e a mãe não pode receber:
        deadline: '2026-08-25',
        notification_date: '2026-08-25',
        callback_at: '2026-08-25T12:00:00.000Z',
        title: 'Assunto da PRÓXIMA etapa',
        assigned_to: 'outra-pessoa',
      } as never,
      { what_was_done: null } as never,
    );
    expect(Object.keys(patch)).toEqual(['what_was_done']);
    expect(Object.keys(patch).every((k) => (MOTHER_TEXT_COLUMNS as readonly string[]).includes(k))).toBe(true);
  });

  it('nada mudou: patch vazio', () => {
    const atual = {
      what_was_done: '<p>a</p>',
      current_status_notes: '<p>b</p>',
      next_steps: '<p>c</p>',
      notes: 'd',
      solicitacao: '<p>e</p>',
      resposta_juizo: '<p>f</p>',
    };
    expect(buildMotherContentPatch(atual, atual)).toEqual({});
  });
});
