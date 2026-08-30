import { describe, it, expect } from 'vitest';
// Fixtures derivadas de e-mails REAIS de processual_emails (30/08/2026) — nomes
// de partes e trechos irrelevantes abreviados, estrutura intacta. Regra zero da
// tarefa: nenhum parser nasce de formato imaginado.
import { parseEmailPush } from '../../../supabase/functions/_shared/emailPushParser';

const TRF1 = [
  'JUSTIÇA FEDERAL DA 1ª REGIÃO',
  '',
  'PJe Push - Serviço de Acompanhamento automático de processos',
  '',
  'Prezado(a) ,',
  '',
  'Informamos que o processo a seguir sofreu movimentação:',
  'Número do Processo: 1006553-26.2025.4.01.4003',
  'Polo Ativo: FULANA DE TAL',
  'Polo Passivo: INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS',
  'Classe Judicial: PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL',
  'Órgão: Juizado Especial Cível e Criminal Adjunto à Vara Federal da SSJ de Floriano-PI',
  'Data de Autuação: 26/09/2025',
  'Tipo de Distribuição: sorteio',
  'Assunto: Pensão por Morte (Art. 74/9)',
  '',
  'Data    Movimento       Documento',
  '28/08/2026 00:37        Publicado Intimação em 28/08/2026.      Intimação - Intimação<https://pje1g.trf1.jus.br/pje-web/Painel/painel_usuario/documentoHTML.seam?idBin=2197671851&idProcessoDoc=2282288605>',
  '28/08/2026 00:37        Disponibilizado no DJ Eletrônico em 27/08/2026  Intimação - Intimação<https://pje1g.trf1.jus.br/pje-web/Painel/painel_usuario/documentoHTML.seam?idBin=2197671851&idProcessoDoc=2282288605>',
  '28/08/2026 00:13        Decorrido prazo de INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS em 27/08/2026 23:59.',
  '',
  '',
  'Caso não tenha mais interesse em receber o push, acessar o link: https://pje1g.trf1.jus.br/pje-web/Push/loginPush.seam',
  '',
  'ATENÇÃO: este e-mail é gerado de forma automatizada, por gentileza, não o responda.',
].join('\r\n');

const TRF3_ACHATADO =
  'PJe Push Justiça Federal da 3ª Região PJe Push - Serviço de Acompanhamento automático de processos '
  + 'Prezado(a), Informamos que o processo a seguir sofreu movimentação: '
  + 'Número do Processo: 5004222-93.2026.4.03.6304 Polo Ativo: R. S. S. '
  + 'Polo Passivo: INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS Classe Judicial: PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL '
  + 'Órgão: 2ª VARA GABINETE JEF DE JUNDIAÍ Data de Autuação: 26/08/2026 16:25 Assunto: Pessoa com Deficiência '
  + 'Data - Movimento 29/08/2026 15:04 - Decisão Interlocutória de Mérito 29/08/2026 15:04 - Não Concedida a Medida Liminar '
  + 'Caso não tenha mais interesse em receber o push, acessar o link: -1/Push/loginPush.seam '
  + 'ATENÇÃO: este e-mail é gerado de forma automatizada, por gentileza, não o responda.';

const EPROC_TRF6_ACHATADO =
  'Os seguintes processos tiveram uma nova movimentação relacionada a um prazo processual '
  + 'Num. Processo: 6070144-26.2026.4.06.3800 Movimentação: Confirmada a intimação eletrônica - Evento Número: 29 '
  + 'Partes: AUTOR FULANO Advogado(s) BELTRANO (PI010949) X RÉU INSTITUTO NACIONAL DO SEGURO SOCIAL '
  + 'Num. Processo: 6070144-26.2026.4.06.3800 Movimentação: Juntada de Petição - Evento Número: 30 '
  + 'Partes: AUTOR FULANO Advogado(s) BELTRANO (PI010949) X RÉU INSTITUTO NACIONAL DO SEGURO SOCIAL '
  + 'ATENÇÃO: Esta comunicação é meramente informativa, NÃO TENDO VALOR DE INTIMAÇÃO.';

const EPROC_TJMG_MOV_COMPOSTA =
  'Os seguintes processos tiveram uma nova movimentação relacionada a um prazo processual '
  + 'Num. Processo: 1072076-85.2026.8.13.0024 Movimentação: Expedida/certificada a intimação eletrônica - Vista ao MP para Parecer - Evento Número: 159 '
  + 'Partes: REQUERENTE FULANA Advogado(s) BELTRANO (PI010949)';

const PROJUDI_TJAM = [
  'ESTADO DO AMAZONAS - Brasil, 29 de Agosto de 2026',
  '',
  'Esta é uma mensagem automática gerada pelo sistema PROJUDI e não deve ser respondida. ',
  '',
  'PROCESSO JUDICIAL Nº 0005779-05.2026.8.04.4700',
  'DISTRIBUIÇÃO: 13 de Julho de 2026 às 12:02',
  'JUÍZO: 3ª Vara da Comarca de Itacoatiara - Fazenda Pública',
  '',
  'AUTOR(S):',
  '    \tFULANA DE TAL',
  '',
  '\tUma intimação no processo acima citado, referente à movimentação NOMEADO PERITO , ocorrido em 27 de Julho de 2026, e direcionada à parte FULANA DE TAL, teve seu decurso de prazo sem o cumprimento (resposta) registrado no sistema.  ',
].join('\r\n');

