import { describe, it, expect } from 'vitest';
// O módulo é do railway-server, mas é puro (nenhum import) e a regra de leitura
// do despacho do INSS precisa de teste — o vitest da raiz é o único que roda.
import { extrairPontosPendentes } from '../../../railway-server/src/lib/inss-despacho';

// Textos reduzidos a partir de despachos reais de `inss_status_history`
// (amostra de 40 baixada em 25/08/2026).
const LISTA_DE_DOCUMENTOS =
  'NR: Prezado(a) Senhor(a), Para dar andamento ao processo 82455582, solicitamos o envio ' +
  'eletrônico dos documentos descritos abaixo: 1. Realizar a inscrição ou atualização do ' +
  'CadÚnico no CRAS. 2. Após a inscrição solicitamos o envio dos seguintes documentos: ' +
  '? Documento de identificação oficial com foto e CPF; ? Comprovante de residência. ' +
  'O cumprimento de exigência por meio eletrônico é feito diretamente pelo aplicativo ou ' +
  'site do Meu INSS. Basta digitalizar ou fotografar os documentos originais. ' +
  'O não atendimento desta exigência ou a ausência de manifestação até o dia 20/07/2026 ' +
  '(30 dias de prazo) poderá acarretar desistência do processo. Atenciosamente, ' +
  'Instituto Nacional do Seguro Social - INSS';

const AGENDAMENTO =
  'Prezado(a) Sr.(a), O Benefício Assistencial à Pessoa com Deficiência exige perícia ' +
  'médica e avaliação social. Agende todos os serviços que estiverem pendentes para ' +
  'continuar a análise do seu pedido. Para agendar: Entre no Meu INSS Informe seu CPF e ' +
  'senha Siga para Cumprir Exigência. Outra forma de agendar: Ligue para o telefone 135. ' +
  'Atenção! Este pedido será concluído por desistência caso não faça o agendamento em até 30 dias.';

describe('extrairPontosPendentes', () => {
  it('devolve a lista de documentos e descarta o manual do Meu INSS', () => {
    const out = extrairPontosPendentes(LISTA_DE_DOCUMENTOS)!;
    expect(out).toContain('Realizar a inscrição ou atualização do CadÚnico');
    expect(out).toContain('Documento de identificação oficial');
    expect(out).not.toContain('Basta digitalizar');
    expect(out).not.toContain('Atenciosamente');
  });

  it('quebra itens numerados e bullets em linhas', () => {
    const linhas = extrairPontosPendentes(LISTA_DE_DOCUMENTOS)!.split('\n');
    expect(linhas.some((l) => l.startsWith('1.'))).toBe(true);
    expect(linhas.some((l) => l.startsWith('- Documento de identificação'))).toBe(true);
  });

  it('preserva o prazo, que mora na frase de rodapé cortada', () => {
    expect(extrairPontosPendentes(LISTA_DE_DOCUMENTOS)).toContain('⏳ Prazo: 20/07/2026');
    expect(extrairPontosPendentes(AGENDAMENTO)).toContain('⏳ Prazo: 30 dias');
  });

  it('no texto de agendamento guarda só o que está pendente', () => {
    const out = extrairPontosPendentes(AGENDAMENTO)!;
    expect(out).toContain('exige perícia médica e avaliação social');
    expect(out).not.toContain('Informe seu CPF');
    expect(out).not.toContain('telefone 135');
  });

  it('remove a saudação e o prefixo NR:', () => {
    const out = extrairPontosPendentes(LISTA_DE_DOCUMENTOS)!;
    expect(out.startsWith('Para dar andamento')).toBe(true);
  });

  it('devolve null quando não há despacho ou não sobra texto', () => {
    expect(extrairPontosPendentes(null)).toBeNull();
    expect(extrairPontosPendentes('   ')).toBeNull();
    expect(extrairPontosPendentes('Prezado(a) Senhor(a), Atenciosamente, Instituto Nacional')).toBeNull();
  });

  it('trunca despacho muito longo em vez de estourar a descrição', () => {
    const longo = `Prezado(a) Senhor(a), ${'documento pendente muito descrito. '.repeat(80)}`;
    const out = extrairPontosPendentes(longo)!;
    expect(out.length).toBeLessThan(1300);
    expect(out).toContain('…');
  });
});
