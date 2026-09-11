import { describe, it, expect } from 'vitest';
import {
  calcularLimitesPorVinculo,
  resolverCliente,
  resolverGrupo,
  MAPA_VAZIO,
  type MapaDeVinculos,
} from '../limitesPorVinculo';

const JID_A = '5521982930722-1446775117@g.us';
const JID_B = '5521999999999-1111111111@g.us';

function mapa(parcial: Partial<MapaDeVinculos> = {}): MapaDeVinculos {
  return { ...MAPA_VAZIO, ...parcial };
}

const categoriaGrupo = {
  id: 'cat-grupo',
  name: 'Diligência',
  max_limit_per_unit: 1000,
  limit_unit: 'per_whatsapp_group',
};

const categoriaCliente = {
  id: 'cat-cliente',
  name: 'Viagem',
  max_limit_per_unit: 500,
  limit_unit: 'per_client',
};

describe('resolverGrupo', () => {
  it('usa o grupo escolhido na despesa antes de deduzir', () => {
    const m = mapa({
      gruposPorLead: new Map([['lead-1', [{ group_jid: JID_B, group_name: 'Outro' }]]]),
      nomeDoGrupo: new Map([[JID_A, 'CASO 337']]),
    });
    const r = resolverGrupo(
      { transaction_id: 't1', category_id: 'c', lead_id: 'lead-1', contact_id: null, group_jid: JID_A },
      m
    );
    expect(r).toMatchObject({ chave: JID_A, rotulo: 'CASO 337', origem: 'explicito' });
  });

  it('deduz quando o lead tem exatamente um grupo', () => {
    const m = mapa({
      gruposPorLead: new Map([['lead-1', [{ group_jid: JID_A, group_name: 'CASO 337' }]]]),
    });
    const r = resolverGrupo(
      { transaction_id: 't1', category_id: 'c', lead_id: 'lead-1', contact_id: null, group_jid: null },
      m
    );
    expect(r).toMatchObject({ chave: JID_A, rotulo: 'CASO 337', origem: 'deduzido' });
  });

  it('não chuta quando o lead tem dois grupos', () => {
    const m = mapa({
      gruposPorLead: new Map([
        [
          'lead-1',
          [
            { group_jid: JID_A, group_name: 'CASO 337' },
            { group_jid: JID_B, group_name: 'CASO 402' },
          ],
        ],
      ]),
    });
    const r = resolverGrupo(
      { transaction_id: 't1', category_id: 'c', lead_id: 'lead-1', contact_id: null, group_jid: null },
      m
    );
    expect(r).toEqual({ chave: null, motivo: 'lead-com-varios-grupos' });
  });

  it('o mesmo grupo repetido nas duas origens continua sendo um grupo só', () => {
    const m = mapa({
      gruposPorLead: new Map([
        [
          'lead-1',
          [
            { group_jid: JID_A, group_name: null },
            { group_jid: JID_A, group_name: 'CASO 337' },
          ],
        ],
      ]),
    });
    const r = resolverGrupo(
      { transaction_id: 't1', category_id: 'c', lead_id: 'lead-1', contact_id: null, group_jid: null },
      m
    );
    expect(r).toMatchObject({ chave: JID_A, rotulo: 'CASO 337' });
  });

  it('cai no grupo do contato quando o lead não tem grupo', () => {
    const m = mapa({
      contatoPorId: new Map([['ct-1', { full_name: 'Osvaldo', whatsapp_group_id: JID_B }]]),
      nomeDoGrupo: new Map([[JID_B, 'CASO 402']]),
    });
    const r = resolverGrupo(
      { transaction_id: 't1', category_id: 'c', lead_id: 'lead-1', contact_id: 'ct-1', group_jid: null },
      m
    );
    expect(r).toMatchObject({ chave: JID_B, rotulo: 'CASO 402', origem: 'deduzido' });
  });

  it('lead sem grupo nenhum vira pendência', () => {
    const r = resolverGrupo(
      { transaction_id: 't1', category_id: 'c', lead_id: 'lead-1', contact_id: null, group_jid: null },
      MAPA_VAZIO
    );
    expect(r).toEqual({ chave: null, motivo: 'lead-sem-grupo' });
  });

  it('despesa sem lead e sem contato vira pendência de vínculo', () => {
    const r = resolverGrupo(
      { transaction_id: 't1', category_id: 'c', lead_id: null, contact_id: null, group_jid: null },
      MAPA_VAZIO
    );
    expect(r).toEqual({ chave: null, motivo: 'sem-vinculo' });
  });
});

