/**
 * Busca da procuração que vai ao cliente para assinar à mão.
 *
 * O que estes testes protegem é a regra que nasceu de uma medição: casar
 * procuração com requerimento por SEMELHANÇA de nome entregava o documento de
 * outra pessoa. O título do grupo ("✅ PREV 1129 GABRIELY - BENTO") carrega
 * também o nome do acolhedor, e o casamento por pedaço de nome mandava a
 * procuração de uma funcionária para 9 clientes — com o CPF e o endereço dela
 * indo ao INSS. Aqui só passa nome IDÊNTICO.
 *
 * O segundo caso é o da procuração de menor, que é lavrada assim:
 * "OUTORGANTE: BENTO DA SILVA EMILIANO, MENOR, NESTE ATO REPRESENTADO POR SUA
 * GENITORA GABRIELY DA SILVA". O requerimento do INSS pode estar no nome da
 * criança (outorgante) ou no da mãe (representante) — os dois casam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeClient, setDocs, resetTudo } = vi.hoisted(() => {
  let docs: unknown[] = [];
  // O proxy ignora os filtros e devolve sempre as mesmas linhas: o que está sob
  // teste é a conferência exata em JS, feita depois da query.
  const chain = (): any => {
    const p: any = Promise.resolve({ data: docs, error: null });
    return new Proxy(function () {} as any, {
      get(_t, prop) {
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        return () => chain();
      },
      apply: () => chain(),
    });
  };
  return {
    resetTudo: () => { docs = []; },
    setDocs: (linhas: unknown[]) => { docs = linhas; },
    fakeClient: { from: () => chain() },
  };
});

vi.mock('../../../railway-server/src/lib/supabase', () => ({ supabase: fakeClient }));

import { buscarProcuracaoDoCliente } from '../../../railway-server/src/lib/inss-procuracao';

const doc = (over: Record<string, unknown> = {}) => ({
  doc_token: 'tok-1',
  lead_id: null,
  outorgante_name: null,
  outorgante_cpf: null,
  signer_name: null,
  representante_name: null,
  original_file_url: 'https://zapsign.s3.amazonaws.com/x.pdf',
  document_name: 'PROCURAÇÃO.docx',
  template_name: null,
  tipo_documento: null,
  created_at: '2026-05-01T00:00:00Z',
  ...over,
});

beforeEach(resetTudo);

describe('buscarProcuracaoDoCliente — só nome idêntico', () => {
  it('acha pelo nome do outorgante', async () => {
    setDocs([doc({ outorgante_name: 'BENTO DA SILVA EMILIANO' })]);
    const r = await buscarProcuracaoDoCliente({ nomeSegurado: 'Bento da Silva Emiliano' });
    expect(r?.via).toBe('nome do segurado');
  });

  it('acha pelo nome da mãe quando o requerimento está no nome dela', async () => {
    // Documento da criança, mas o requerimento saiu no nome da representante.
    setDocs([doc({
      outorgante_name: 'BENTO DA SILVA EMILIANO',
      representante_name: 'GABRIELY DA SILVA',
    })]);
    const r = await buscarProcuracaoDoCliente({ nomeSegurado: 'Gabriely da Silva' });
    expect(r?.via).toBe('nome do representante');
  });

  it('prefere o outorgante quando os dois caminhos existem', async () => {
    setDocs([
      doc({ doc_token: 'da-crianca', outorgante_name: 'BENTO DA SILVA EMILIANO' }),
      doc({ doc_token: 'da-mae', representante_name: 'BENTO DA SILVA EMILIANO' }),
    ]);
    const r = await buscarProcuracaoDoCliente({ nomeSegurado: 'BENTO DA SILVA EMILIANO' });
    expect(r?.docToken).toBe('da-crianca');
  });

  it('ignora acento e caixa, mas não aceita nome parecido', async () => {
    setDocs([doc({ outorgante_name: 'THAYRA LAÍS DE JESUS' })]);
    expect((await buscarProcuracaoDoCliente({ nomeSegurado: 'thayra lais de jesus' }))?.via)
      .toBe('nome do segurado');
    // Este é o bug que a medição pegou: pedaço de nome NÃO pode casar.
    expect(await buscarProcuracaoDoCliente({ nomeSegurado: 'THAYRA LAIS' })).toBeNull();
    expect(await buscarProcuracaoDoCliente({ nomeSegurado: 'THAYRA LAIS DE JESUS SOUSA' })).toBeNull();
  });

  it('não devolve documento que sabidamente não é procuração', async () => {
    setDocs([doc({ outorgante_name: 'FABIANO AZEVEDO', tipo_documento: 'cessao_credito' })]);
    expect(await buscarProcuracaoDoCliente({ nomeSegurado: 'Fabiano Azevedo' })).toBeNull();
  });

  it('aceita documento sem tipo classificado', async () => {
    // 1.972 dos 3.333 documentos nunca foram classificados e se chamam
    // "NOME DO CLIENTE.BPC LOAS.docx" — exigir a palavra "procuração" no nome
    // descartaria procuração boa.
    setDocs([doc({ outorgante_name: 'FABIANO AZEVEDO', tipo_documento: null, document_name: 'FABIANO AZEVEDO.BPC LOAS.docx' })]);
    expect((await buscarProcuracaoDoCliente({ nomeSegurado: 'Fabiano Azevedo' }))?.via)
      .toBe('nome do segurado');
  });

  it('entre duas procurações da mesma pessoa, manda a mais recente', async () => {
    setDocs([
      doc({ doc_token: 'velha', outorgante_name: 'ILDEANE REIS', created_at: '2026-02-22T00:00:00Z' }),
      doc({ doc_token: 'nova',  outorgante_name: 'ILDEANE REIS', created_at: '2026-08-19T00:00:00Z' }),
    ]);
    expect((await buscarProcuracaoDoCliente({ nomeSegurado: 'Ildeane Reis' }))?.docToken).toBe('nova');
  });

  it('devolve null quando não há chave exata', async () => {
    setDocs([doc({ outorgante_name: 'BRENDA KAROLYNE' })]);
    // Era o falso positivo real: "KAROLYNE" é a acolhedora no título do grupo.
    expect(await buscarProcuracaoDoCliente({ nomeSegurado: 'HELOISA HELENA OLIVEIRA SANTOS' })).toBeNull();
  });

  it('não busca por nome curto demais', async () => {
    setDocs([doc({ outorgante_name: 'ANA' })]);
    expect(await buscarProcuracaoDoCliente({ nomeSegurado: 'ANA' })).toBeNull();
  });
});
