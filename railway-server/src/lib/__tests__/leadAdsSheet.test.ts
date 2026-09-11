/**
 * O id do lead da Meta tem que sair da planilha como número puro.
 *
 * A exportação de Lead Ads escreve `l:1009263962139850`. A Conversion Leads API
 * espera 15-17 dígitos; com o prefixo ela não casa o fechamento com o
 * formulário e não reclama — falha do lado de lá, calada. Em 04/09/2026 foram
 * 131 linhas gravadas com prefixo antes de alguém olhar o dado no banco.
 */
import { describe, it, expect } from 'vitest';
import { normalizaLeadIdMeta, normalizePhone, phoneKey, isJunkName, casaOperador, achaCabecalho } from '../leadAdsSheet';

describe('normalizaLeadIdMeta', () => {
  it('tira o prefixo l: da exportação da Meta', () => {
    expect(normalizaLeadIdMeta('l:1009263962139850')).toBe('1009263962139850');
  });

  it('deixa passar o id que já vem limpo', () => {
    expect(normalizaLeadIdMeta('1009263962139850')).toBe('1009263962139850');
  });

  it('devolve vazio para célula vazia, nula ou lixo curto', () => {
    expect(normalizaLeadIdMeta('')).toBe('');
    expect(normalizaLeadIdMeta(null)).toBe('');
    expect(normalizaLeadIdMeta(undefined)).toBe('');
    expect(normalizaLeadIdMeta('l:')).toBe('');
    expect(normalizaLeadIdMeta('n/a')).toBe('');
    expect(normalizaLeadIdMeta('123')).toBe('');
  });
});

describe('helpers compartilhados entre planilha e API da Meta', () => {
  it('normaliza telefone para dígitos com 55', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('5511987654321');
    expect(normalizePhone('5511987654321')).toBe('5511987654321');
    expect(normalizePhone('p:5511987654321')).toBe('5511987654321'); // prefixo da exportação
    expect(normalizePhone('')).toBe('');
  });

  it('dedup usa os 8 últimos dígitos, então planilha e API se enxergam', () => {
    // O mesmo humano escrito de dois jeitos precisa dar a MESMA chave, senão
    // ele entra uma vez por caminho.
    expect(phoneKey(normalizePhone('(11) 98765-4321'))).toBe(phoneKey(normalizePhone('5511987654321')));
  });

  it('nome só de dígitos é lixo', () => {
    // Regressão: ao mover isJunkName eu corrompi o range para [a-za-u00e0-ú],
    // que inclui dígitos — "12345" passava como nome válido.
    expect(isJunkName('12345')).toBe(true);
    expect(isJunkName('<test>')).toBe(true);
    expect(isJunkName('..')).toBe(true);
    expect(isJunkName('ab')).toBe(true);
    expect(isJunkName('Maria Aparecida')).toBe(false);
    expect(isJunkName('José')).toBe(false);
  });

  it('casa operador em aba de planilha e em nome de formulário da Meta', () => {
    expect(casaOperador('MATEUS - BPC')).toBe('Mateus');
    expect(casaOperador('AUXÍLIO - ACIDENTE [EDILAN-3]')).toBe('Edilan');
    expect(casaOperador('KAROL - BPC')).toBe('Karolyne');
    expect(casaOperador('1LEADS EDILAN')).toBe('Edilan');
  });

  it('formulário que não é de atendente devolve null, para virar decisão', () => {
    expect(casaOperador('[REPRESENTANTE COMERCIAL-SP]')).toBeNull();
    expect(casaOperador('[CAPTAÇÃO][CORRETOR]')).toBeNull();
  });

  it('CUIDADO DOCUMENTADO: "api" casa por substring', () => {
    // A palavra-chave 'api' existe para a aba "API" da planilha, mas casa dentro
    // de qualquer palavra. Hoje nenhum formulário colide; se alguém criar
    // "TERAPIA - BPC", o lead vai para o operador errado.
    expect(casaOperador('TERAPIA - BPC')).toBe('API');
  });
});

// ============================================================
// achaCabecalho — casos medidos na planilha real em 11/09/2026
// ============================================================
describe('achaCabecalho', () => {
  const CABECALHO_META = [
    'id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name',
    'campaign_id', 'campaign_name', 'form_id', 'form_name', 'is_organic', 'platform',
    'qual_o_nome_da_criança_?', 'full_name', 'phone_number', 'lead_status',
  ];

  it('usa a primeira linha quando ela é o cabeçalho (caso normal)', () => {
    const r = achaCabecalho([CABECALHO_META, ['l:1', '2026-09-01', '', '', '', '', '', '', '', '', '', '', '', 'Ana', '5511999990000', 'created']]);
    expect(r.linha).toBe(0);
    expect(r.headers[13]).toBe('full_name');
    expect(r.id_recuperado).toBe(false);
  });

  it('acha o cabeçalho na linha 2 quando um lead foi colado em cima — aba MATEUS - 2', () => {
    // O defeito real: a linha 1 era um lead, e as 874 linhas da aba foram
    // descartadas porque `l:1086829373844173` virou nome de coluna.
    const leadNoTopo = [
      'l:1086829373844173', '2026-09-08t05:08:43-05:00', 'ag:52514340069396', 'c 005',
      'as:52509885078396', 'conjunto 6 - mateus — cópia', 'c:52509106216996', 'bpc-loas',
      'f:1425074856247103', 'mateus - bpc', 'false', 'fb', 'edson', '4299685755',
      'evelin iasmin castilho', 'created',
    ];
    const r = achaCabecalho([leadNoTopo, CABECALHO_META, ['l:2', '', '', '', '', '', '', '', '', '', '', '', '', 'Bia', '5511888880000', 'created']]);
    expect(r.linha).toBe(1);
    expect(r.headers[13]).toBe('full_name');
    expect(r.acertos).toBeGreaterThan(5);
  });

  it('batiza de `id` a primeira coluna sem rótulo — aba KAROL - 2', () => {
    // O cabeçalho estava certo, só a célula A1 vazia. Sem o nome `id` as linhas
    // não carregavam o id da Meta e o status da equipe não casava com lead nenhum.
    const semRotulo = ['', ...CABECALHO_META.slice(1)];
    const r = achaCabecalho([
      semRotulo,
      ['l:1005000272275449', '2026-07-06', '', '', '', '', '', '', '', '', '', '', '', 'Ana', '5511999990000', 'created'],
      ['1086829373844173', '2026-07-07', '', '', '', '', '', '', '', '', '', '', '', 'Bia', '5511888880000', 'created'],
    ]);
    expect(r.headers[0]).toBe('id');
    expect(r.id_recuperado).toBe(true);
  });

  it('não batiza de `id` coluna sem rótulo que guarda outra coisa', () => {
    // Evidência, não chute: se a coluna não tem cara de id da Meta, fica sem nome.
    const semRotulo = ['', ...CABECALHO_META.slice(1)];
    const r = achaCabecalho([
      semRotulo,
      ['observação qualquer', '2026-07-06', '', '', '', '', '', '', '', '', '', '', '', 'Ana', '5511999990000', 'created'],
    ]);
    expect(r.headers[0]).toBe('');
    expect(r.id_recuperado).toBe(false);
  });

  it('cai na primeira linha quando nenhuma parece cabeçalho', () => {
    // Comportamento antigo preservado: aba com nomes inesperados não fica pior.
    const r = achaCabecalho([['coluna a', 'coluna b'], ['x', 'y']]);
    expect(r.linha).toBe(0);
    expect(r.acertos).toBe(0);
  });
});