const ESAJ_INCIDENTE = [
  'Prezado(a) ADVOGADO,',
  'O sistema PUSH está disponibilizando novas informações, as quais são listadas abaixo:',
  '',
  'Incidente Processual: Exibição de Documento ou Coisa Cível   (0037121-87.2022.8.26.0100) <https://esaj.tjsp.jus.br/cpopg/show.do?processo.codigo=2S001LRQZ0000>',
  'Assunto:        Concurso de Credores',
  'Advogados:      Alguém (OAB nº 28310/BA)',
  'Novas Movimentações',
  '27/08/2026 16:27        Expedido Relatório',
  'Relatório do Voto',
  '',
  '27/08/2026 17:00        Processo encaminhado para o Processamento de Grupos e Câmaras - À mesa',
  '',
  '________________________________',
].join('\r\n');

describe('parseEmailPush — PJe Push TRF1 (Data/Movimento/Documento em linhas)', () => {
  it('vira UMA movimentação com os 3 eventos, data do mais recente e link do documento', () => {
    const movs = parseEmailPush({
      assunto: 'Movimentação processual do processo 1006553-26.2025.4.01.4003',
      corpo: TRF1,
      dataEmail: '2026-08-29',
    });
    expect(movs).toHaveLength(1);
    const m = movs[0];
    expect(m.cnjDigitos).toBe('10065532620254014003');
    expect(m.fonte).toBe('pje');
    expect(m.data).toBe('2026-08-28');
    expect(m.eventos).toHaveLength(3);
    expect(m.eventos![0].texto).toContain('Publicado Intimação');
    expect(m.eventos![0].link).toContain('documentoHTML.seam');
    expect(m.eventos![2].texto).toContain('Decorrido prazo');
    expect(m.eventos![2].link).toBeNull();
    // O título diz o que houve, não "Movimentação".
    expect(m.titulo).toContain('Publicado Intimação');
  });

  it('a data de autuação e o rodapé não viram evento', () => {
    const movs = parseEmailPush({ assunto: 'x 1006553-26.2025.4.01.4003', corpo: TRF1, dataEmail: '2026-08-29' });
    const textos = movs[0].eventos!.map((e) => e.texto).join(' | ');
    expect(textos).not.toMatch(/Autuação|interesse em receber/i);
  });
});

describe('parseEmailPush — PJe Push TRF3 (mesmo layout, achatado)', () => {
  it('lê os 2 movimentos do bloco "Data - Movimento"', () => {
    const movs = parseEmailPush({
      assunto: '[Push] Movimentação processual do processo 5004222-93.2026.4.03.6304',
      corpo: TRF3_ACHATADO,
      dataEmail: '2026-08-29',
    });
    expect(movs).toHaveLength(1);
    expect(movs[0].eventos).toHaveLength(2);
    expect(movs[0].eventos![0].texto).toBe('Decisão Interlocutória de Mérito');
    expect(movs[0].eventos![1].texto).toBe('Não Concedida a Medida Liminar');
    expect(movs[0].data).toBe('2026-08-29');
  });
});

describe('parseEmailPush — EPROC em linha corrida (TRF6/TJMG)', () => {
  it('não pula a movimentação que está na MESMA linha do Num. Processo', () => {
    const movs = parseEmailPush({ assunto: 'Movimentações Processuais - EPROC', corpo: EPROC_TRF6_ACHATADO });
    expect(movs).toHaveLength(2);
    expect(movs[0].cnjDigitos).toBe('60701442620264063800');
    expect(movs[0].texto).toBe('Confirmada a intimação eletrônica');
    expect(movs[1].texto).toBe('Juntada de Petição');
    expect(movs[0].data).toBeNull();
  });

  it('movimentação com " - " no meio não é cortada antes da hora', () => {
    const movs = parseEmailPush({ assunto: 'EPROC', corpo: EPROC_TJMG_MOV_COMPOSTA });
    expect(movs).toHaveLength(1);
    expect(movs[0].texto).toBe('Expedida/certificada a intimação eletrônica - Vista ao MP para Parecer');
  });
});

describe('parseEmailPush — PROJUDI (TJAM)', () => {
  it('extrai a movimentação e usa a data da carta, não a "ocorrido em"', () => {
    const movs = parseEmailPush({
      assunto: 'Decurso de prazo de intimação sem cumprimento',
      corpo: PROJUDI_TJAM,
      dataEmail: '2026-08-29',
    });
    expect(movs).toHaveLength(1);
    expect(movs[0].cnjDigitos).toBe('00057790520268044700');
    expect(movs[0].data).toBe('2026-08-29');
    expect(movs[0].texto).toContain('NOMEADO PERITO');
    expect(movs[0].texto).toContain('27/07/2026');
    expect(movs[0].titulo).toBe('Decurso de prazo de intimação sem cumprimento');
  });
});

describe('parseEmailPush — e-SAJ com Incidente Processual', () => {
  it('o incidente é cabeçalho de processo e o teor curto entra como complemento', () => {
    const movs = parseEmailPush({ assunto: 'Portal e-Saj - Andamento Processual', corpo: ESAJ_INCIDENTE });
    expect(movs).toHaveLength(2);
    expect(movs[0].cnjDigitos).toBe('00371218720228260100');
    expect(movs[0].texto).toBe('Expedido Relatório — Relatório do Voto');
    expect(movs[0].link).toContain('esaj.tjsp.jus.br');
    expect(movs[1].texto).toContain('Processamento de Grupos');
  });
});

describe('parseEmailPush — fallback nunca carimba data', () => {
  it('layout desconhecido: assunto vira o texto e a data fica NULA', () => {
    const movs = parseEmailPush({
      assunto: 'Intimação do processo 1234567-89.2026.8.18.0140',
      corpo: 'Formato novo que nenhum parser conhece. Processo 1234567-89.2026.8.18.0140.',
      dataEmail: '2026-08-29',
    });
    expect(movs).toHaveLength(1);
    expect(movs[0].fonte).toBe('desconhecida');
    expect(movs[0].data).toBeNull();
  });
});
