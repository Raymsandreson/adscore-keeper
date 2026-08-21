import { describe, it, expect } from 'vitest';
// O classificador vive na pasta da edge (é lá que roda), mas é módulo puro —
// mesmo caso do emailPushParser: o teste importa direto, sem cópia.
import { classifyUpdate, classifyUpdates } from '../../../supabase/functions/_shared/processUpdateClassifier';

type Mov = Parameters<typeof classifyUpdate>[0];
const mov = (conteudo: string, data = '2026-06-12'): Mov =>
  ({ conteudo, data } as unknown as Mov);

describe('classifyUpdate — conclusão não é decisão', () => {
  /**
   * O caso que abriu o assunto: 0000375-74.2026.5.08.0120. O card do sino dizia
   * "Decisão de mérito" porque a frase tem a palavra "sentença" — só que ela
   * está no pedido de conclusão, e a sentença de verdade só veio em 27/07/2026.
   */
  it('"Conclusos os autos para julgamento Proferir sentença" é despacho', () => {
    const u = classifyUpdate(mov('Conclusos os autos para julgamento Proferir sentença a UBIRAJARA SOUZA FONTENELE JUNIOR'));
    expect(u.categoria).toBe('despacho');
  });

  it('no push agrupado, a conclusão não contamina os outros eventos', () => {
    const u = classifyUpdate(mov(
      'Conclusos os autos para julgamento Proferir sentença a UBIRAJARA SOUZA FONTENELE JUNIOR'
      + ' · Audiência de instrução (rito sumaríssimo) por videoconferência cancelada'
      + ' · Sala Principal - 2ª VARA DO TRABALHO DE ANANINDEUA',
    ));
    expect(u.categoria).toBe('audiencia');
  });

  it('sentença que aconteceu continua sendo decisão de mérito', () => {
    expect(classifyUpdate(mov('Julgados improcedentes os pedidos')).categoria).toBe('decisao_merito');
    expect(classifyUpdate(mov('Juntada de sentença de mérito')).categoria).toBe('decisao_merito');
    expect(classifyUpdate(mov('Trânsito em julgado registrado')).categoria).toBe('decisao_merito');
  });

  it('conclusão que já traz o julgamento na mesma linha continua mérito', () => {
    const u = classifyUpdate(mov('Conclusos os autos, julgo improcedentes os pedidos'));
    expect(u.categoria).toBe('decisao_merito');
  });
});

describe('classifyUpdate — categoria que já veio pronta', () => {
  /**
   * O push do INSS manda o status em campo próprio ("...alterado para
   * Exigência"). A cascata por palavra-chave leria "requerimento ... INSS" e
   * chutaria 'movimentacao'; com a categoria forçada não há chute.
   */
  it('categoria_forcada vence a cascata de palavras', () => {
    const u = classifyUpdate({
      conteudo: 'Status do requerimento 2082987386 alterado para Exigência (INSS)',
      data: '2026-08-19',
      categoria_forcada: 'prazo',
    } as unknown as Mov);
    expect(u.categoria).toBe('prazo');
  });

  it('sem ela, nada muda para quem vem de tribunal', () => {
    expect(classifyUpdate(mov('Expedida intimação ao autor')).categoria).toBe('prazo');
  });
});

describe('classifyUpdates — janela e dedupe', () => {
  it('corta o que é anterior a `desde` e dedupa o repetido', () => {
    const out = classifyUpdates(
      [mov('Conclusos os autos para julgamento', '2026-06-12'),
        mov('Conclusos os autos para julgamento', '2026-06-12'),
        mov('Expedida intimação', '2026-01-02')],
      { numeroCnj: '0000375-74.2026.5.08.0120', desde: '2026-06-01' },
    );
    expect(out).toHaveLength(1);
    expect(out[0].data_movimentacao).toBe('2026-06-12');
  });
});