describe('resolverCliente', () => {
  it('usa o contato escolhido na despesa', () => {
    const m = mapa({
      contatoPorId: new Map([['ct-1', { full_name: 'Osvaldo', whatsapp_group_id: null }]]),
    });
    const r = resolverCliente(
      { transaction_id: 't1', category_id: 'c', lead_id: 'lead-1', contact_id: 'ct-1', group_jid: null },
      m
    );
    expect(r).toMatchObject({ chave: 'ct-1', rotulo: 'Osvaldo', origem: 'explicito' });
  });

  it('deduz o contato único do lead', () => {
    const m = mapa({
      contatosPorLead: new Map([['lead-1', [{ id: 'ct-9', full_name: 'Maria' }]]]),
    });
    const r = resolverCliente(
      { transaction_id: 't1', category_id: 'c', lead_id: 'lead-1', contact_id: null, group_jid: null },
      m
    );
    expect(r).toMatchObject({ chave: 'ct-9', rotulo: 'Maria', origem: 'deduzido' });
  });

  it('lead com dois contatos vira pendência em vez de chute', () => {
    const m = mapa({
      contatosPorLead: new Map([
        [
          'lead-1',
          [
            { id: 'ct-1', full_name: 'Maria' },
            { id: 'ct-2', full_name: 'Maria (2)' },
          ],
        ],
      ]),
    });
    const r = resolverCliente(
      { transaction_id: 't1', category_id: 'c', lead_id: 'lead-1', contact_id: null, group_jid: null },
      m
    );
    expect(r).toEqual({ chave: null, motivo: 'lead-com-varios-contatos' });
  });

  it('lead sem contato vira pendência', () => {
    const r = resolverCliente(
      { transaction_id: 't1', category_id: 'c', lead_id: 'lead-1', contact_id: null, group_jid: null },
      MAPA_VAZIO
    );
    expect(r).toEqual({ chave: null, motivo: 'lead-sem-contato' });
  });
});

describe('calcularLimitesPorVinculo', () => {
  const m = mapa({
    gruposPorLead: new Map([
      ['lead-1', [{ group_jid: JID_A, group_name: 'CASO 337' }]],
      ['lead-2', [{ group_jid: JID_B, group_name: 'CASO 402' }]],
    ]),
    contatosPorLead: new Map([
      ['lead-1', [{ id: 'ct-1', full_name: 'Osvaldo' }]],
      ['lead-2', [{ id: 'ct-2', full_name: 'Maria' }]],
    ]),
    contatoPorId: new Map([
      ['ct-1', { full_name: 'Osvaldo', whatsapp_group_id: JID_A }],
      ['ct-2', { full_name: 'Maria', whatsapp_group_id: JID_B }],
    ]),
  });

  const transacoes = [
    { id: 't1', amount: 600, transaction_date: '2026-09-01' },
    { id: 't2', amount: 700, transaction_date: '2026-09-02' },
    { id: 't3', amount: 300, transaction_date: '2026-09-03' },
  ];

  it('soma por grupo e acusa só quem passou do limite', () => {
    const overrides = [
      { transaction_id: 't1', category_id: 'cat-grupo', lead_id: 'lead-1', contact_id: null, group_jid: null },
      { transaction_id: 't2', category_id: 'cat-grupo', lead_id: 'lead-1', contact_id: null, group_jid: null },
      { transaction_id: 't3', category_id: 'cat-grupo', lead_id: 'lead-2', contact_id: null, group_jid: null },
    ];
    const r = calcularLimitesPorVinculo(transacoes, [categoriaGrupo], overrides, m);

    expect(r.totais).toHaveLength(2);
    expect(r.estouros).toHaveLength(1);
    expect(r.estouros[0]).toMatchObject({
      chave: JID_A,
      rotulo: 'CASO 337',
      totalGasto: 1300,
      limite: 1000,
      excedente: 300,
      transacoes: 2,
      temDeducao: true,
    });
  });

  it('valor negativo (estorno na base) conta pelo módulo, igual às unidades antigas', () => {
    const overrides = [
      { transaction_id: 't1', category_id: 'cat-grupo', lead_id: 'lead-1', contact_id: null, group_jid: null },
    ];
    const r = calcularLimitesPorVinculo(
      [{ id: 't1', amount: -600, transaction_date: '2026-09-01' }],
      [categoriaGrupo],
      overrides,
      m
    );
    expect(r.totais[0].totalGasto).toBe(600);
  });

  it('despesa que não resolve a chave vira pendência e NÃO some do relatório', () => {
    const overrides = [
      { transaction_id: 't1', category_id: 'cat-grupo', lead_id: 'lead-1', contact_id: null, group_jid: null },
      { transaction_id: 't2', category_id: 'cat-grupo', lead_id: 'lead-sem-nada', contact_id: null, group_jid: null },
      { transaction_id: 't3', category_id: 'cat-grupo', lead_id: null, contact_id: null, group_jid: null },
    ];
    const r = calcularLimitesPorVinculo(transacoes, [categoriaGrupo], overrides, m);

    expect(r.pendencias.map(p => p.motivo).sort()).toEqual(['lead-sem-grupo', 'sem-vinculo']);
    expect(r.pendencias.find(p => p.transactionId === 't2')).toMatchObject({ valor: 700 });
    // O total do grupo resolvido não foi inflado pelas pendências.
    expect(r.totais).toHaveLength(1);
    expect(r.totais[0].totalGasto).toBe(600);
  });

  it('por cliente soma os dois casos da mesma pessoa', () => {
    const mesmoCliente = mapa({
      contatosPorLead: new Map([
        ['lead-1', [{ id: 'ct-1', full_name: 'Osvaldo' }]],
        ['lead-2', [{ id: 'ct-1', full_name: 'Osvaldo' }]],
      ]),
      contatoPorId: new Map([['ct-1', { full_name: 'Osvaldo', whatsapp_group_id: null }]]),
    });
    const overrides = [
      { transaction_id: 't1', category_id: 'cat-cliente', lead_id: 'lead-1', contact_id: null, group_jid: null },
      { transaction_id: 't3', category_id: 'cat-cliente', lead_id: 'lead-2', contact_id: null, group_jid: null },
    ];
    const r = calcularLimitesPorVinculo(transacoes, [categoriaCliente], overrides, mesmoCliente);

    expect(r.totais).toHaveLength(1);
    expect(r.estouros[0]).toMatchObject({ rotulo: 'Osvaldo', totalGasto: 900, excedente: 400 });
  });

  it('ignora categoria sem limite e unidade de tempo', () => {
    const overrides = [
      { transaction_id: 't1', category_id: 'cat-dia', lead_id: 'lead-1', contact_id: null, group_jid: null },
    ];
    const r = calcularLimitesPorVinculo(
      transacoes,
      [
        { id: 'cat-dia', name: 'Alimentação', max_limit_per_unit: 100, limit_unit: 'per_day' },
        { id: 'cat-sem', name: 'Outros', max_limit_per_unit: null, limit_unit: 'per_whatsapp_group' },
      ],
      overrides,
      m
    );
    expect(r).toEqual({ estouros: [], totais: [], pendencias: [] });
  });
});
